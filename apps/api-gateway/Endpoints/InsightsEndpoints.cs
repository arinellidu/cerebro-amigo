using ApiGateway.Auth;
using ApiGateway.Data;
using ApiGateway.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace ApiGateway.Endpoints;

/// <summary>
/// Endpoints pra ler insights gerados pelos agentes analíticos.
///
/// Insights são consumidos no dashboard do médico — visão geral, página do paciente,
/// e timeline pré-consulta.
/// </summary>
public static class InsightsEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/insights")
            .WithTags("insights")
            .RequireAuthorization()
            .RequireAssinaturaAtiva()  // ADR-055 Fase D: gate de assinatura (dashboard)
            .RequireFeature(FeatureKeys.IaInsights) // ADR-059: insights dos agentes = camada IA (Pro)
            .RequireWriteAccess();     // ADR-065: defesa extra (a IA já bloqueia o trial pelo FeatureGate)

        // Lista insights pendentes (não vistos, não descartados, ainda válidos)
        g.MapGet("/pendentes", async (AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            var rows = await db.Database.SqlQueryRaw<InsightDto>(@"
                SELECT i.id, i.paciente_id, c.nome AS nome_paciente,
                       i.agente, i.titulo, i.conteudo,
                       i.severidade, i.criado_em
                FROM insights i
                JOIN clientes c ON c.id = i.paciente_id
                WHERE i.medico_id = {0}
                  AND i.descartado_em IS NULL
                  AND i.visualizado_em IS NULL
                  AND (i.valido_ate IS NULL OR i.valido_ate > NOW())
                ORDER BY
                  -- severidade no vocabulário dos agentes: critica|alta|media|baixa|info
                  CASE i.severidade
                    WHEN 'critica' THEN 1 WHEN 'alta' THEN 2
                    WHEN 'media' THEN 3 WHEN 'baixa' THEN 4 ELSE 5 END,
                  i.criado_em DESC
                LIMIT 50",
                medicoId).ToListAsync();
            return Results.Ok(rows);
        });

        // Lista todos os insights de um paciente
        g.MapGet("/paciente/{pacienteId:guid}", async (
            Guid pacienteId, AppDbContext db, ClaimsPrincipal user,
            [FromQuery] string? agente = null) =>
        {
            if (!await PacienteEhDoMedico(db, pacienteId, user)) return Results.Forbid();

            var sql = string.IsNullOrEmpty(agente)
                ? @"SELECT id, paciente_id, NULL AS nome_paciente,
                          agente, titulo, conteudo,
                          severidade, criado_em
                   FROM insights
                   WHERE paciente_id = {0} AND descartado_em IS NULL
                   ORDER BY criado_em DESC LIMIT 50"
                : @"SELECT id, paciente_id, NULL AS nome_paciente,
                          agente, titulo, conteudo,
                          severidade, criado_em
                   FROM insights
                   WHERE paciente_id = {0} AND agente = {1} AND descartado_em IS NULL
                   ORDER BY criado_em DESC LIMIT 50";

            var rows = string.IsNullOrEmpty(agente)
                ? await db.Database.SqlQueryRaw<InsightDto>(sql, pacienteId).ToListAsync()
                : await db.Database.SqlQueryRaw<InsightDto>(sql, pacienteId, agente).ToListAsync();
            return Results.Ok(rows);
        });

        // Marcar como visualizado (escopado ao médico dono do insight — tenant não é opcional)
        g.MapPost("/{id:guid}/visualizar", async (Guid id, AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            await db.Database.ExecuteSqlRawAsync(
                "UPDATE insights SET visualizado_em = NOW() WHERE id = {0} AND medico_id = {1} AND visualizado_em IS NULL",
                id, medicoId.Value);
            return Results.NoContent();
        });

        // Descartar (não foi útil ou já agi) — escopado ao médico dono do insight
        g.MapPost("/{id:guid}/descartar", async (
            Guid id, [FromBody] DescartarRequest req, AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            await db.Database.ExecuteSqlRawAsync(@"
                UPDATE insights SET descartado_em = NOW(), descartado_motivo = NULLIF({0}, '')
                WHERE id = {1} AND medico_id = {2}", req.Motivo ?? "", id, medicoId.Value);
            return Results.NoContent();
        });

        // Resumo pré-consulta específico (mais usado no fluxo do médico)
        g.MapGet("/resumo-pre-consulta/{pacienteId:guid}", async (
            Guid pacienteId, AppDbContext db, ClaimsPrincipal user) =>
        {
            if (!await PacienteEhDoMedico(db, pacienteId, user)) return Results.Forbid();

            var ins = await db.Database.SqlQueryRaw<InsightDto>(@"
                SELECT id, paciente_id, NULL AS nome_paciente,
                       agente, titulo, conteudo,
                       severidade, criado_em
                FROM insights
                WHERE paciente_id = {0} AND agente = 'resumo_pre_consulta'
                  AND descartado_em IS NULL
                  AND (valido_ate IS NULL OR valido_ate > NOW())
                ORDER BY criado_em DESC LIMIT 1",
                pacienteId).FirstOrDefaultAsync();

            return ins is null ? Results.NotFound() : Results.Ok(ins);
        });
    }

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

public record InsightDto(
    Guid Id, Guid PacienteId, string? NomePaciente,
    string Agente, string Titulo, string Conteudo,
    string Severidade, DateTime CriadoEm);

public record DescartarRequest(string? Motivo);
