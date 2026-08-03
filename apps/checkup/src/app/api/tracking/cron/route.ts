import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email/resend";
import { getSql } from "@/lib/db";
import { bearerMatches } from "@/lib/tracking/auth";
import { buildNudgeLinks, buildNudgeEmail } from "@/lib/tracking/nudge-email";

/**
 * Disparo dos lembretes de re-rastreio (ADR-050 Parte 2, Fase 3).
 * Cérebro Amigo — https://www.cerebroamigo.com.br
 *
 * Acionado por um scheduler externo (EventBridge/cron na infra do checkup) via
 * POST + Bearer CHECKUP_CRON_TOKEN. Pega os reminders vencidos (não enviados, não
 * cancelados, série não apagada), decifra o e-mail SÓ in-memory (pgp_sym_decrypt) e
 * envia o template fixo por Resend (ADR-061). Marca sent_at por linha (idempotente;
 * falha não marca → retenta no próximo run). Fail-soft: erro de envio não derruba o run.
 *
 * Inerte por design até: NEXT_PUBLIC_CHECKUP_TRACKING_ENABLED=true + CHECKUP_CRON_TOKEN
 * + CHECKUP_ENCRYPTION_KEY + RESEND_API_KEY (domínio verificado no Resend). Sem isso, não envia.
 */

const BATCH = 100;

export async function POST(req: NextRequest) {
  if (process.env.NEXT_PUBLIC_CHECKUP_TRACKING_ENABLED !== "true") {
    return NextResponse.json({ error: "not_enabled" }, { status: 404 });
  }
  const cronToken = process.env.CHECKUP_CRON_TOKEN;
  if (!cronToken) {
    return NextResponse.json({ error: "cron_disabled" }, { status: 503 });
  }
  if (!bearerMatches(req.headers.get("authorization"), cronToken)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const key = process.env.CHECKUP_ENCRYPTION_KEY;
  if (!key) {
    return NextResponse.json({ error: "tracking_unavailable" }, { status: 503 });
  }

  const sql = getSql();
  if (!sql) {
    return NextResponse.json({ error: "tracking_unavailable" }, { status: 503 });
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://checkup.cerebroamigo.com.br";

  let due: { id: number; series_token: string; email: string }[];
  try {
    due = await sql<{ id: number; series_token: string; email: string }[]>`
      SELECT r.id AS id,
             s.series_token AS series_token,
             pgp_sym_decrypt(r.email_enc, ${key})::text AS email
      FROM checkup.tracking_reminders r
      JOIN checkup.tracking_series s ON s.id = r.series_id
      WHERE r.sent_at IS NULL
        AND r.unsubscribed = FALSE
        AND r.due_at <= now()
        AND s.deleted_at IS NULL
      ORDER BY r.due_at
      LIMIT ${BATCH}
    `;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: tracking/cron — busca de reminders falhou: ${msg}`);
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  if (due.length === 0) {
    return NextResponse.json({ processed: 0, sent: 0, failed: 0 });
  }

  let sent = 0;
  let failed = 0;

  for (const r of due) {
    try {
      const { subject, text } = buildNudgeEmail(buildNudgeLinks(siteUrl, r.series_token));
      await sendEmail({ to: r.email, subject, text });
      await sql`UPDATE checkup.tracking_reminders SET sent_at = now() WHERE id = ${r.id}`;
      sent++;
    } catch (err: unknown) {
      // Erro pontual de envio: não marca sent_at → retenta. Sem PII no log.
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Error: tracking/cron — envio falhou (reminder ${r.id}): ${msg}`);
    }
  }

  return NextResponse.json({ processed: due.length, sent, failed });
}
