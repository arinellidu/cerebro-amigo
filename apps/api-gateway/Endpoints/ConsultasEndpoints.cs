using ApiGateway.Auth;
using ApiGateway.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using System.Text.Json;

namespace ApiGateway.Endpoints;

/// <summary>
/// Agenda do médico — CRUD de <c>consultas</c>. Tenant = médico logado,
/// escopado SEMPRE via JOIN em <c>pacientes.medico_responsavel_id</c>
/// (regra clínica: filtro de tenant é a 1ª cláusula, nunca opcional).
///
/// Usado pela tela /dashboard/agenda e para resolver consulta→paciente
/// no briefing pré-consulta (/dashboard/consultas/{id}/briefing).
///
/// Disponibilidade/conflito: cada consulta tem <c>duracao_min</c>; os slots
/// livres saem de <c>medicos.horario_trabalho</c> (JSONB) menos os horários
/// já ocupados. Agendar/remarcar em cima de outra consulta retorna 409.
/// </summary>
public static class ConsultasEndpoints
{
    private static readonly string[] Modalidades = { "presencial", "teleconsulta" };
    private static readonly string[] Status =
        { "agendada", "confirmada", "realizada", "cancelada" };

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/consultas")
            .WithTags("consultas")
            .RequireAuthorization()
            .RequireAssinaturaAtiva()  // ADR-055 Fase D: gate de assinatura (dashboard)
            .RequireWriteAccess();     // ADR-065: trial read-only bloqueia escrita (exceto pacientes)

