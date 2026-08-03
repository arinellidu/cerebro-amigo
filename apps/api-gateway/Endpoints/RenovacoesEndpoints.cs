using ApiGateway.Auth;
using ApiGateway.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace ApiGateway.Endpoints;

/// <summary>
/// Renovação de receita de controle especial (A4, ADR-032). A FILA é gerada pelo
/// job determinístico do agents-py (gerador_renovacao_receita) a partir das
/// prescrições ativas com validade próxima; o gateway só LISTA e resolve (médico
/// reemite via MEMED e marca como renovada/dispensada). A IA não decide renovar.
/// Tenant: JOIN pacientes.medico_responsavel_id (1ª cláusula).
/// </summary>
public static class RenovacoesEndpoints
{
    public static void Map(WebApplication app)
    {
        // Fila de renovações de um médico (default: pendentes, por vencimento).
        app.MapGet("/api/v1/renovacoes", async (
            [FromQuery] string? status, AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            var st = string.IsNullOrWhiteSpace(status) ? "pendente" : status;

            var rows = await db.Database.SqlQueryRaw<RenovacaoItem>(@"
                SELECT rr.id, rr.medicamento, rr.receita_tipo, rr.vence_em, rr.status,
                       (rr.vence_em - CURRENT_DATE) AS dias_para_vencer,
                       rr.paciente_id, c.nome AS paciente_nome, rr.prescricao_id
                FROM receita_renovacoes rr
                JOIN pacientes p ON p.cliente_id = rr.paciente_id
                JOIN clientes c ON c.id = rr.paciente_id
                WHERE p.medico_responsavel_id = {0} AND rr.status = {1}
                ORDER BY rr.vence_em",
                medicoId.Value, st).ToListAsync();

            return Results.Ok(rows);
        })
        .WithTags("renovacoes")
        .RequireAuthorization();

        var g = app.MapGroup("/api/v1/renovacoes/{id:guid}")
            .WithTags("renovacoes")
            .RequireAuthorization()
            .RequireAssinaturaAtiva()  // ADR-065: marcar renovada/dispensar = escrita operacional
            .RequireWriteAccess();     // trial read-only bloqueia; vencido cai no paywall

        // Médico reemitiu a receita (via MEMED) → marca renovada.
        g.MapPost("/renovada", (Guid id, AppDbContext db, ClaimsPrincipal user) =>
            ResolverAsync(id, "renovada", db, user));

        // Médico decidiu não renovar (ex.: medicação suspensa) → dispensa.
        g.MapPost("/dispensar", (Guid id, AppDbContext db, ClaimsPrincipal user) =>
            ResolverAsync(id, "dispensada", db, user));
    }

    private static async Task<IResult> ResolverAsync(
        Guid id, string novoStatus, AppDbContext db, ClaimsPrincipal user)
    {
        var medicoId = await GetMedicoIdAsync(db, user);
        if (medicoId is null) return Results.Forbid();

        var afetadas = await db.Database.ExecuteSqlRawAsync(@"
            UPDATE receita_renovacoes SET
                status = {2}, resolvido_em = NOW(), resolvido_por = {1}, atualizado_em = NOW()
            WHERE id = {0} AND status = 'pendente'
              AND paciente_id IN (
                  SELECT cliente_id FROM pacientes WHERE medico_responsavel_id = {1}
              )",
            id, medicoId.Value, novoStatus);

        return afetadas == 0 ? Results.NotFound() : Results.NoContent();
    }

    private static async Task<Guid?> GetMedicoIdAsync(AppDbContext db, ClaimsPrincipal user)
    {
        var sub = user.FindFirst("sub")?.Value;
        if (!Guid.TryParse(sub, out var userId)) return null;
        return await db.Database.ExecuteScalarAsync<Guid?>(
            "SELECT id FROM medicos WHERE usuario_id = {0}", userId);
    }
}

public record RenovacaoItem(
    Guid Id, string Medicamento, string? ReceitaTipo, DateOnly VenceEm, string Status,
    int DiasParaVencer, Guid PacienteId, string? PacienteNome, Guid PrescricaoId);
