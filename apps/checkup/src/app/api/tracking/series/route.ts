import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";

/**
 * Leitura da série de acompanhamento p/ a tela de evolução (ADR-050 Parte 2, Fase 4).
 * Cérebro Amigo — https://www.cerebroamigo.com.br
 *
 * GET ?t=series_token → escore + faixa por data (cronológico). Token é a credencial
 * (vem do link do e-mail); 404 se não existir/estiver apagada → sem enumeração útil.
 * Sem PII, sem item-a-item, sem narrativa de tendência (clinical-safety). no-store.
 * Marca last_seen_at (atividade → não purgar série viva, Fase 5).
 */

export async function GET(req: NextRequest) {
  const t = new URL(req.url).searchParams.get("t");
  if (!t) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "tracking_unavailable" }, { status: 503 });

  let rows: { scale_id: string; total_score: number; band: string; created_at: string }[];
  try {
    rows = await sql<{ scale_id: string; total_score: number; band: string; created_at: string }[]>`
      SELECT s.scale_id AS scale_id, p.total_score AS total_score, p.band AS band, p.created_at AS created_at
      FROM checkup.tracking_series s
      JOIN checkup.tracking_points p ON p.series_id = s.id
      WHERE s.series_token = ${t} AND s.deleted_at IS NULL
      ORDER BY p.created_at
    `;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: tracking/series — leitura falhou: ${msg}`);
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  if (rows.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // atividade → alimenta a retenção (não bloqueia a resposta).
  await sql`UPDATE checkup.tracking_series SET last_seen_at = now() WHERE series_token = ${t}`.catch(
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Error: tracking/series — update last_seen_at falhou: ${msg}`);
    },
  );

  return NextResponse.json(
    {
      scaleId: rows[0].scale_id,
      points: rows.map((r) => ({ score: r.total_score, band: r.band, at: r.created_at })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
