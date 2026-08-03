import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { bearerMatches } from "@/lib/tracking/auth";

/**
 * Purga de retenção do acompanhamento (ADR-050 Parte 2, Fase 5).
 * Cérebro Amigo — https://www.cerebroamigo.com.br
 *
 * Acionado por scheduler externo (POST + Bearer CHECKUP_CRON_TOKEN). Apaga séries
 * inativas há mais de CHECKUP_TRACKING_RETENTION_DAYS (default 365) — DELETE real com
 * CASCADE (pontos + reminders). LGPD: minimização/retenção limitada de dado de saúde
 * pseudonimizado. NÃO depende da flag (limpeza deve rodar mesmo com a feature pausada).
 * Sem PII no log.
 */

const DEFAULT_RETENTION_DAYS = 365;

export async function POST(req: NextRequest) {
  const cronToken = process.env.CHECKUP_CRON_TOKEN;
  if (!cronToken) {
    return NextResponse.json({ error: "cron_disabled" }, { status: 503 });
  }
  if (!bearerMatches(req.headers.get("authorization"), cronToken)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sql = getSql();
  if (!sql) {
    return NextResponse.json({ error: "tracking_unavailable" }, { status: 503 });
  }

  const raw = Number(process.env.CHECKUP_TRACKING_RETENTION_DAYS);
  // raw >= 1 (não >0): 0.5 passaria e viraria 0 no floor → purga TODAS as séries.
  const days = Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : DEFAULT_RETENTION_DAYS;

  try {
    // inatividade = sem re-rastreio (last_seen_at) há `days`; cai p/ created_at se nunca visto.
    const rows = await sql<{ count: number }[]>`
      WITH del AS (
        DELETE FROM checkup.tracking_series
        WHERE COALESCE(last_seen_at, created_at) < now() - make_interval(days => ${days})
        RETURNING id
      )
      SELECT count(*)::int AS count FROM del
    `;
    return NextResponse.json({ purged: rows[0]?.count ?? 0, retentionDays: days });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: tracking/retention — purga falhou: ${msg}`);
    return NextResponse.json({ error: "retention_failed" }, { status: 500 });
  }
}
