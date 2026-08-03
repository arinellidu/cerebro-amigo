using ApiGateway.Data;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace ApiGateway.Endpoints;

/// <summary>
/// Blindagem médico-legal (item 3, ADR-033). NÃO é feature nova — é uma AGREGAÇÃO
/// read-only do que a plataforma já faz pela proteção do médico: protocolo de crise
/// acionado e registrado, monitoramento de exames de segurança, rede de interações,
/// renovação de receita controlada, trilha de auditoria imutável. Vende confiança:
/// "sua conduta está documentada e defensável". Tenant por medico_id / JOIN pacientes.
/// </summary>
public static class BlindagemEndpoints
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/v1/blindagem/resumo", async (AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            var r = await db.Database.SqlQueryRaw<BlindagemResumo>(@"
                SELECT
                  (SELECT COUNT(*) FROM protocolos_crise_acionados
                     WHERE medico_id = {0})::int AS crises_total,
                  (SELECT COUNT(*) FROM protocolos_crise_acionados
                     WHERE medico_id = {0} AND criado_em > NOW() - INTERVAL '30 days')::int AS crises_30d,
                  (SELECT COUNT(*) FROM exames_agenda ea
                     JOIN pacientes p ON p.cliente_id = ea.paciente_id
                     WHERE p.medico_responsavel_id = {0})::int AS exames_total,
                  (SELECT COUNT(*) FROM exames_agenda ea
                     JOIN pacientes p ON p.cliente_id = ea.paciente_id
                     WHERE p.medico_responsavel_id = {0}
                       AND ea.status = 'agendado' AND ea.devido_em < CURRENT_DATE)::int AS exames_atrasados,
                  (SELECT COUNT(*) FROM receita_renovacoes
                     WHERE medico_id = {0} AND status = 'pendente')::int AS renovacoes_pendentes,
                  (SELECT COUNT(*) FROM interacao_catalogo WHERE ativo)::int AS interacoes_base,
                  (SELECT COUNT(*) FROM notificacoes_medico WHERE medico_id = {0})::int AS eventos_auditados",
                medicoId.Value).FirstAsync();

            return Results.Ok(r);
        }).WithTags("blindagem").RequireAuthorization();
    }

    private static async Task<Guid?> GetMedicoIdAsync(AppDbContext db, ClaimsPrincipal user)
    {
        var sub = user.FindFirst("sub")?.Value;
        if (!Guid.TryParse(sub, out var userId)) return null;
        return await db.Database.ExecuteScalarAsync<Guid?>(
            "SELECT id FROM medicos WHERE usuario_id = {0}", userId);
    }
}

public record BlindagemResumo(
    int CrisesTotal, int Crises30d, int ExamesTotal, int ExamesAtrasados,
    int RenovacoesPendentes, int InteracoesBase, int EventosAuditados);
