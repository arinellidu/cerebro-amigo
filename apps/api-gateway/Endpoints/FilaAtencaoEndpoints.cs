using ApiGateway.Data;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace ApiGateway.Endpoints;

/// <summary>
/// Fila de atenção do médico — duas camadas:
///   1. <c>itens</c> — eventos discretos que exigem ação imediata (crise, escalação, etc.).
///   2. <c>deltas</c> — pacientes agrupados por mudança recente nos sinais reportados
///      (escala, humor, adesão), ranqueados por velocidade de piora.
///
/// Tudo escopado ao médico (tenant). Apenas leitura agregada — fatos reportados, sem
/// interpretação clínica (clinical-safety #1). As ações usam endpoints próprios.
/// </summary>
public static class FilaAtencaoEndpoints
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/v1/fila-atencao", async (AppDbContext db, ClaimsPrincipal user) =>
        {
            var medicoId = await GetMedicoIdAsync(db, user);
            if (medicoId is null) return Results.Forbid();

            var itens = await db.Database.SqlQueryRaw<FilaItemDto>(@"
                WITH itens AS (
                    -- 1. Crise ativa (automação pausada) — prioridade máxima
                    SELECT 'crise' AS tipo, p.cliente_id AS paciente_id, cl.nome AS paciente_nome,
                           'critico' AS severidade,
                           'Crise — automação pausada' AS titulo,
                           COALESCE(pc.criado_em, p.criado_em) AS quando,
                           1 AS prioridade
                    FROM pacientes p
                    JOIN clientes cl ON cl.id = p.cliente_id
                    LEFT JOIN LATERAL (
                        SELECT criado_em FROM protocolos_crise_acionados
                        WHERE paciente_id = p.cliente_id ORDER BY criado_em DESC LIMIT 1
                    ) pc ON TRUE
                    WHERE p.medico_responsavel_id = {0} AND p.automacao_pausada = TRUE

                    UNION ALL
                    -- 2. Conversa escalada para atendimento humano
                    SELECT 'escalacao', cl.id, cl.nome, 'urgente',
                           'Conversa escalada para atendimento humano',
                           co.criada_em, 2
                    FROM conversas co
                    JOIN clientes cl ON cl.id = co.cliente_id
                    JOIN pacientes p ON p.cliente_id = co.cliente_id
                    WHERE p.medico_responsavel_id = {0} AND co.status = 'humano'

                    UNION ALL
                    -- 3. Insight de alta severidade pendente (não visto, não descartado, válido).
                    SELECT 'insight', i.paciente_id, cl.nome,
                           CASE i.severidade WHEN 'critica' THEN 'critico' ELSE 'urgente' END,
                           i.titulo, i.criado_em,
                           CASE i.severidade WHEN 'critica' THEN 3 ELSE 4 END
                    FROM insights i
                    JOIN clientes cl ON cl.id = i.paciente_id
                    WHERE i.medico_id = {0}
                      AND i.severidade IN ('alta','critica')
                      AND i.descartado_em IS NULL
                      AND i.visualizado_em IS NULL
                      AND (i.valido_ate IS NULL OR i.valido_ate > NOW())

                    UNION ALL
                    -- 4. Check-in expirado sem resposta (últimos 7 dias)
                    SELECT 'checkin_perdido', ch.paciente_id, cl.nome, 'atencao',
                           'Check-in não respondido', ch.expirado_em, 5
                    FROM checkins ch
                    JOIN clientes cl ON cl.id = ch.paciente_id
                    JOIN pacientes p ON p.cliente_id = ch.paciente_id
                    WHERE p.medico_responsavel_id = {0}
                      AND ch.respondido_em IS NULL
                      AND ch.expirado_em IS NOT NULL
                      AND ch.expirado_em < NOW()
                      AND ch.expirado_em > NOW() - INTERVAL '7 days'

                    UNION ALL
                    -- 5. Dose registrada como esquecida (últimos 3 dias)
                    SELECT 'nao_adesao', tm.paciente_id, cl.nome, 'atencao',
                           'Dose registrada como esquecida', tm.horario_previsto, 6
                    FROM tomadas_medicacao tm
                    JOIN clientes cl ON cl.id = tm.paciente_id
                    JOIN pacientes p ON p.cliente_id = tm.paciente_id
                    WHERE p.medico_responsavel_id = {0}
                      AND tm.status = 'esquecida'
                      AND tm.horario_previsto > NOW() - INTERVAL '3 days'
                )
                SELECT tipo, paciente_id, paciente_nome, severidade, titulo, quando
                FROM itens
                ORDER BY prioridade, quando DESC
                LIMIT 50",
                medicoId.Value).ToListAsync();

            var sinais = await db.Database.SqlQueryRaw<FilaDeltaSinalRow>(@"
                -- Escala clínica (PHQ-9/GAD-7): último vs. anterior — piora ≥ 3 pts em ≤ 21 dias
                WITH ranked AS (
                    SELECT qr.paciente_id, cl.nome, q.codigo, qr.score_total, qr.respondido_em,
                           LAG(qr.score_total) OVER w AS score_ant,
                           LAG(qr.respondido_em) OVER w AS em_ant,
                           ROW_NUMBER() OVER (PARTITION BY qr.paciente_id, q.codigo ORDER BY qr.respondido_em DESC) AS rn
                    FROM questionarios_respostas qr
                    JOIN questionarios q ON q.id = qr.questionario_id
                    JOIN clientes cl ON cl.id = qr.paciente_id
                    JOIN pacientes p ON p.cliente_id = qr.paciente_id
                    WHERE p.medico_responsavel_id = {0}
                      AND q.codigo IN ('phq9','gad7')
                      AND p.automacao_pausada = FALSE
                    WINDOW w AS (PARTITION BY qr.paciente_id, q.codigo ORDER BY qr.respondido_em)
                )
                SELECT paciente_id, nome AS paciente_nome, 'escala' AS tipo,
                       CASE codigo
                         WHEN 'phq9' THEN 'PHQ-9: ' || score_ant || ' → ' || score_total ||
                           ' (+' || (score_total - score_ant) || ' em ' ||
                           GREATEST(1, EXTRACT(DAY FROM (respondido_em - em_ant))::int) || ' dias)'
                         ELSE 'GAD-7: ' || score_ant || ' → ' || score_total ||
                           ' (+' || (score_total - score_ant) || ' em ' ||
                           GREATEST(1, EXTRACT(DAY FROM (respondido_em - em_ant))::int) || ' dias)'
                       END AS titulo,
                       respondido_em AS quando,
                       (score_total - score_ant) *
                         GREATEST(1.0, 14.0 / GREATEST(1, EXTRACT(EPOCH FROM (respondido_em - em_ant)) / 86400)) AS peso
                FROM ranked
                WHERE rn = 1 AND score_ant IS NOT NULL
                  AND (score_total - score_ant) >= 3
                  AND respondido_em > NOW() - INTERVAL '21 days'

                UNION ALL

                -- Δ humor: média dos últimos 15d vs. quinzena anterior (≥ 2 registros em cada)
                SELECT cl.id, cl.nome, 'humor',
                       'Humor médio reportado: ' ||
                         REPLACE(ROUND(h.delta::numeric, 1)::text, '.', ',') ||
                         ' vs. quinzena anterior',
                       h.ultimo,
                       ABS(h.delta) * 15
                FROM (
                    SELECT p.cliente_id,
                           ROUND((AVG(s.humor) FILTER (WHERE s.registrado_em > NOW() - INTERVAL '15 days')
                                - AVG(s.humor) FILTER (WHERE s.registrado_em <= NOW() - INTERVAL '15 days'
                                                      AND s.registrado_em > NOW() - INTERVAL '30 days'))::numeric, 1) AS delta,
                           MAX(s.registrado_em) FILTER (WHERE s.registrado_em > NOW() - INTERVAL '15 days') AS ultimo
                    FROM pacientes p
                    JOIN sintomas s ON s.paciente_id = p.cliente_id AND s.humor IS NOT NULL
                         AND s.registrado_em > NOW() - INTERVAL '30 days'
                    WHERE p.medico_responsavel_id = {0} AND p.automacao_pausada = FALSE
                    GROUP BY p.cliente_id
                    HAVING COUNT(s.id) FILTER (WHERE s.registrado_em <= NOW() - INTERVAL '15 days') >= 2
                       AND COUNT(s.id) FILTER (WHERE s.registrado_em > NOW() - INTERVAL '15 days') >= 2
                ) h
                JOIN clientes cl ON cl.id = h.cliente_id
                WHERE h.delta <= -1.5 AND h.ultimo IS NOT NULL

                UNION ALL

                -- Δ adesão: queda ≥ 15 p.p. entre quinzenas
                SELECT cl.id, cl.nome, 'adesao',
                       'Adesão reportada: −' ||
                         ROUND((a.adesao_ant - a.adesao_rec)::numeric, 0)::int ||
                         ' p.p. vs. quinzena anterior',
                       a.ultimo,
                       (a.adesao_ant - a.adesao_rec) * 2
                FROM (
                    SELECT tm.paciente_id,
                           ROUND(100.0 * COUNT(*) FILTER (WHERE tm.status = 'tomada'
                                 AND tm.horario_previsto > NOW() - INTERVAL '15 days')
                               / NULLIF(COUNT(*) FILTER (WHERE tm.status IN ('tomada','esquecida','pulou')
                                 AND tm.horario_previsto > NOW() - INTERVAL '15 days'), 0)) AS adesao_rec,
                           ROUND(100.0 * COUNT(*) FILTER (WHERE tm.status = 'tomada'
                                 AND tm.horario_previsto <= NOW() - INTERVAL '15 days'
                                 AND tm.horario_previsto > NOW() - INTERVAL '30 days')
                               / NULLIF(COUNT(*) FILTER (WHERE tm.status IN ('tomada','esquecida','pulou')
                                 AND tm.horario_previsto <= NOW() - INTERVAL '15 days'
                                 AND tm.horario_previsto > NOW() - INTERVAL '30 days'), 0)) AS adesao_ant,
                           MAX(tm.horario_previsto) AS ultimo
                    FROM tomadas_medicacao tm
                    JOIN pacientes p ON p.cliente_id = tm.paciente_id
                    WHERE p.medico_responsavel_id = {0} AND p.automacao_pausada = FALSE
                      AND tm.horario_previsto > NOW() - INTERVAL '30 days'
                    GROUP BY tm.paciente_id
                ) a
                JOIN clientes cl ON cl.id = a.paciente_id
                WHERE a.adesao_ant IS NOT NULL AND a.adesao_rec IS NOT NULL
                  AND (a.adesao_ant - a.adesao_rec) >= 15

                UNION ALL

                -- Humor baixo persistente: ≥ 3 dias distintos nos últimos 7
                SELECT d.paciente_id, cl.nome, 'humor_baixo',
                       'Humor baixo (≤3) em ' || d.cnt || ' dos últimos 7 dias',
                       d.ultimo,
                       d.cnt * 10.0
                FROM (
                    SELECT s.paciente_id,
                           COUNT(DISTINCT DATE(s.registrado_em AT TIME ZONE 'America/Sao_Paulo')) AS cnt,
                           MAX(s.registrado_em) AS ultimo
                    FROM sintomas s
                    JOIN pacientes p ON p.cliente_id = s.paciente_id
                    WHERE p.medico_responsavel_id = {0} AND p.automacao_pausada = FALSE
                      AND s.humor IS NOT NULL AND s.humor <= 3
                      AND s.registrado_em > NOW() - INTERVAL '7 days'
                    GROUP BY s.paciente_id
                    HAVING COUNT(DISTINCT DATE(s.registrado_em AT TIME ZONE 'America/Sao_Paulo')) >= 3
                ) d
                JOIN clientes cl ON cl.id = d.paciente_id",
                medicoId.Value).ToListAsync();

            var deltas = sinais
                .GroupBy(s => s.PacienteId)
                .Select(g =>
                {
                    var score = (int)Math.Round(g.Sum(x => (double)x.Peso));
                    return new FilaDeltaPacienteDto(
                        g.Key,
                        g.First().PacienteNome,
                        score,
                        score >= 60 ? "urgente" : "atencao",
                        g.OrderByDescending(x => x.Peso)
                            .Select(x => new FilaDeltaSinalDto(x.Tipo, x.Titulo, x.Quando))
                            .ToList());
                })
                .Where(d => d.Sinais.Count >= 1)
                .OrderByDescending(d => d.ScorePiora)
                .Take(10)
                .ToList();

            return Results.Ok(new FilaAtencaoResponse(itens, deltas));
        }).RequireAuthorization().WithTags("fila");
    }

    private static async Task<Guid?> GetMedicoIdAsync(AppDbContext db, ClaimsPrincipal user)
    {
        var sub = user.FindFirst("sub")?.Value;
        if (!Guid.TryParse(sub, out var userId)) return null;
        return await db.Database.ExecuteScalarAsync<Guid?>(
            "SELECT id FROM medicos WHERE usuario_id = {0}", userId);
    }
}

public record FilaItemDto(
    string Tipo, Guid PacienteId, string? PacienteNome,
    string Severidade, string Titulo, DateTime Quando);

public record FilaDeltaSinalRow(
    Guid PacienteId, string? PacienteNome, string Tipo,
    string Titulo, DateTime Quando, decimal Peso);

public record FilaDeltaSinalDto(string Tipo, string Titulo, DateTime Quando);

public record FilaDeltaPacienteDto(
    Guid PacienteId, string? PacienteNome, int ScorePiora,
    string Severidade, List<FilaDeltaSinalDto> Sinais);

public record FilaAtencaoResponse(
    List<FilaItemDto> Itens, List<FilaDeltaPacienteDto> Deltas);
