using ApiGateway.Auth;
using ApiGateway.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using System.Text.Json;

namespace ApiGateway.Endpoints;

/// <summary>
/// Conduta de automação por paciente — override OPERACIONAL sobre os defaults
/// globais (medicação por prescricoes.horarios, questionário fixo 2ª/5ª).
///
/// clinical-safety: regras administrativas/organizacionais. A IA não decide
/// nada clínico — o médico é quem autora a regra. Consumido pelo agents-py, que
/// respeita automacao_pausada + SHADOW_MODE antes de agir.
///
/// Tenant = médico logado (JOIN pacientes.medico_responsavel_id). Mudanças são
/// auditadas em condutas_eventos (append-only).
/// </summary>
public static class CondutasEndpoints
{
    private static readonly string[] Tipos =
        { "checkin_humor", "lembrete_medicacao", "questionario", "alerta_nao_adesao" };

    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1").WithTags("condutas")
            .RequireAuthorization()
            .RequireAssinaturaAtiva()  // ADR-065: estava SEM gate (escrevia até vencido) — fecha o buraco
            .RequireWriteAccess();     // ADR-065: trial read-only bloqueia escrita de conduta

        // Condutas ativas de um paciente.
        g.MapGet("/pacientes/{pacienteId:guid}/condutas", async (
            Guid pacienteId, AppDbContext db, ClaimsPrincipal user) =>
        {
            if (!await PacienteEhDoMedico(db, pacienteId, user)) return Results.Forbid();

            var rows = await db.Database.SqlQueryRaw<CondutaDto>(@"
                SELECT id, paciente_id, tipo, config::text AS config, ativa, atualizado_em
                FROM condutas_automacao
                WHERE paciente_id = {0} AND ativa = TRUE
                ORDER BY tipo",
                pacienteId).ToListAsync();
            return Results.Ok(rows);
        });

        // Cria/atualiza a conduta ativa de um tipo (upsert). Auditado.
        g.MapPost("/pacientes/{pacienteId:guid}/condutas", async (
            Guid pacienteId, [FromBody] CondutaUpsertRequest req,
            AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();
            if (!await db.Database.ExistsAsync(
                "SELECT 1 FROM pacientes WHERE cliente_id = {0} AND medico_responsavel_id = {1}",
                pacienteId, medicoId.Value)) return Results.Forbid();

            var tipo = (req.Tipo ?? "").ToLowerInvariant();
            if (!Tipos.Contains(tipo))
                return Results.BadRequest(new { erro = "tipo de conduta inválido" });

            var configJson = req.Config.HasValue ? req.Config.Value.GetRawText() : "{}";
            var criadoPor = Guid.TryParse(user.FindFirst("sub")?.Value, out var uid)
                ? uid.ToString() : "";

            var condutaId = await db.Database.ExecuteScalarAsync<Guid>(@"
                INSERT INTO condutas_automacao
                    (paciente_id, medico_id, tipo, config, ativa, criado_por)
                VALUES ({0}, {1}, {2}, {3}::jsonb, TRUE, NULLIF({4}, '')::uuid)
                ON CONFLICT (paciente_id, tipo) WHERE ativa
                DO UPDATE SET config = EXCLUDED.config, atualizado_em = NOW()
                RETURNING id",
                pacienteId, medicoId.Value, tipo, configJson, criadoPor);

            await db.Database.ExecuteSqlRawAsync(@"
                INSERT INTO condutas_eventos (conduta_id, paciente_id, medico_id, acao, config)
                VALUES ({0}, {1}, {2}, 'configurada', {3}::jsonb)",
                condutaId, pacienteId, medicoId.Value, configJson);

            return Results.Ok(new { id = condutaId });
        });

        // Atualiza/desativa uma conduta. Auditado.
        g.MapPatch("/condutas/{condutaId:guid}", async (
            Guid condutaId, [FromBody] CondutaPatchRequest req,
            AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            var configJson = req.Config?.GetRawText() ?? "";
            var ativaStr = req.Ativa.HasValue ? (req.Ativa.Value ? "true" : "false") : "";
            var afetadas = await db.Database.ExecuteSqlRawAsync(@"
                UPDATE condutas_automacao c SET
                    config = COALESCE(NULLIF({2}, '')::jsonb, c.config),
                    ativa  = COALESCE(NULLIF({3}, '')::boolean, c.ativa),
                    atualizado_em = NOW()
                FROM pacientes p
                WHERE c.id = {0} AND p.cliente_id = c.paciente_id
                  AND p.medico_responsavel_id = {1}",
                condutaId, medicoId.Value, configJson, ativaStr);
            if (afetadas == 0) return Results.NotFound();

            var acao = req.Ativa == false ? "desativada" : "configurada";
            await db.Database.ExecuteSqlRawAsync(@"
                INSERT INTO condutas_eventos (conduta_id, paciente_id, medico_id, acao, config)
                SELECT c.id, c.paciente_id, c.medico_id, {2}, c.config
                FROM condutas_automacao c
                JOIN pacientes p ON p.cliente_id = c.paciente_id
                WHERE c.id = {0} AND p.medico_responsavel_id = {1}",
                condutaId, medicoId.Value, acao);

            return Results.NoContent();
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

public record CondutaDto(
    Guid Id, Guid PacienteId, string Tipo, string Config, bool Ativa, DateTime AtualizadoEm);

public record CondutaUpsertRequest(string Tipo, JsonElement? Config);

public record CondutaPatchRequest(JsonElement? Config, bool? Ativa);