        // Agenda no intervalo [de, ate). Default: hoje .. +7 dias.
        g.MapGet("/", async (
            AppDbContext db, ClaimsPrincipal user,
            [FromQuery] string? de, [FromQuery] string? ate) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            // UTC explícito: Npgsql rejeita DateTime Kind=Unspecified em coluna
            // timestamptz (inicia_em). Sem isto o GET da agenda estoura 500 e a
            // agenda fica vazia ("Nenhuma consulta neste dia") mesmo com consultas
            // existindo. `.Date`/`DateTime.UtcNow.Date` vêm Unspecified → forçar Utc.
            var inicio = DateTime.SpecifyKind(
                DateTime.TryParse(de, out var d) ? d.Date : DateTime.UtcNow.Date, DateTimeKind.Utc);
            var fim = DateTime.SpecifyKind(
                DateTime.TryParse(ate, out var a) ? a.Date.AddDays(1) : inicio.AddDays(7), DateTimeKind.Utc);

            var rows = await db.Database.SqlQueryRaw<ConsultaListItem>(@"
                SELECT co.id, co.paciente_id, cl.nome AS paciente_nome,
                       co.inicia_em, co.duracao_min, co.modalidade, co.status, co.notas
                FROM consultas co
                JOIN clientes cl ON cl.id = co.paciente_id
                JOIN pacientes p ON p.cliente_id = co.paciente_id
                WHERE p.medico_responsavel_id = {0}
                  AND co.inicia_em >= {1} AND co.inicia_em < {2}
                ORDER BY co.inicia_em",
                medicoId.Value, inicio, fim).ToListAsync();

            return Results.Ok(rows);
        });

        // Slots livres de um dia (YYYY-MM-DD). Base p/ o dialog de nova consulta
        // e p/ o self-booking do paciente (reusa GerarSlotsLivres).
        g.MapGet("/disponibilidade", async (
            AppDbContext db, ClaimsPrincipal user, [FromQuery] string? data) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();
            if (!DateOnly.TryParse(data, out var dia))
                return Results.BadRequest(new { erro = "data inválida (use YYYY-MM-DD)" });

            var resultado = await CalcularDisponibilidadeAsync(db, medicoId.Value, dia);
            return Results.Ok(resultado);
        });

        // Próximas consultas + status do lembrete (alimenta /dashboard/lembretes).
        g.MapGet("/lembretes", async (AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            var rows = await db.Database.SqlQueryRaw<LembreteItem>(@"
                SELECT co.id, cl.nome AS paciente_nome, co.inicia_em, co.status,
                       EXISTS(SELECT 1 FROM consulta_lembretes l
                              WHERE l.consulta_id = co.id AND l.tipo = '24h') AS lembrete_dia,
                       EXISTS(SELECT 1 FROM consulta_lembretes l
                              WHERE l.consulta_id = co.id AND l.tipo = '1h')  AS lembrete_hora
                FROM consultas co
                JOIN clientes cl ON cl.id = co.paciente_id
                JOIN pacientes p ON p.cliente_id = co.paciente_id
                WHERE p.medico_responsavel_id = {0}
                  AND co.inicia_em > NOW()
                  AND co.status IN ('agendada', 'confirmada')
                ORDER BY co.inicia_em
                LIMIT 100",
                medicoId.Value).ToListAsync();

            return Results.Ok(rows);
        });

        // Detalhe de uma consulta (resolve paciente — usado pelo briefing).
        g.MapGet("/{id:guid}", async (Guid id, AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            var row = await db.Database.SqlQueryRaw<ConsultaListItem>(@"
                SELECT co.id, co.paciente_id, cl.nome AS paciente_nome,
                       co.inicia_em, co.duracao_min, co.modalidade, co.status, co.notas
                FROM consultas co
                JOIN clientes cl ON cl.id = co.paciente_id
                JOIN pacientes p ON p.cliente_id = co.paciente_id
                WHERE co.id = {0} AND p.medico_responsavel_id = {1}",
                id, medicoId.Value).FirstOrDefaultAsync();

            return row is null ? Results.NotFound() : Results.Ok(row);
        });

        // Agendar consulta.
        g.MapPost("/", async (
            [FromBody] CriarConsultaRequest req, AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            // Paciente precisa ser do médico (tenant).
            var ehDoMedico = await db.Database.ExistsAsync(
                "SELECT 1 FROM pacientes WHERE cliente_id = {0} AND medico_responsavel_id = {1}",
                req.PacienteId, medicoId.Value);
            if (!ehDoMedico) return Results.Forbid();

            var modalidade = (req.Modalidade ?? "presencial").ToLowerInvariant();
            if (!Modalidades.Contains(modalidade))
                return Results.BadRequest(new { erro = "modalidade inválida" });

            var duracao = req.DuracaoMin is > 0 ? req.DuracaoMin.Value : 30;
            var iniciaEm = ToUtc(req.IniciaEm); // timestamptz exige Kind=Utc (ver ToUtc)

            if (await TemConflitoAsync(db, medicoId.Value, iniciaEm, duracao, Guid.Empty))
                return Results.Conflict(new { erro = "horario_ocupado" });

            var novoId = await db.Database.ExecuteScalarAsync<Guid>(@"
                INSERT INTO consultas (paciente_id, medico_id, inicia_em, duracao_min, modalidade, status, notas)
                VALUES ({0}, {1}, {2}, {3}, {4}, 'agendada', {5})
                RETURNING id",
                req.PacienteId, medicoId.Value, iniciaEm, duracao, modalidade,
                (object?)req.Notas ?? DBNull.Value);

            return Results.Created($"/api/v1/consultas/{novoId}", new { id = novoId });
        });

        // Atualizar consulta (status, horário, duração, modalidade, notas).
        // Campos null = inalterados. Mudar horário/duração revalida conflito.
        g.MapPatch("/{id:guid}", async (
            Guid id, [FromBody] AtualizarConsultaRequest req,
            AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            string? status = req.Status?.ToLowerInvariant();
            if (status is not null && !Status.Contains(status))
                return Results.BadRequest(new { erro = "status inválido" });

            string? modalidade = req.Modalidade?.ToLowerInvariant();
            if (modalidade is not null && !Modalidades.Contains(modalidade))
                return Results.BadRequest(new { erro = "modalidade inválida" });

            // Estado atual (tenant-scoped) p/ revalidar conflito quando muda o tempo.
            var atual = await db.Database.SqlQueryRaw<ConsultaOcupada>(@"
                SELECT co.inicia_em, co.duracao_min
                FROM consultas co
                JOIN pacientes p ON p.cliente_id = co.paciente_id
                WHERE co.id = {0} AND p.medico_responsavel_id = {1}",
                id, medicoId.Value).FirstOrDefaultAsync();
            if (atual is null) return Results.NotFound();

            var iniciaEmUtc = req.IniciaEm is { } ie ? ToUtc(ie) : (DateTime?)null;
            var novoInicio = iniciaEmUtc ?? atual.IniciaEm;
            var novaDur = req.DuracaoMin is > 0 ? req.DuracaoMin.Value : atual.DuracaoMin;
            var mudouTempo = iniciaEmUtc is not null
                || (req.DuracaoMin is > 0 && req.DuracaoMin.Value != atual.DuracaoMin);
            if (mudouTempo && await TemConflitoAsync(db, medicoId.Value, novoInicio, novaDur, id))
                return Results.Conflict(new { erro = "horario_ocupado" });

            var afetadas = await db.Database.ExecuteRawAsync(@"
                UPDATE consultas SET
                    status      = COALESCE({2}, status),
                    inicia_em   = COALESCE({3}, inicia_em),
                    modalidade  = COALESCE({4}, modalidade),
                    notas       = COALESCE({5}, notas),
                    duracao_min = COALESCE({6}, duracao_min)
                WHERE id = {0}
                  AND paciente_id IN (
                      SELECT cliente_id FROM pacientes WHERE medico_responsavel_id = {1}
                  )",
                id, medicoId.Value,
                (object?)status ?? DBNull.Value,
                (object?)iniciaEmUtc ?? DBNull.Value,
                (object?)modalidade ?? DBNull.Value,
                (object?)req.Notas ?? DBNull.Value,
                (object?)req.DuracaoMin ?? DBNull.Value);

            return afetadas == 0 ? Results.NotFound() : Results.NoContent();
        });

        // Desfecho pós-consulta: registra notas e marca a consulta como realizada.
        // O médico autora as notas; a IA não interpreta nada. As condutas de
        // acompanhamento são definidas na aba Conduta (CondutasEndpoints).
        g.MapPost("/{id:guid}/desfecho", async (
            Guid id, [FromBody] DesfechoRequest req, AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            var afetadas = await db.Database.ExecuteRawAsync(@"
                UPDATE consultas SET
                    notas  = COALESCE(NULLIF({2}, ''), notas),
                    status = 'realizada'
                WHERE id = {0}
                  AND paciente_id IN (
                      SELECT cliente_id FROM pacientes WHERE medico_responsavel_id = {1}
                  )",
                id, medicoId.Value, req.Notas ?? "");

            return afetadas == 0 ? Results.NotFound() : Results.NoContent();
        });
    }

    // ─── Disponibilidade / conflito (reutilizável: médico e portal paciente) ───

    /// <summary>
    /// Slots livres de um dia para um médico. Lê <c>horario_trabalho</c> (JSONB),
    /// gera slots no fuso do médico e remove os já ocupados (não-cancelados).
    /// </summary>
    public static async Task<DisponibilidadeDto> CalcularDisponibilidadeAsync(
        AppDbContext db, Guid medicoId, DateOnly dia)
    {
        var cfg = await db.Database.SqlQueryRaw<MedicoAgendaCfg>(
            "SELECT timezone, horario_trabalho::text AS horario_trabalho FROM medicos WHERE id = {0}",
            medicoId).FirstOrDefaultAsync();

        var tz = ResolveTz(cfg?.Timezone);
        var h = ParseHorario(cfg?.HorarioTrabalho);

        var localDayStart = new DateTime(dia.Year, dia.Month, dia.Day, 0, 0, 0, DateTimeKind.Unspecified);
        var utcStart = TimeZoneInfo.ConvertTimeToUtc(localDayStart, tz);
        var utcEnd = TimeZoneInfo.ConvertTimeToUtc(localDayStart.AddDays(1), tz);

        var ocupadosRows = await db.Database.SqlQueryRaw<ConsultaOcupada>(@"
            SELECT co.inicia_em, co.duracao_min
            FROM consultas co
            JOIN pacientes p ON p.cliente_id = co.paciente_id
            WHERE p.medico_responsavel_id = {0}
              AND co.status <> 'cancelada'
              AND co.inicia_em >= {1} AND co.inicia_em < {2}",
            medicoId, utcStart, utcEnd).ToListAsync();

        var ocupados = ocupadosRows
            .Select(o => (Inicio: DateTime.SpecifyKind(o.IniciaEm, DateTimeKind.Utc), o.DuracaoMin))
            .ToList();

        var slots = GerarSlotsLivres(dia, tz, h, ocupados);
        return new DisponibilidadeDto(h.Dur, slots.Select(s => s.ToString("o")).ToArray());
    }

    /// <summary>True se [inicio, inicio+duracao) sobrepõe consulta não-cancelada do médico.</summary>
    public static async Task<bool> TemConflitoAsync(
        AppDbContext db, Guid medicoId, DateTime inicio, int duracao, Guid excluir)
    {
        var fim = inicio.AddMinutes(duracao);
        return await db.Database.ExistsAsync(@"
            SELECT 1 FROM consultas co
            JOIN pacientes p ON p.cliente_id = co.paciente_id
            WHERE p.medico_responsavel_id = {0}
              AND co.status <> 'cancelada'
              AND co.id <> {1}
              AND co.inicia_em < {2}
              AND co.inicia_em + make_interval(mins => co.duracao_min) > {3}",
            medicoId, excluir, fim, inicio);
    }

    private static List<DateTime> GerarSlotsLivres(
        DateOnly dia, TimeZoneInfo tz, HorarioCfg h,
        List<(DateTime Inicio, int DuracaoMin)> ocupados)
    {
        var slots = new List<DateTime>();
        if (!h.Dias.Contains(DowAbbr(dia.DayOfWeek))) return slots;

        for (var m = h.StartMin; m + h.Dur <= h.EndMin; m += h.Dur)
        {
            // pula janela de almoço (sobreposição)
            if (h.AlmIni is not null && h.AlmFim is not null
                && m < h.AlmFim && m + h.Dur > h.AlmIni) continue;

            var local = new DateTime(dia.Year, dia.Month, dia.Day, m / 60, m % 60, 0, DateTimeKind.Unspecified);
            var utc = TimeZoneInfo.ConvertTimeToUtc(local, tz);
            var utcFim = utc.AddMinutes(h.Dur);

            var conflito = ocupados.Any(o =>
                o.Inicio < utcFim && o.Inicio.AddMinutes(o.DuracaoMin) > utc);
            if (!conflito) slots.Add(utc);
        }
        return slots;
    }

    private static HorarioCfg ParseHorario(string? json)
    {
        var dias = new HashSet<string> { "seg", "ter", "qua", "qui", "sex" };
        var inicio = "08:00";
        var fim = "18:00";
        var dur = 30;
        int? almIni = null, almFim = null;

        try
        {
            using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? "{}" : json);
            var root = doc.RootElement;
            if (root.ValueKind == JsonValueKind.Object)
            {
                if (root.TryGetProperty("dias", out var diasEl) && diasEl.ValueKind == JsonValueKind.Array)
                {
                    var lidos = diasEl.EnumerateArray()
                        .Where(x => x.ValueKind == JsonValueKind.String)
                        .Select(x => x.GetString()!.ToLowerInvariant())
                        .ToHashSet();
                    if (lidos.Count > 0) dias = lidos;
                }
                if (root.TryGetProperty("inicio", out var iEl) && iEl.ValueKind == JsonValueKind.String)
                    inicio = iEl.GetString()!;
                if (root.TryGetProperty("fim", out var fEl) && fEl.ValueKind == JsonValueKind.String)
                    fim = fEl.GetString()!;
                if (root.TryGetProperty("duracao_min", out var dEl)
                    && dEl.ValueKind == JsonValueKind.Number && dEl.TryGetInt32(out var dv) && dv > 0)
                    dur = dv;
                if (root.TryGetProperty("almoco", out var aEl) && aEl.ValueKind == JsonValueKind.Array)
                {
                    var arr = aEl.EnumerateArray()
                        .Where(x => x.ValueKind == JsonValueKind.String)
                        .Select(x => x.GetString()!).ToList();
                    if (arr.Count == 2
                        && TimeOnly.TryParse(arr[0], out var a0) && TimeOnly.TryParse(arr[1], out var a1))
                    {
                        almIni = a0.Hour * 60 + a0.Minute;
                        almFim = a1.Hour * 60 + a1.Minute;
                    }
                }
            }
        }
        catch { /* mantém defaults */ }

        var startMin = TimeOnly.TryParse(inicio, out var ti) ? ti.Hour * 60 + ti.Minute : 8 * 60;
        var endMin = TimeOnly.TryParse(fim, out var tf) ? tf.Hour * 60 + tf.Minute : 18 * 60;
        return new HorarioCfg(dias, startMin, endMin, dur, almIni, almFim);
    }

    private static TimeZoneInfo ResolveTz(string? tz)
    {
        foreach (var id in new[] { tz, "America/Sao_Paulo" })
        {
            if (string.IsNullOrWhiteSpace(id)) continue;
            try { return TimeZoneInfo.FindSystemTimeZoneById(id); }
            catch { /* tenta próximo */ }
        }
        return TimeZoneInfo.Utc;
    }

    private static string DowAbbr(DayOfWeek d) => d switch
    {
        DayOfWeek.Monday => "seg",
        DayOfWeek.Tuesday => "ter",
        DayOfWeek.Wednesday => "qua",
        DayOfWeek.Thursday => "qui",
        DayOfWeek.Friday => "sex",
        DayOfWeek.Saturday => "sab",
        _ => "dom",
    };

    private static async Task<Guid?> GetMedicoIdAsync(AppDbContext db, ClaimsPrincipal user)
    {
        var sub = user.FindFirst("sub")?.Value;
        if (!Guid.TryParse(sub, out var userId)) return null;
        return await db.Database.ExecuteScalarAsync<Guid?>(
            "SELECT id FROM medicos WHERE usuario_id = {0}", userId);
    }

    /// <summary>
    /// Normaliza um instante para UTC antes de enviar ao Npgsql: a coluna
    /// <c>inicia_em</c> é <c>timestamptz</c> e rejeita <c>DateTime</c> com
    /// Kind != Utc (estoura 500 ao agendar/remarcar). Body sem timezone chega
    /// como Unspecified → tratado como UTC (todo o sistema persiste em UTC);
    /// Local → convertido. O GET já fazia isso para as datas da query-string.
    /// </summary>
    private static DateTime ToUtc(DateTime dt) => dt.Kind switch
    {
        DateTimeKind.Utc => dt,
        DateTimeKind.Local => dt.ToUniversalTime(),
        _ => DateTime.SpecifyKind(dt, DateTimeKind.Utc),
    };

    private sealed record HorarioCfg(
        HashSet<string> Dias, int StartMin, int EndMin, int Dur, int? AlmIni, int? AlmFim);
}

public record ConsultaListItem(
    Guid Id, Guid PacienteId, string? PacienteNome,
    DateTime IniciaEm, int DuracaoMin, string Modalidade, string Status, string? Notas);

public record CriarConsultaRequest(
    Guid PacienteId, DateTime IniciaEm, int? DuracaoMin, string? Modalidade, string? Notas);

public record AtualizarConsultaRequest(
    string? Status, DateTime? IniciaEm, int? DuracaoMin, string? Modalidade, string? Notas);

public record DesfechoRequest(string? Notas);

public record DisponibilidadeDto(int DuracaoMin, string[] Slots);

public record MedicoAgendaCfg(string? Timezone, string? HorarioTrabalho);

public record ConsultaOcupada(DateTime IniciaEm, int DuracaoMin);

public record LembreteItem(
    Guid Id, string? PacienteNome, DateTime IniciaEm, string Status,
    bool LembreteDia, bool LembreteHora);
