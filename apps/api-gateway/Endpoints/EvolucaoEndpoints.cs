using ApiGateway.Auth;
using ApiGateway.Data;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace ApiGateway.Endpoints;

/// <summary>
/// Panorama do médico para as telas /dashboard/evolucao e /dashboard/checkins.
///
/// Devolve apenas FATOS agregados que o paciente reportou (humor, adesão,
/// check-ins, consultas) — nunca interpretação clínica, diagnóstico ou
/// "% de melhora" como julgamento (clinical-safety #1). Δhumor é a diferença
/// aritmética entre médias reportadas, exibida como número, não como conclusão.
///
/// Tudo escopado ao médico (tenant) via JOIN pacientes.medico_responsavel_id.
/// </summary>
public static class EvolucaoEndpoints
{
    public static void Map(WebApplication app)
    {
        var g = app.MapGroup("/api/v1/evolucao")
            .WithTags("evolucao")
            .RequireAuthorization()
            .RequireAssinaturaAtiva(); // ADR-055 Fase D: gate de assinatura (dashboard)

        // Panorama: stats + série mensal + distribuição de humor da semana + progresso factual.
        g.MapGet("/resumo", async (AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();
            var m = medicoId.Value;

            var stats = await db.Database.SqlQueryRaw<EvolucaoStatsDto>(@"
                SELECT
                  (SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE tm.status='tomada')
                        / NULLIF(COUNT(*) FILTER (WHERE tm.status IN ('tomada','esquecida','pulou')),0))
                   FROM tomadas_medicacao tm JOIN pacientes p ON p.cliente_id=tm.paciente_id
                   WHERE p.medico_responsavel_id={0}
                     AND tm.horario_previsto > NOW()-INTERVAL '30 days') AS taxa_adesao,
                  (SELECT ROUND(AVG(s.humor)::numeric,1)
                   FROM sintomas s JOIN pacientes p ON p.cliente_id=s.paciente_id
                   WHERE p.medico_responsavel_id={0} AND s.humor IS NOT NULL
                     AND s.registrado_em > NOW()-INTERVAL '30 days') AS humor_medio,
                  (SELECT COUNT(DISTINCT p.cliente_id)
                   FROM pacientes p
                   WHERE p.medico_responsavel_id={0}
                     AND (EXISTS(SELECT 1 FROM sintomas s WHERE s.paciente_id=p.cliente_id
                                  AND s.registrado_em>NOW()-INTERVAL '30 days')
                       OR EXISTS(SELECT 1 FROM checkins c WHERE c.paciente_id=p.cliente_id
                                  AND c.respondido_em>NOW()-INTERVAL '30 days'))) AS pacientes_ativos,
                  (SELECT COUNT(*) FROM consultas co JOIN pacientes p ON p.cliente_id=co.paciente_id
                   WHERE p.medico_responsavel_id={0}
                     AND date_trunc('month',co.inicia_em)=date_trunc('month',NOW())) AS consultas_mes",
                m).FirstOrDefaultAsync();

            var mensal = await db.Database.SqlQueryRaw<EvolucaoMensalDto>(@"
                SELECT to_char(s.mes,'Mon') AS month,
                  (SELECT COUNT(*) FROM pacientes p WHERE p.medico_responsavel_id={0}
                     AND date_trunc('month',p.criado_em)=s.mes) AS pacientes,
                  (SELECT COUNT(*) FROM consultas co JOIN pacientes p ON p.cliente_id=co.paciente_id
                     WHERE p.medico_responsavel_id={0}
                       AND date_trunc('month',co.inicia_em)=s.mes) AS consultas
                FROM generate_series(date_trunc('month',NOW())-INTERVAL '5 months',
                                     date_trunc('month',NOW()), INTERVAL '1 month') AS s(mes)
                ORDER BY s.mes",
                m).ToListAsync();

            var humorSemana = await db.Database.SqlQueryRaw<EvolucaoHumorSemanaDto>(@"
                SELECT t.dia,
                  COUNT(*) FILTER (WHERE t.humor>=8) AS muito_bem,
                  COUNT(*) FILTER (WHERE t.humor>=6 AND t.humor<8) AS bem,
                  COUNT(*) FILTER (WHERE t.humor>=4 AND t.humor<6) AS neutro,
                  COUNT(*) FILTER (WHERE t.humor<4) AS mal
                FROM (
                  SELECT s.humor, EXTRACT(DOW FROM s.registrado_em)::int AS dow,
                    CASE EXTRACT(DOW FROM s.registrado_em)::int
                      WHEN 0 THEN 'Dom' WHEN 1 THEN 'Seg' WHEN 2 THEN 'Ter' WHEN 3 THEN 'Qua'
                      WHEN 4 THEN 'Qui' WHEN 5 THEN 'Sex' WHEN 6 THEN 'Sáb' END AS dia
                  FROM sintomas s JOIN pacientes p ON p.cliente_id=s.paciente_id
                  WHERE p.medico_responsavel_id={0} AND s.humor IS NOT NULL
                    AND s.registrado_em > NOW()-INTERVAL '7 days'
                ) t
                GROUP BY t.dia, t.dow
                ORDER BY t.dow",
                m).ToListAsync();

            var progresso = await db.Database.SqlQueryRaw<EvolucaoProgressoDto>(@"
                SELECT cl.id AS paciente_id, cl.nome,
                  ROUND(AVG(s.humor) FILTER (WHERE s.registrado_em>NOW()-INTERVAL '15 days')::numeric,1) AS humor_atual,
                  ROUND((AVG(s.humor) FILTER (WHERE s.registrado_em>NOW()-INTERVAL '15 days')
                       - AVG(s.humor) FILTER (WHERE s.registrado_em<=NOW()-INTERVAL '15 days'))::numeric,1) AS delta_humor,
                  (SELECT ROUND(100.0*COUNT(*) FILTER (WHERE tm.status='tomada')
                        / NULLIF(COUNT(*) FILTER (WHERE tm.status IN ('tomada','esquecida','pulou')),0))
                   FROM tomadas_medicacao tm WHERE tm.paciente_id=cl.id
                     AND tm.horario_previsto>NOW()-INTERVAL '30 days') AS adesao
                FROM pacientes p
                JOIN clientes cl ON cl.id=p.cliente_id
                LEFT JOIN sintomas s ON s.paciente_id=p.cliente_id
                     AND s.registrado_em>NOW()-INTERVAL '30 days' AND s.humor IS NOT NULL
                WHERE p.medico_responsavel_id={0}
                GROUP BY cl.id, cl.nome
                HAVING COUNT(s.id) > 0
                ORDER BY delta_humor ASC NULLS LAST
                LIMIT 8",
                m).ToListAsync();

            return Results.Ok(new { stats, mensal, humorSemana, progresso });
        });

        // Check-ins de humor recentes (auto-relato do paciente) — fatos, sem interpretação.
        g.MapGet("/checkins", async (AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            var rows = await db.Database.SqlQueryRaw<CheckinHumorDto>(@"
                SELECT s.id, cl.id AS paciente_id, cl.nome AS paciente_nome,
                       s.humor, s.nota, s.registrado_em
                FROM sintomas s
                JOIN clientes cl ON cl.id=s.paciente_id
                JOIN pacientes p ON p.cliente_id=s.paciente_id
                WHERE p.medico_responsavel_id={0} AND s.humor IS NOT NULL
                ORDER BY s.registrado_em DESC
                LIMIT 40",
                medicoId.Value).ToListAsync();

            return Results.Ok(rows);
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

public record EvolucaoStatsDto(
    decimal? TaxaAdesao, decimal? HumorMedio, int PacientesAtivos, int ConsultasMes);

public record EvolucaoMensalDto(string Month, int Pacientes, int Consultas);

public record EvolucaoHumorSemanaDto(
    string Dia, int MuitoBem, int Bem, int Neutro, int Mal);

public record EvolucaoProgressoDto(
    Guid PacienteId, string Nome, decimal? HumorAtual, decimal? DeltaHumor, decimal? Adesao);

public record CheckinHumorDto(
    Guid Id, Guid PacienteId, string? PacienteNome, int Humor, string? Nota, DateTime RegistradoEm);
