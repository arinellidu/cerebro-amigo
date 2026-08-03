import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { bearerMatches } from "@/lib/tracking/auth";

/**
 * Cérebro Amigo — https://www.cerebroamigo.com.br
 * Métricas AGREGADAS do funil do Check-up Mental (motor de aquisição).
 *
 * Consumido server-side pelo BFF clínico (`apps/web` → /api/admin/aquisicao) para o
 * Cockpit de Aquisição. Mantém o isolamento clínico ⇄ checkup (ADR-046/ADR-050): o
 * gateway clínico NÃO tem grant no schema `checkup`; quem lê o schema é o próprio
 * checkup, e o BFF junta as duas fontes para calcular a métrica norte.
 *
 * Só devolve CONTAGENS agregadas — NUNCA session_id, rid individual, e-mail, PII ou
 * conteúdo de triagem (LGPD categoria especial).
 *
 * Auth: Bearer CHECKUP_METRICS_TOKEN. Fail-closed — sem token configurado, responde
 * 503 (não expõe métricas de negócio por engano em superfície pública).
 */

const EVENT_TYPES = [
  "test_started",
  "crisis_routed",
  "test_completed",
  "report_generated",
  "qr_scanned",
  "doctor_signup_started",
] as const;

const SCALES = ["phq9", "gad7", "asrs18", "audit", "mdq", "fagerstrom", "msi_bpd", "assist"] as const;

export async function GET(req: NextRequest) {
  const expected = process.env.CHECKUP_METRICS_TOKEN;
  if (!expected) {
    // fail-closed: sem token configurado, não expõe métricas (checkup é superfície pública)
    return NextResponse.json({ error: "metrics_disabled" }, { status: 503 });
  }
  // Comparação timing-safe (mesmo helper dos endpoints de cron) — evita timing oracle
  // no CHECKUP_METRICS_TOKEN nesta superfície pública.
  if (!bearerMatches(req.headers.get("authorization"), expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sql = getSql();
  if (!sql) {
    // DB indisponível: fail-closed. Não mascarar como "sem dados" (200 zerado) — isso
    // contaminaria a métrica norte do cockpit sem erro explícito. O BFF degrada p/ "indisponível".
    return NextResponse.json(
      { error: "db_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const porEvento = await sql<{ event_type: string; n: number }[]>`
      SELECT event_type, COUNT(*)::int AS n
      FROM checkup.funnel_events
      GROUP BY event_type
    `;
    // scale_id só existe nos eventos do lado PACIENTE (o lado médico carrega só o rid).
    const porEscala = await sql<{ scale_id: string; event_type: string; n: number }[]>`
      SELECT scale_id, event_type, COUNT(*)::int AS n
      FROM checkup.funnel_events
      WHERE scale_id IS NOT NULL
      GROUP BY scale_id, event_type
    `;
    // série temporal da métrica norte (denominador): testes concluídos por mês, fuso BR.
    const porMes = await sql<{ mes: string; n: number }[]>`
      SELECT to_char(date_trunc('month', created_at AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM') AS mes,
             COUNT(*)::int AS n
      FROM checkup.funnel_events
      WHERE event_type = 'test_completed'
        AND created_at >= (now() - interval '12 months')
      GROUP BY 1
      ORDER BY 1
    `;

    const eventos: Record<string, number> = Object.fromEntries(EVENT_TYPES.map((e) => [e, 0]));
    for (const r of porEvento) if (r.event_type in eventos) eventos[r.event_type] = Number(r.n);

    const escalas = SCALES.map((s) => {
      const n = (et: string) =>
        Number(porEscala.find((r) => r.scale_id === s && r.event_type === et)?.n ?? 0);
      return {
        scale: s,
        testStarted: n("test_started"),
        testCompleted: n("test_completed"),
        reportGenerated: n("report_generated"),
      };
    });

    return NextResponse.json(
      {
        eventos,
        escalas,
        testCompletedPorMes: porMes.map((r) => ({ mes: r.mes, n: Number(r.n) })),
        geradoEm: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: funnel-metrics falhou: ${msg}`); // → CloudWatch (CK-1)
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }
}
