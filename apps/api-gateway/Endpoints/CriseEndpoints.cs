using ApiGateway.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace ApiGateway.Endpoints;

/// <summary>
/// Loop fechado de crise para o médico.
///
/// O protocolo de crise é acionado pelo orchestrator-py (texto fixo de
/// crisis_copy, pausa de automação via pacientes.automacao_pausada, notificação).
/// Aqui o gateway apenas:
///   - LÊ a trilha imutável (protocolos_crise_acionados) — nunca UPDATE/DELETE;
///   - deixa o médico RETOMAR a automação do paciente (limpa automacao_pausada e
///     reabre conversas pausadas), registrando o ato em notificacoes_medico.
///
/// clinical-safety #2 e #5: não geramos texto de crise nem editamos a trilha de
/// auditoria. Tenant = médico logado (sempre JOIN pacientes.medico_responsavel_id).
/// </summary>
public static class CriseEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/crise")
            .WithTags("crise")
            .RequireAuthorization();

        // Pacientes do médico com automação pausada (crise ativa aguardando ação).
        g.MapGet("/ativas", async (AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            var rows = await db.Database.SqlQueryRaw<CriseAtivaDto>(@"
                SELECT p.cliente_id AS paciente_id, cl.nome AS paciente_nome,
                       pc.gatilho, pc.origem, pc.criado_em AS acionado_em,
                       pc.medico_notificado_em,
                       COALESCE(ack.confirmada, FALSE) AS confirmada
                FROM pacientes p
                JOIN clientes cl ON cl.id = p.cliente_id
                LEFT JOIN LATERAL (
                    SELECT id, gatilho, origem, criado_em, medico_notificado_em
                    FROM protocolos_crise_acionados
                    WHERE paciente_id = p.cliente_id
                    ORDER BY criado_em DESC
                    LIMIT 1
                ) pc ON TRUE
                LEFT JOIN LATERAL (
                    SELECT TRUE AS confirmada
                    FROM crise_alerta_eventos e
                    WHERE e.protocolo_id = pc.id AND e.evento = 'confirmado'
                    LIMIT 1
                ) ack ON TRUE
                WHERE p.medico_responsavel_id = {0}
                  AND p.automacao_pausada = TRUE
                ORDER BY pc.criado_em DESC NULLS LAST",
                medicoId.Value).ToListAsync();

            return Results.Ok(rows);
        });

        // Detalhe da última crise de um paciente (read-only). Exibe o copy fixo enviado.
        g.MapGet("/{pacienteId:guid}", async (
            Guid pacienteId, AppDbContext db, ClaimsPrincipal user) =>
        {
            if (!await PacienteEhDoMedico(db, pacienteId, user)) return Results.Forbid();

            var det = await db.Database.SqlQueryRaw<CriseDetalheDto>(@"
                SELECT pc.paciente_id, pc.gatilho, pc.confianca, pc.origem,
                       pc.resposta_enviada, pc.medico_notificado, pc.medico_notificado_em,
                       pc.criado_em AS acionado_em, p.automacao_pausada
                FROM protocolos_crise_acionados pc
                JOIN pacientes p ON p.cliente_id = pc.paciente_id
                WHERE pc.paciente_id = {0}
                ORDER BY pc.criado_em DESC
                LIMIT 1",
                pacienteId).FirstOrDefaultAsync();

            return det is null ? Results.NotFound() : Results.Ok(det);
        });

        // Médico retoma a automação do paciente. Ato auditado em notificacoes_medico.
        // NUNCA toca em protocolos_crise_acionados (append-only).
        g.MapPost("/{pacienteId:guid}/retomar", async (
            Guid pacienteId, [FromBody] RetomarCriseRequest? req,
            AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            var ehDoMedico = await db.Database.ExistsAsync(
                "SELECT 1 FROM pacientes WHERE cliente_id = {0} AND medico_responsavel_id = {1}",
                pacienteId, medicoId.Value);
            if (!ehDoMedico) return Results.Forbid();

            // Limpa o circuit-breaker (escopado ao tenant).
            var afetadas = await db.Database.ExecuteSqlRawAsync(
                "UPDATE pacientes SET automacao_pausada = FALSE WHERE cliente_id = {0} AND medico_responsavel_id = {1}",
                pacienteId, medicoId.Value);
            if (afetadas == 0) return Results.NotFound();

            // Reabre conversas que a crise/escalada deixou em atendimento humano.
            await db.Database.ExecuteSqlRawAsync(
                "UPDATE conversas SET status = 'aberta' WHERE cliente_id = {0} AND status = 'humano'",
                pacienteId);

            // Auditoria do ato — INSERT é permitido pelo guard append-only (0007).
            var obs = string.IsNullOrWhiteSpace(req?.Observacao) ? "" : $" Obs.: {req!.Observacao}";
            await db.Database.ExecuteSqlRawAsync(@"
                INSERT INTO notificacoes_medico
                    (medico_id, paciente_id, severidade, tipo, titulo, mensagem)
                VALUES ({0}, {1}, 'info', 'automacao_retomada', 'Automação retomada', {2})",
                medicoId.Value, pacienteId,
                "O médico retomou a automação do paciente após avaliar a crise." + obs);

            // Retomar implica ciência: encerra a escada de escalonamento (ADR-041).
            await AckCrisesAbertasAsync(db, pacienteId, medicoId.Value, "retomar");

            return Results.NoContent();
        });

        // Médico confirma ciência da crise (ack) sem necessariamente retomar a
        // automação. Encerra a escada de escalonamento do notifier (ADR-041).
        // INSERT append-only em crise_alerta_eventos; não toca a trilha imutável.
        g.MapPost("/{pacienteId:guid}/ciente", async (
            Guid pacienteId, AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            var ehDoMedico = await db.Database.ExistsAsync(
                "SELECT 1 FROM pacientes WHERE cliente_id = {0} AND medico_responsavel_id = {1}",
                pacienteId, medicoId.Value);
            if (!ehDoMedico) return Results.Forbid();

            var confirmadas = await AckCrisesAbertasAsync(
                db, pacienteId, medicoId.Value, "ack_dashboard");
            return Results.Ok(new { confirmadas });
        });
    }

    // Marca como confirmadas todas as crises abertas (sem ack) do paciente nas
    // últimas 48h. Idempotente (NOT EXISTS evita ack duplicado). Append-only.
    private static Task<int> AckCrisesAbertasAsync(
        AppDbContext db, Guid pacienteId, Guid medicoId, string via) =>
        db.Database.ExecuteSqlRawAsync(@"
            INSERT INTO crise_alerta_eventos
                (protocolo_id, medico_id, canal, evento, estagio, detalhe)
            SELECT pc.id, {1}, 'in_app', 'confirmado', 0, {2}
            FROM protocolos_crise_acionados pc
            WHERE pc.paciente_id = {0}
              AND pc.criado_em > NOW() - INTERVAL '48 hours'
              AND NOT EXISTS (
                  SELECT 1 FROM crise_alerta_eventos e
                  WHERE e.protocolo_id = pc.id AND e.evento = 'confirmado')",
            pacienteId, medicoId, via);

    private static async Task<Guid?> GetMedicoIdAsync(AppDbContext db, ClaimsPrincipal user)
    {
        var sub = user.FindFirst("sub")?.Value;
        if (!Guid.TryParse(sub, out var userId)) return null;
        return await db.Database.ExecuteScalarAsync<Guid?>(
            "SELECT id FROM medicos WHERE usuario_id = {0}", userId);
    }

    private static async Task<bool> PacienteEhDoMedico(AppDbContext db, Guid pid, ClaimsPrincipal user)
    {
        var medicoId = await GetMedicoIdAsync(db, user);
        if (medicoId is null) return false;
        return await db.Database.ExistsAsync(
            "SELECT 1 FROM pacientes WHERE cliente_id = {0} AND medico_responsavel_id = {1}",
            pid, medicoId.Value);
    }
}

public record CriseAtivaDto(
    Guid PacienteId, string? PacienteNome, string? Gatilho, string? Origem,
    DateTime? AcionadoEm, DateTime? MedicoNotificadoEm, bool Confirmada);

public record CriseDetalheDto(
    Guid PacienteId, string Gatilho, double Confianca, string Origem,
    string? RespostaEnviada, bool MedicoNotificado, DateTime? MedicoNotificadoEm,
    DateTime AcionadoEm, bool AutomacaoPausada);

public record RetomarCriseRequest(string? Observacao);
