using ApiGateway.Auth;
using ApiGateway.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace ApiGateway.Endpoints;

/// <summary>
/// Medicações EM USO (reconciliação medicamentosa, ADR-062). REGISTRO do que o paciente
/// já toma — de qualquer prescritor. NÃO é receita (prescrição legal = só MEMED, ADR-056).
/// A IA não preenche nem sugere (clinical-safety #1): o médico anota. Tenant: o paciente é
/// validado por JOIN pacientes (medico_responsavel_id) — defesa em profundidade junto da RLS.
/// </summary>
public static class MedicacoesEmUsoEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/medicacoes-em-uso")
            .WithTags("medicacoes-em-uso")
            .RequireAuthorization()
            .RequireAssinaturaAtiva()  // ADR-055 Fase D: gate de assinatura (dashboard)
            .RequireWriteAccess();     // ADR-065: trial read-only bloqueia escrita (exceto pacientes)

        // Lista as medicações em uso (ativas) do paciente.
        g.MapGet("/paciente/{pacienteId:guid}", async (Guid pacienteId, AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await ResolveMedicoId(db, user);
            if (medicoId is null) return Results.Forbid();

            var rows = await db.Database.SqlQueryRaw<MedicacaoEmUsoDto>(@"
                SELECT m.id, m.medicamento, m.generico, m.classe, m.posologia,
                       m.fonte, m.observacoes, m.criado_em
                FROM medicacoes_em_uso m
                JOIN pacientes p ON p.cliente_id = m.paciente_id
                WHERE m.paciente_id = {0} AND m.ativa = TRUE
                  AND p.medico_responsavel_id = {1}
                ORDER BY m.criado_em DESC", pacienteId, medicoId.Value).ToListAsync();
            return Results.Ok(rows);
        });

        // Registra uma medicação em uso. medicamento = nome (do catálogo OU texto livre).
        g.MapPost("/paciente/{pacienteId:guid}", async (
            Guid pacienteId, [FromBody] RegistrarMedicacaoRequest req, AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await ResolveMedicoId(db, user);
            if (medicoId is null) return Results.Forbid();

            var medicamento = (req?.Medicamento ?? "").Trim();
            if (medicamento.Length == 0) return Results.BadRequest(new { error = "medicamento_obrigatorio" });

            // Tenant: o paciente tem de ser do médico logado (a RLS reforça no INSERT).
            var doMedico = await db.Database.ExecuteScalarAsync<bool?>(@"
                SELECT TRUE FROM pacientes WHERE cliente_id = {0} AND medico_responsavel_id = {1}",
                pacienteId, medicoId.Value);
            if (doMedico != true) return Results.Forbid();

            var id = Guid.NewGuid();
            await db.Database.ExecuteRawAsync(@"
                INSERT INTO medicacoes_em_uso
                    (id, paciente_id, medico_id, medicamento, generico, classe, posologia, fonte, observacoes)
                VALUES ({0}, {1}, {2}, {3}, {4}, {5}, {6}, {7}, {8})",
                id, pacienteId, medicoId.Value, medicamento,
                (object?)req?.Generico ?? DBNull.Value,
                (object?)req?.Classe ?? DBNull.Value,
                (object?)req?.Posologia ?? DBNull.Value,
                (object?)req?.Fonte ?? DBNull.Value,
                (object?)req?.Observacoes ?? DBNull.Value);

            return Results.Created($"/api/v1/medicacoes-em-uso/{id}", new { id });
        });

        // Remove (desativa) uma medicação em uso. Soft-delete: mantém histórico.
        g.MapPost("/{id:guid}/remover", async (Guid id, AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await ResolveMedicoId(db, user);
            if (medicoId is null) return Results.Forbid();

            var afetadas = await db.Database.ExecuteRawAsync(@"
                UPDATE medicacoes_em_uso m SET ativa = FALSE, atualizado_em = NOW()
                FROM pacientes p
                WHERE m.id = {0} AND m.ativa = TRUE
                  AND p.cliente_id = m.paciente_id AND p.medico_responsavel_id = {1}",
                id, medicoId.Value);
            return afetadas == 0 ? Results.NotFound() : Results.NoContent();
        });
    }

    private static async Task<Guid?> ResolveMedicoId(AppDbContext db, ClaimsPrincipal user)
    {
        var sub = user.FindFirst("sub")?.Value;
        if (!Guid.TryParse(sub, out var userId)) return null;
        return await db.Database.ExecuteScalarAsync<Guid?>(
            "SELECT id FROM medicos WHERE usuario_id = {0}", userId);
    }
}

public record MedicacaoEmUsoDto(
    Guid Id, string Medicamento, string? Generico, string? Classe,
    string? Posologia, string? Fonte, string? Observacoes, DateTime CriadoEm);

public record RegistrarMedicacaoRequest(
    string? Medicamento, string? Generico, string? Classe,
    string? Posologia, string? Fonte, string? Observacoes);
