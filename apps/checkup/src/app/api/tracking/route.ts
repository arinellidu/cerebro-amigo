import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { getSql } from "@/lib/db";
import { checkTrackingLimit } from "@/lib/ratelimit";
import { getClientIp } from "@/lib/client-ip";
import { bandSchema } from "@/lib/tracking/bands";

/**
 * Check-up longitudinal PSEUDONIMIZADO — opt-in (ADR-050 Parte 2, Fase 2).
 * Cérebro Amigo — https://www.cerebroamigo.com.br
 *
 * Cria a série de acompanhamento + 1º ponto (o teste atual) + o agendamento do nudge.
 * NÃO envia e-mail (isso é a Fase 3, depende de SES production-access / CK-4): só grava.
 *
 * clinical-safety / LGPD:
 *  - Opt-in explícito; crise NUNCA gera série (rejeita crisis=true; a UI só aparece fora de crise).
 *  - E-mail CIFRADO em repouso (pgp_sym_encrypt, CHECKUP_ENCRYPTION_KEY) — fail-closed sem a chave
 *    (jamais grava e-mail em claro). email_hash bcrypt só p/ dedup/unsubscribe (Fase 3).
 *  - series_token = 256-bit CSPRNG; viaja só no link do e-mail, nunca volta na resposta.
 *  - Dark por padrão: NEXT_PUBLIC_CHECKUP_TRACKING_ENABLED!="true" → 404 (não coletar e-mail
 *    enquanto o envio/erasure da Fase 3 não está no ar).
 *  - Sem respostas item-a-item, sem texto livre (minimização).
 */

const REMINDER_DAYS = 14;

const BodySchema = z.object({
  sessionId: z.string().uuid(),
  // consentimento explícito validado no servidor (LGPD) — recusa qualquer outro valor.
  consent: z.literal(true),
  email: z.string().email().max(254),
  scaleId: z.enum(["phq9", "gad7", "asrs18", "audit", "mdq", "fagerstrom", "msi_bpd", "assist"]),
  totalScore: z.number().int().min(0).max(100),
  band: bandSchema,
  crisis: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  // dark até a Fase 3 (envio + erasure) estar no ar — não coletar e-mail que não dá pra usar.
  if (process.env.NEXT_PUBLIC_CHECKUP_TRACKING_ENABLED !== "true") {
    return NextResponse.json({ error: "not_enabled" }, { status: 404 });
  }

  // fail-closed: sem chave de cifragem não grava e-mail (nunca em claro). Categoria especial (LGPD).
  const key = process.env.CHECKUP_ENCRYPTION_KEY;
  if (!key) {
    return NextResponse.json({ error: "tracking_unavailable" }, { status: 503 });
  }

  const ip = getClientIp(req);
  const limitKeyBody = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(limitKeyBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const { sessionId, email, scaleId, totalScore, band, crisis } = parsed.data;

  // crise é first-class: jamais agendar nudge/série p/ quem roteou para crise.
  if (crisis) {
    return NextResponse.json({ error: "crisis_not_eligible" }, { status: 409 });
  }

  const limit = await checkTrackingLimit(ip, sessionId);
  if (!limit.allowed) {
    const retryAfter = Math.ceil((limit.retryAfterMs ?? 3600000) / 1000);
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const sql = getSql();
  if (!sql) {
    // sem DB não há onde gravar — não fingir sucesso (a pessoa espera ser lembrada).
    return NextResponse.json({ error: "tracking_unavailable" }, { status: 503 });
  }

  const seriesToken = randomBytes(32).toString("base64url"); // 256-bit opaco
  const emailHash = await bcrypt.hash(email, 10);
  const dueAt = new Date(Date.now() + REMINDER_DAYS * 24 * 60 * 60 * 1000);

  try {
    await sql.begin(async (tx) => {
      const series = await tx<{ id: string }[]>`
        INSERT INTO checkup.tracking_series (series_token, scale_id)
        VALUES (${seriesToken}, ${scaleId})
        RETURNING id
      `;
      const seriesId = series[0].id;
      // 1º ponto = o teste atual (semeia a evolução).
      await tx`
        INSERT INTO checkup.tracking_points (series_id, total_score, band)
        VALUES (${seriesId}, ${totalScore}, ${band})
      `;
      // e-mail cifrado em repouso (decifrado só no disparo, Fase 3). due_at = +14 dias.
      await tx`
        INSERT INTO checkup.tracking_reminders (series_id, email_enc, email_hash, due_at)
        VALUES (${seriesId}, pgp_sym_encrypt(${email}, ${key}), ${emailHash}, ${dueAt})
      `;
    });
  } catch (err: unknown) {
    // sem PII no log (só a mensagem do erro). stderr → CloudWatch (CK-1).
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: falha ao criar série de acompanhamento (${scaleId}): ${msg}`);
    return NextResponse.json({ error: "tracking_failed" }, { status: 500 });
  }

  // series_token NÃO volta na resposta — ele só viaja no link do e-mail (Fase 3).
  return NextResponse.json({ ok: true });
}
