using ApiGateway.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Globalization;
using System.Security.Claims;

namespace ApiGateway.Endpoints;

/// <summary>
/// Self-booking do paciente. O paciente vê e agenda as PRÓPRIAS consultas,
/// sempre com o seu médico responsável (tenant implícito). Toda consulta que
/// ele cria nasce 'agendada' (pendente) — o médico confirma no dashboard
/// (regra clínica: médico no loop). Conteúdo 100% administrativo, sem IA.
///
/// Disponibilidade e conflito reaproveitam <see cref="ConsultasEndpoints"/>
/// (mesma lógica de slots usada pelo médico), garantindo que o paciente só
/// agenda em horário realmente oferecido e livre.
/// </summary>
public static class PortalAgendaEndpoints
{
    private static readonly string[] Modalidades = { "presencial", "teleconsulta" };

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/portal/paciente/agenda")
            .WithTags("portal-paciente-agenda")
            .RequireAuthorization("paciente");

        // Minhas consultas (futuras + recentes).
        g.MapGet("/", async (AppDbContext db, ClaimsPrincipal user) =>
        {
            var pid = PacienteAuthEndpoints.GetPacienteId(user);
            if (pid is null) return Results.Unauthorized();

            var rows = await db.Database.SqlQueryRaw<PortalConsultaItem>(@"
                SELECT id, inicia_em, duracao_min, modalidade, status
                FROM consultas
                WHERE paciente_id = {0}
                  AND inicia_em > NOW() - INTERVAL '30 days'
                ORDER BY inicia_em DESC
                LIMIT 50", pid.Value).ToListAsync();

            return Results.Ok(rows);
        });

        // Slots livres do meu médico num dia (YYYY-MM-DD).
        g.MapGet("/disponibilidade", async (
            AppDbContext db, ClaimsPrincipal user, [FromQuery] string? data) =>
        {
            var pid = PacienteAuthEndpoints.GetPacienteId(user);
            if (pid is null) return Results.Unauthorized();
            if (!DateOnly.TryParse(data, out var dia))
                return Results.BadRequest(new { erro = "data inválida (use YYYY-MM-DD)" });

            var medicoId = await MedicoDoPacienteAsync(db, pid.Value);
            if (medicoId is null) return Results.Forbid();

            var disp = await ConsultasEndpoints.CalcularDisponibilidadeAsync(db, medicoId.Value, dia);
            return Results.Ok(disp);
        });

        // Agendar (nasce 'agendada' = pendente de confirmação do médico).
        g.MapPost("/", async (
            [FromBody] PortalAgendarRequest req, AppDbContext db, ClaimsPrincipal user) =>
        {
            var pid = PacienteAuthEndpoints.GetPacienteId(user);
            if (pid is null) return Results.Unauthorized();

            var medicoId = await MedicoDoPacienteAsync(db, pid.Value);
            if (medicoId is null) return Results.Forbid();

            var modalidade = (req.Modalidade ?? "teleconsulta").ToLowerInvariant();
            if (!Modalidades.Contains(modalidade))
                return Results.BadRequest(new { erro = "modalidade inválida" });

            var reqUtc = req.IniciaEm.ToUniversalTime();
            if (reqUtc <= DateTime.UtcNow)
                return Results.BadRequest(new { erro = "horario_no_passado" });

            // Recalcula o dia local do médico p/ revalidar contra os slots oferecidos.
            var tzName = await db.Database.ExecuteScalarAsync<string?>(
                "SELECT timezone FROM medicos WHERE id = {0}", medicoId.Value);
            var tz = ResolveTz(tzName);
            var diaLocal = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(reqUtc, tz));

            var disp = await ConsultasEndpoints.CalcularDisponibilidadeAsync(db, medicoId.Value, diaLocal);
            var ehSlotValido = disp.Slots.Any(s =>
                DateTime.Parse(s, null, DateTimeStyles.RoundtripKind).ToUniversalTime() == reqUtc);
            if (!ehSlotValido)
                return Results.Conflict(new { erro = "horario_indisponivel" });

            // Dupla checagem de conflito (corrida com outra reserva).
            if (await ConsultasEndpoints.TemConflitoAsync(db, medicoId.Value, reqUtc, disp.DuracaoMin, Guid.Empty))
                return Results.Conflict(new { erro = "horario_ocupado" });

            var novoId = await db.Database.ExecuteScalarAsync<Guid>(@"
                INSERT INTO consultas (paciente_id, medico_id, inicia_em, duracao_min, modalidade, status)
                VALUES ({0}, {1}, {2}, {3}, {4}, 'agendada')
                RETURNING id",
                pid.Value, medicoId.Value, reqUtc, disp.DuracaoMin, modalidade);

            await db.Database.ExecuteSqlRawAsync(
                "INSERT INTO acessos_paciente (paciente_id, acao) VALUES ({0}, 'consulta_agendada')",
                pid.Value);

            return Results.Created($"/api/v1/portal/paciente/agenda/{novoId}", new { id = novoId });
        });

        // Cancelar a própria consulta futura.
        g.MapPatch("/{id:guid}/cancelar", async (Guid id, AppDbContext db, ClaimsPrincipal user) =>
        {
            var pid = PacienteAuthEndpoints.GetPacienteId(user);
            if (pid is null) return Results.Unauthorized();

            var afetadas = await db.Database.ExecuteSqlRawAsync(@"
                UPDATE consultas SET status = 'cancelada'
                WHERE id = {0} AND paciente_id = {1}
                  AND inicia_em > NOW() AND status IN ('agendada', 'confirmada')",
                id, pid.Value);
            if (afetadas == 0) return Results.NotFound();

            await db.Database.ExecuteSqlRawAsync(
                "INSERT INTO acessos_paciente (paciente_id, acao) VALUES ({0}, 'consulta_cancelada')",
                pid.Value);

            return Results.NoContent();
        });
    }

    private static async Task<Guid?> MedicoDoPacienteAsync(AppDbContext db, Guid pacienteId) =>
        await db.Database.ExecuteScalarAsync<Guid?>(
            "SELECT medico_responsavel_id FROM pacientes WHERE cliente_id = {0}", pacienteId);

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
}

public record PortalConsultaItem(
    Guid Id, DateTime IniciaEm, int DuracaoMin, string Modalidade, string Status);

public record PortalAgendarRequest(DateTime IniciaEm, string? Modalidade);
