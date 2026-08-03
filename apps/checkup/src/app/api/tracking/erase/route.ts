import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSql } from "@/lib/db";

/**
 * Apagar dados de acompanhamento — direito de eliminação do titular (LGPD).
 * ADR-050 Parte 2, Fase 3. Cérebro Amigo — https://www.cerebroamigo.com.br
 *
 * POST (não GET) com confirmação na página /descadastrar → evita que prefetch de
 * cliente de e-mail apague dados sem ação humana. DELETE real (não soft-delete):
 * remove a série e, por CASCADE, todos os pontos e reminders. Idempotente.
 * Sempre responde ok (token válido ou não) → sem enumeração.
 */

const BodySchema = z.object({ token: z.string().min(1).max(256) });

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const sql = getSql();
  if (!sql) {
    return NextResponse.json({ error: "tracking_unavailable" }, { status: 503 });
  }

  try {
    // CASCADE em tracking_points/tracking_reminders (FK ON DELETE CASCADE, 0044).
    await sql`DELETE FROM checkup.tracking_series WHERE series_token = ${parsed.data.token}`;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: tracking/erase falhou: ${msg}`);
    return NextResponse.json({ error: "erase_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
