using ApiGateway.Data;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace ApiGateway.Endpoints;

/// <summary>
/// ROI do médico (item 3 do top-3 de demo, ADR-033). Agregação read-only que mostra
/// o RETORNO que a plataforma gera no consultório: pacientes sob acompanhamento,
/// pacientes inativos recuperáveis (recall), consultas realizadas/agendadas e crises
/// detectadas. Vende valor: "isto te dá/poupa dinheiro". NÃO é dado clínico — só contagens.
/// O R$ estimado é calculado no front (médico informa o valor da consulta), nunca aqui.
/// Tenant: pacientes.medico_responsavel_id (clinical-safety multi-tenant) e medico_id direto
/// em protocolos_crise_acionados.
/// </summary>
public static class RoiEndpoints
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/v1/roi/resumo", async (AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            var r = await db.Database.SqlQueryRaw<RoiResumo>(@"
                SELECT
                  (SELECT COUNT(*) FROM pacientes
                     WHERE medico_responsavel_id = {0})::int AS pacientes_ativos,
                  (SELECT COUNT(*) FROM pacientes p2
                     WHERE p2.medico_responsavel_id = {0}
                       AND NOT EXISTS (
                         SELECT 1 FROM consultas k
                         WHERE k.paciente_id = p2.cliente_id AND k.status = 'realizada'
                           AND k.inicia_em > NOW() - INTERVAL '90 days'))::int AS pacientes_inativos,
                  (SELECT COUNT(*) FROM consultas k
                     JOIN pacientes p ON p.cliente_id = k.paciente_id
                     WHERE p.medico_responsavel_id = {0} AND k.status = 'realizada'
                       AND k.inicia_em > NOW() - INTERVAL '30 days')::int AS consultas_realizadas_30d,
                  (SELECT COUNT(*) FROM consultas k
                     JOIN pacientes p ON p.cliente_id = k.paciente_id
                     WHERE p.medico_responsavel_id = {0} AND k.status = 'realizada')::int AS consultas_realizadas_total,
                  (SELECT COUNT(*) FROM consultas k
                     JOIN pacientes p ON p.cliente_id = k.paciente_id
                     WHERE p.medico_responsavel_id = {0}
                       AND k.status IN ('agendada','confirmada')
                       AND k.inicia_em > NOW())::int AS consultas_agendadas,
                  (SELECT COUNT(*) FROM protocolos_crise_acionados
                     WHERE medico_id = {0})::int AS crises_total,
                  (SELECT COUNT(*) FROM protocolos_crise_acionados
                     WHERE medico_id = {0} AND criado_em > NOW() - INTERVAL '30 days')::int AS crises_30d",
                medicoId.Value).FirstAsync();

            return Results.Ok(r);
        }).WithTags("roi").RequireAuthorization();
    }

    private static async Task<Guid?> GetMedicoIdAsync(AppDbContext db, ClaimsPrincipal user)
    {
        var sub = user.FindFirst("sub")?.Value;
        if (!Guid.TryParse(sub, out var userId)) return null;
        return await db.Database.ExecuteScalarAsync<Guid?>(
            "SELECT id FROM medicos WHERE usuario_id = {0}", userId);
    }
}

public record RoiResumo(
    int PacientesAtivos, int PacientesInativos,
    int ConsultasRealizadas30d, int ConsultasRealizadasTotal, int ConsultasAgendadas,
    int CrisesTotal, int Crises30d);
