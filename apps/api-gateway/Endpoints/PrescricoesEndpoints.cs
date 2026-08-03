using ApiGateway.Auth;
using ApiGateway.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace ApiGateway.Endpoints;

/// <summary>
/// Endpoints de prescrição. Médico adiciona, troca, ajusta, encerra.
/// Cada ação grava um evento em prescricao_eventos (timeline clínica).
/// </summary>
public static class PrescricoesEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/prescricoes")
            .WithTags("prescricoes")
            .RequireAuthorization()
            .RequireAssinaturaAtiva()  // ADR-055 Fase D: gate de assinatura (dashboard)
            .RequireWriteAccess();     // ADR-065: trial read-only bloqueia escrita (exceto pacientes)

        // timestamptz exige Kind=Utc; o JSON entrega Unspecified.
        static DateTime? ToUtc(DateTime? dt) =>
            dt.HasValue ? DateTime.SpecifyKind(dt.Value, DateTimeKind.Utc) : null;

        // ---- lista de prescrições do paciente ----
        g.MapGet("/paciente/{pacienteId:guid}", async (Guid pacienteId, AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await ResolveMedicoId(db, user);
            if (medicoId is null) return Results.Forbid();

            // Tenant: o paciente tem de ser do médico logado (JOIN pacientes).
            // Rascunhos MEMED (precisa_confirmar) ficam fora desta lista — vivem na
            // fila de confirmação (GET .../a-confirmar) até o médico ativá-los.
            var rows = await db.Database.SqlQueryRaw<PrescricaoDto>(@"
                SELECT pr.id, pr.paciente_id, pr.medicamento, pr.dose_descricao,
                       pr.horarios, pr.inicio_em, pr.fim_em,
                       pr.receita_tipo, pr.receita_validade,
                       pr.observacoes, pr.ativa, pr.criada_em
                FROM prescricoes pr
                JOIN pacientes p ON p.cliente_id = pr.paciente_id
                WHERE pr.paciente_id = {0} AND p.medico_responsavel_id = {1}
                  AND pr.precisa_confirmar = FALSE
                ORDER BY pr.ativa DESC, pr.criada_em DESC", pacienteId, medicoId.Value).ToListAsync();
            return Results.Ok(rows);
        });

        // ---- fila de confirmação: rascunhos MEMED do paciente (Tier 1, ADR-056) ----
        g.MapGet("/paciente/{pacienteId:guid}/a-confirmar", async (Guid pacienteId, AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await ResolveMedicoId(db, user);
            if (medicoId is null) return Results.Forbid();

            // Tenant: só rascunhos de paciente do médico logado (JOIN pacientes).
            var rows = await db.Database.SqlQueryRaw<ReceitaAConfirmarDto>(@"
                SELECT pr.id, pr.paciente_id, pr.medicamento, pr.dose_descricao,
                       pr.receita_tipo, pr.criada_em
                FROM prescricoes pr
                JOIN pacientes p ON p.cliente_id = pr.paciente_id
                WHERE pr.paciente_id = {0} AND p.medico_responsavel_id = {1}
                  AND pr.precisa_confirmar = TRUE
                ORDER BY pr.criada_em DESC", pacienteId, medicoId.Value).ToListAsync();
            return Results.Ok(rows);
        });

        // ---- confirmar rascunho MEMED: médico seta horários + validade e ativa ----
        // Só aqui a receita MEMED entra nos jobs de lembrete (horarios) e renovação
        // (receita_validade). Clinical-safety #4: a decisão de horário/validade é do médico.
        g.MapPost("/{id:guid}/confirmar", async (Guid id, [FromBody] ConfirmarReceitaMemedRequest req, AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await ResolveMedicoId(db, user);
            if (medicoId is null) return Results.Forbid();

            TimeOnly[] horariosArray;
            try { horariosArray = (req.Horarios ?? new()).Select(h => TimeOnly.Parse(h)).ToArray(); }
            catch { return Results.BadRequest(new { error = "horarios_invalidos" }); }

            // Confirmar tem de ligar ao menos uma automação (lembrete OU renovação),
            // senão a prescrição ativaria com horarios='{}' + validade NULL e voltaria
            // ao beco sem saída que o ADR-056 elimina. Espelha o gate do front (defense-in-depth).
            if (horariosArray.Length == 0 && req.ReceitaValidade is null)
                return Results.BadRequest(new { error = "sem_automacao", message = "Informe ao menos um horário ou a validade para ativar." });

            // Tenant: resolve o rascunho já ancorado no médico logado (JOIN pacientes).
            var pacienteId = await db.Database.ExecuteScalarAsync<Guid?>(@"
                SELECT pr.paciente_id FROM prescricoes pr
                JOIN pacientes p ON p.cliente_id = pr.paciente_id
                WHERE pr.id = {0} AND p.medico_responsavel_id = {1}
                  AND pr.precisa_confirmar = TRUE", id, medicoId.Value);
            if (pacienteId is null) return Results.NotFound();

            var medicamento = await db.Database.ExecuteScalarAsync<string?>(
                "SELECT medicamento FROM prescricoes WHERE id = {0}", id);

            // Ativa o rascunho com os dados estruturados que o médico informou.
            var linhas = await db.Database.ExecuteRawAsync(@"
                UPDATE prescricoes pr SET
                  horarios = {1}, inicio_em = {2}, fim_em = {3},
                  receita_validade = {4},
                  dose_descricao = COALESCE({5}, pr.dose_descricao),
                  ativa = TRUE, precisa_confirmar = FALSE
                FROM pacientes p
                WHERE pr.id = {0} AND pr.precisa_confirmar = TRUE
                  AND p.cliente_id = pr.paciente_id AND p.medico_responsavel_id = {6}",
                id, horariosArray,
                ToUtc(req.InicioEm) ?? DateTime.UtcNow.Date,
                (object?)ToUtc(req.FimEm) ?? DBNull.Value,
                (object?)ToUtc(req.ReceitaValidade) ?? DBNull.Value,
                (object?)req.DoseDescricao ?? DBNull.Value,
                medicoId.Value);
            if (linhas == 0) return Results.NotFound();

            await GravarEvento(db, pacienteId.Value, medicoId, id,
                "adicao", medicamento ?? "(medicamento)", null, "Receita MEMED confirmada");

            return Results.NoContent();
        });

        // ---- descartar rascunho MEMED: remove sem virar prescrição ativa ----
        // DELETE físico: o rascunho NUNCA foi prescrição ativa nem gravou evento de
        // auditoria, então não há trilha append a preservar. Marcá-lo só com ativa=FALSE
        // o deixaria na lista normal de prescrições como "Inativa" fantasma (a lista filtra
        // por precisa_confirmar=FALSE) — exatamente o que o ADR-056 quer evitar. A receita
        // legal segue no MEMED e o registro do espelho em receitas_memed permanece.
        g.MapPost("/{id:guid}/descartar", async (Guid id, AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await ResolveMedicoId(db, user);
            if (medicoId is null) return Results.Forbid();

            // Tenant: só descarta rascunho de paciente do médico logado.
            var linhas = await db.Database.ExecuteRawAsync(@"
                DELETE FROM prescricoes pr
                USING pacientes p
                WHERE pr.id = {0} AND pr.precisa_confirmar = TRUE
                  AND p.cliente_id = pr.paciente_id AND p.medico_responsavel_id = {1}",
                id, medicoId.Value);
            if (linhas == 0) return Results.NotFound();

            return Results.NoContent();
        });

        // ---- histórico/timeline de eventos do paciente ----
        g.MapGet("/paciente/{pacienteId:guid}/historico", async (Guid pacienteId, AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await ResolveMedicoId(db, user);
            if (medicoId is null) return Results.Forbid();

            try
            {
                // Tenant: timeline só do paciente do médico logado (JOIN pacientes).
                var rows = await db.Database.SqlQueryRaw<EventoPrescricaoDto>(@"
                    SELECT e.id, e.tipo, e.medicamento, e.medicamento_anterior, e.motivo, e.criado_em
                    FROM prescricao_eventos e
                    JOIN pacientes p ON p.cliente_id = e.paciente_id
                    WHERE e.paciente_id = {0} AND p.medico_responsavel_id = {1}
                    ORDER BY e.criado_em DESC", pacienteId, medicoId.Value).ToListAsync();
                return Results.Ok(rows);
            }
            catch
            {
                return Results.Ok(Array.Empty<EventoPrescricaoDto>());
            }
        });

        // ---- criar (adição) ou trocar ----
        g.MapPost("/", async ([FromBody] CriarPrescricaoRequest req, AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await ResolveMedicoId(db, user);
            if (medicoId is null) return Results.Forbid();

            // Tenant: só prescreve para paciente do médico logado.
            var pacienteEhDoMedico = await db.Database.ExistsAsync(
                "SELECT 1 FROM pacientes WHERE cliente_id = {0} AND medico_responsavel_id = {1}",
                req.PacienteId, medicoId.Value);
            if (!pacienteEhDoMedico) return Results.Forbid();

            var horariosArray = req.Horarios.Select(h => TimeOnly.Parse(h)).ToArray();

            var prescricaoId = await db.Database.ExecuteScalarAsync<Guid>(@"
                INSERT INTO prescricoes
                  (paciente_id, medico_id, medicamento, dose_descricao, horarios,
                   inicio_em, fim_em, receita_tipo, receita_validade, observacoes)
                VALUES ({0}, {1}, {2}, {3}, {4}, {5}, {6}, {7}, {8}, {9})
                RETURNING id",
                req.PacienteId, medicoId, req.Medicamento, req.DoseDescricao, horariosArray,
                ToUtc(req.InicioEm) ?? DateTime.UtcNow.Date,
                (object?)ToUtc(req.FimEm) ?? DBNull.Value,
                (object?)req.ReceitaTipo ?? DBNull.Value,
                (object?)ToUtc(req.ReceitaValidade) ?? DBNull.Value,
                (object?)req.Observacoes ?? DBNull.Value);

            if (req.SubstituiPrescricaoId is Guid antigaId)
            {
                // Tenant: a prescrição trocada também tem de ser do médico logado.
                var medAntiga = await db.Database.ExecuteScalarAsync<string?>(@"
                    SELECT pr.medicamento FROM prescricoes pr
                    JOIN pacientes p ON p.cliente_id = pr.paciente_id
                    WHERE pr.id = {0} AND p.medico_responsavel_id = {1}", antigaId, medicoId.Value);
                await db.Database.ExecuteRawAsync(@"
                    UPDATE prescricoes pr SET ativa = FALSE, fim_em = CURRENT_DATE
                    FROM pacientes p
                    WHERE pr.id = {0} AND p.cliente_id = pr.paciente_id
                      AND p.medico_responsavel_id = {1}", antigaId, medicoId.Value);
                await GravarEvento(db, req.PacienteId, medicoId, prescricaoId,
                    "troca", req.Medicamento, medAntiga, req.Motivo);
            }
            else
            {
                await GravarEvento(db, req.PacienteId, medicoId, prescricaoId,
                    "adicao", req.Medicamento, null, req.Motivo);
            }

            return Results.Created($"/api/v1/prescricoes/{prescricaoId}", null);
        });

        // ---- editar (ajuste) ----
        g.MapPut("/{id:guid}", async (Guid id, [FromBody] EditarPrescricaoRequest req, AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await ResolveMedicoId(db, user);
            if (medicoId is null) return Results.Forbid();

            var horariosArray = req.Horarios.Select(h => TimeOnly.Parse(h)).ToArray();

            // Tenant: o UPDATE só afeta prescrição de paciente do médico logado.
            var linhas = await db.Database.ExecuteRawAsync(@"
                UPDATE prescricoes pr SET
                  medicamento = {1}, dose_descricao = {2}, horarios = {3},
                  inicio_em = {4}, fim_em = {5}, receita_tipo = {6},
                  receita_validade = {7}, observacoes = {8}
                FROM pacientes p
                WHERE pr.id = {0} AND pr.ativa = TRUE
                  AND p.cliente_id = pr.paciente_id AND p.medico_responsavel_id = {9}",
                id, req.Medicamento, req.DoseDescricao, horariosArray,
                ToUtc(req.InicioEm) ?? DateTime.UtcNow.Date,
                (object?)ToUtc(req.FimEm) ?? DBNull.Value,
                (object?)req.ReceitaTipo ?? DBNull.Value,
                (object?)ToUtc(req.ReceitaValidade) ?? DBNull.Value,
                (object?)req.Observacoes ?? DBNull.Value,
                medicoId.Value);

            if (linhas == 0) return Results.NotFound();

            var pacienteId = await db.Database.ExecuteScalarAsync<Guid>(
                "SELECT paciente_id FROM prescricoes WHERE id = {0}", id);
            await GravarEvento(db, pacienteId, medicoId, id, "ajuste", req.Medicamento, null, req.Motivo);

            return Results.NoContent();
        });

        // ---- desativar (remoção) ----
        g.MapPatch("/{id:guid}/desativar", async (Guid id, HttpRequest http, AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await ResolveMedicoId(db, user);
            if (medicoId is null) return Results.Forbid();

            string? motivo = null;
            if (http.ContentLength is > 0)
            {
                try
                {
                    var body = await http.ReadFromJsonAsync<DesativarPrescricaoRequest>();
                    motivo = body?.Motivo;
                }
                catch { /* sem corpo -> motivo null */ }
            }

            // Tenant: resolve a prescrição já ancorada no médico logado (JOIN pacientes).
            var pacienteId = await db.Database.ExecuteScalarAsync<Guid?>(@"
                SELECT pr.paciente_id FROM prescricoes pr
                JOIN pacientes p ON p.cliente_id = pr.paciente_id
                WHERE pr.id = {0} AND p.medico_responsavel_id = {1}", id, medicoId.Value);
            if (pacienteId is null) return Results.NotFound();
            var medicamento = await db.Database.ExecuteScalarAsync<string?>(
                "SELECT medicamento FROM prescricoes WHERE id = {0}", id);

            await db.Database.ExecuteRawAsync(@"
                UPDATE prescricoes pr SET ativa = FALSE, fim_em = CURRENT_DATE
                FROM pacientes p
                WHERE pr.id = {0} AND p.cliente_id = pr.paciente_id
                  AND p.medico_responsavel_id = {1}", id, medicoId.Value);

            await GravarEvento(db, pacienteId.Value, medicoId, id,
                "remocao", medicamento ?? "(medicamento)", null, motivo);

            return Results.NoContent();
        });
    }

    static async Task<Guid?> ResolveMedicoId(AppDbContext db, ClaimsPrincipal user)
    {
        var sub = user.FindFirst("sub")?.Value;
        if (!Guid.TryParse(sub, out var userId)) return null;
        return await db.Database.ExecuteScalarAsync<Guid?>(
            "SELECT id FROM medicos WHERE usuario_id = {0}", userId);
    }

    static async Task GravarEvento(
        AppDbContext db, Guid pacienteId, Guid? medicoId, Guid? prescricaoId,
        string tipo, string medicamento, string? medicamentoAnterior, string? motivo)
    {
        try
        {
            await db.Database.ExecuteRawAsync(@"
                INSERT INTO prescricao_eventos
                  (paciente_id, medico_id, prescricao_id, tipo, medicamento, medicamento_anterior, motivo)
                VALUES ({0}, {1}, {2}, {3}, {4}, {5}, {6})",
                pacienteId,
                (object?)medicoId ?? DBNull.Value,
                (object?)prescricaoId ?? DBNull.Value,
                tipo,
                medicamento,
                (object?)medicamentoAnterior ?? DBNull.Value,
                (object?)motivo ?? DBNull.Value);
        }
        catch (Exception ex)
        {
            // Evento e auditoria: nao deve derrubar o fluxo de prescricao.
            // Ex.: tabela ainda nao migrada no banco de destino.
            Console.Error.WriteLine($"[prescricao_eventos] falha ao gravar evento ({tipo}): {ex.Message}");
        }
    }
}

public record CriarPrescricaoRequest(
    Guid PacienteId,
    string Medicamento,
    string DoseDescricao,
    List<string> Horarios,
    DateTime? InicioEm,
    DateTime? FimEm,
    string? ReceitaTipo,
    DateTime? ReceitaValidade,
    string? Observacoes,
    string? Motivo = null,
    Guid? SubstituiPrescricaoId = null);

public record EditarPrescricaoRequest(
    string Medicamento,
    string DoseDescricao,
    List<string> Horarios,
    DateTime? InicioEm,
    DateTime? FimEm,
    string? ReceitaTipo,
    DateTime? ReceitaValidade,
    string? Observacoes,
    string? Motivo = null);

public record DesativarPrescricaoRequest(string? Motivo);

// Confirmação de rascunho MEMED: o médico informa os dados estruturados que o
// espelho não tinha (horários p/ lembrete, validade p/ renovação). ADR-056.
public record ConfirmarReceitaMemedRequest(
    List<string>? Horarios,
    DateTime? ReceitaValidade,
    DateTime? InicioEm,
    DateTime? FimEm,
    string? DoseDescricao);

public record ReceitaAConfirmarDto(
    Guid Id, Guid PacienteId, string Medicamento, string DoseDescricao,
    string? ReceitaTipo, DateTime CriadaEm);

public record PrescricaoDto(
    Guid Id, Guid PacienteId, string Medicamento, string DoseDescricao,
    TimeOnly[] Horarios, DateTime InicioEm, DateTime? FimEm,
    string? ReceitaTipo, DateTime? ReceitaValidade,
    string? Observacoes, bool Ativa, DateTime CriadaEm);

public record EventoPrescricaoDto(
    Guid Id, string Tipo, string Medicamento,
    string? MedicamentoAnterior, string? Motivo, DateTime CriadoEm);


// =============================================================================

/// <summary>
/// Notificações pro médico.
/// </summary>
public static class NotificacoesEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/notificacoes")
            .WithTags("notificacoes")
            .RequireAuthorization();

        g.MapGet("/", async (AppDbContext db, ClaimsPrincipal user,
            [FromQuery] bool apenasNaoLidas = true,
            [FromQuery] bool apenasLidas = false) =>
        {
            var sub = user.FindFirst("sub")?.Value;
            if (!Guid.TryParse(sub, out var userId)) return Results.Unauthorized();

            var medicoId = await db.Database.ExecuteScalarAsync<Guid?>(
                "SELECT id FROM medicos WHERE usuario_id = {0}", userId);
            if (medicoId is null) return Results.Forbid();

            string filtroLida;
            string orderBy;
            if (apenasLidas)
            {
                filtroLida = "AND n.lida = TRUE";
                orderBy = "n.lida_em DESC NULLS LAST, n.criada_em DESC";
            }
            else if (apenasNaoLidas)
            {
                filtroLida = "AND n.lida = FALSE";
                orderBy = @"CASE n.severidade
                       WHEN 'critico' THEN 1 WHEN 'urgente' THEN 2
                       WHEN 'atencao' THEN 3
                       WHEN 'critica' THEN 1 WHEN 'alta' THEN 2
                       WHEN 'media' THEN 3 ELSE 4 END,
                     n.criada_em DESC";
            }
            else
            {
                filtroLida = "";
                orderBy = "n.criada_em DESC";
            }

            var sql = $@"SELECT n.id, n.paciente_id, c.nome AS nome_paciente,
                          n.severidade, n.tipo, n.titulo, n.mensagem,
                          n.lida, n.criada_em
                   FROM notificacoes_medico n
                   JOIN clientes c ON c.id = n.paciente_id
                   WHERE n.medico_id = {{0}} {filtroLida}
                   ORDER BY {orderBy}
                   LIMIT 100";

            var rows = await db.Database.SqlQueryRaw<NotificacaoDto>(sql, medicoId)
                .ToListAsync();
            return Results.Ok(rows);
        });

        g.MapPost("/{id:guid}/marcar-lida", async (Guid id, AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await ResolveMedicoIdNotif(db, user);
            if (medicoId is null) return Results.Forbid();
            // Tenant: só altera notificação do próprio médico.
            await db.Database.ExecuteRawAsync(
                "UPDATE notificacoes_medico SET lida = TRUE, lida_em = NOW() WHERE id = {0} AND medico_id = {1}",
                id, medicoId.Value);
            return Results.NoContent();
        });

        g.MapPost("/{id:guid}/marcar-nao-lida", async (Guid id, AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await ResolveMedicoIdNotif(db, user);
            if (medicoId is null) return Results.Forbid();
            // Tenant: só altera notificação do próprio médico.
            await db.Database.ExecuteRawAsync(
                "UPDATE notificacoes_medico SET lida = FALSE, lida_em = NULL WHERE id = {0} AND medico_id = {1}",
                id, medicoId.Value);
            return Results.NoContent();
        });
    }

    static async Task<Guid?> ResolveMedicoIdNotif(AppDbContext db, ClaimsPrincipal user)
    {
        var sub = user.FindFirst("sub")?.Value;
        if (!Guid.TryParse(sub, out var userId)) return null;
        return await db.Database.ExecuteScalarAsync<Guid?>(
            "SELECT id FROM medicos WHERE usuario_id = {0}", userId);
    }
}

public record NotificacaoDto(
    Guid Id, Guid PacienteId, string? NomePaciente,
    string Severidade, string Tipo, string Titulo, string Mensagem,
    bool Lida, DateTime CriadaEm);
