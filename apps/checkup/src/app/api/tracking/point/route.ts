import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { checkTrackingLimit } from "@/lib/ratelimit";
import { getClientIp } from "@/lib/client-ip";
import { bandSchema } from "@/lib/tracking/bands";

/**
 * Anexa um ponto de re-rastreio à série (ADR-050 Parte 2, Fase 4).
 * Cérebro Amigo — https://www.cerebroamigo.com.br
 *
 * Chamado pelo /resultado quando o teste veio de um link de acompanhamento (?series=).
 * clinical-safety: crise NUNCA anexa ponto (rejeita crisis=true; e o /resultado só chama
 * fora de crise). Token é a credencial; 404 se a série não existir/estiver apagada.
 * Sem e-mail aqui (não precisa de chave). Rate-limit por token+IP.
 */

const BodySchema = z.object({
  token: z.string().min(1).max(256),
  totalScore: z.number().int().min(0).max(100),
  band: bandSchema,
  crisis: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const { token, totalScore, band, crisis } = parsed.data;

  if (crisis) {
    return NextResponse.json({ error: "crisis_not_eligible" }, { status: 409 });
  }

  const limit = await checkTrackingLimit(getClientIp(req), token);
  if (!limit.allowed) {
    const retryAfter = Math.ceil((limit.retryAfterMs ?? 3600000) / 1000);
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const sql = getSql();
  if (!sql) {
    return NextResponse.json({ error: "tracking_unavailable" }, { status: 503 });
  }

  try {
    const series = await sql<{ id: string }[]>`
      SELECT id FROM checkup.tracking_series WHERE series_token = ${token} AND deleted_at IS NULL
    `;
    if (series.length === 0) {
      // série inexistente/apagada: responde ok (anexar é best-effort) — não vaza
      // validade de token por status (sem enumeração).
      return NextResponse.json({ ok: true });
    }
    const seriesId = series[0].id;
    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO checkup.tracking_points (series_id, total_score, band)
        VALUES (${seriesId}, ${totalScore}, ${band})
      `;
      await tx`UPDATE checkup.tracking_series SET last_seen_at = now() WHERE id = ${seriesId}`;
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: tracking/point — anexar ponto falhou: ${msg}`);
    return NextResponse.json({ error: "point_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
