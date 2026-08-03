using ApiGateway.Data;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace ApiGateway.Endpoints;

/// <summary>
/// Fila de escalação humana. Quando o auditor bloqueia uma resposta ou a crise
/// é acionada, a conversa fica com status='humano' (orchestrator-py). Aqui o
/// médico vê essas conversas e pode assumir (devolver ao fluxo).
///
/// clinical-safety #4: o humano é o loop. Não logamos conteúdo de conversa —
/// só metadados (paciente, motivo, quando).
/// </summary>
public static class EscalacaoEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/escalacoes").WithTags("escalacoes").RequireAuthorization();

        // Conversas escaladas para atendimento humano (status='humano').
        g.MapGet("/", async (AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            var rows = await db.Database.SqlQueryRaw<EscalacaoDto>(@"
                SELECT co.id AS conversa_id, cl.id AS paciente_id, cl.nome AS paciente_nome,
                       co.status, co.criada_em,
                       (SELECT MAX(m.criada_em) FROM mensagens m WHERE m.conversa_id = co.id) AS ultima_em,
                       (SELECT n.titulo FROM notificacoes_medico n
                        WHERE n.paciente_id = cl.id AND n.tipo IN ('escalada_auditor','crise')
                        ORDER BY n.criada_em DESC LIMIT 1) AS motivo
                FROM conversas co
                JOIN clientes cl ON cl.id = co.cliente_id
                JOIN pacientes p ON p.cliente_id = co.cliente_id
                WHERE p.medico_responsavel_id = {0} AND co.status = 'humano'
                ORDER BY co.criada_em DESC",
                medicoId.Value).ToListAsync();

            return Results.Ok(rows);
        });

        // Médico assume a conversa e a devolve ao fluxo (status='aberta').
        g.MapPost("/{conversaId:guid}/assumir", async (
            Guid conversaId, AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            var afetadas = await db.Database.ExecuteSqlRawAsync(@"
                UPDATE conversas SET status = 'aberta'
                WHERE id = {0} AND status = 'humano'
                  AND cliente_id IN (
                      SELECT cliente_id FROM pacientes WHERE medico_responsavel_id = {1}
                  )",
                conversaId, medicoId.Value);

            return afetadas == 0 ? Results.NotFound() : Results.NoContent();
        });
    }

    private static async Task<Guid?> GetMedicoIdAsync(AppDbContext db, ClaimsPrincipal user)
    {
        var sub = user.FindFirst("sub")?.Value;
        if (!Guid.TryParse(sub, out var userId)) return null;
        return await db.Database.ExecuteScalarAsync<Guid?>(
            "SELECT id FROM medicos WHERE usuario_id = {0}", userId);
    }
}

public record EscalacaoDto(
    Guid ConversaId, Guid PacienteId, string? PacienteNome, string Status,
    DateTime CriadaEm, DateTime? UltimaEm, string? Motivo);
