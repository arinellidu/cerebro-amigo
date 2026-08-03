import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { sendEmail } from "@/lib/email/resend";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { CheckupPDF } from "@/components/CheckupPDF";
import { getDb } from "@/lib/db";
import { reportEmails } from "@/lib/db/schema";
import { checkPdfLimit } from "@/lib/ratelimit";
import { getClientIp } from "@/lib/client-ip";

// Envio do relatório PDF por e-mail via Resend (ADR-061). LGPD: o e-mail bruto NUNCA é
// gravado — só o hash bcrypt em report_emails (tabela separada, sem FK com test_results).
// O dado do checkup segue no RDS sa-east-1; muda só o transporte do e-mail (mesmo
// provider do lado clínico). FROM/key vêm de env (EMAIL_FROM/RESEND_API_KEY).

const BodySchema = z.object({
  sessionId: z.string().uuid(),
  email: z.string().email(),
  // Espelha /api/result: e-mail vale p/ TODAS as escalas live (ADR-048/049), não só
  // as 3 originais — senão AUDIT/MDQ/Fagerström/MSI-BPD/ASSIST baixam PDF mas dão 400 no envio.
  scale: z.enum(["phq9", "gad7", "asrs18", "audit", "mdq", "fagerstrom", "msi_bpd", "assist"]),
  score: z.number().int().min(0).max(100),
  // .max(): band/label entram no react-pdf (renderToBuffer). Cap evita inflar CPU/RAM
  // e tamanho do anexo numa rota pública que dispara e-mail (custo externo).
  band: z.string().min(1).max(24),
  label: z.string().min(1).max(64),
  crisis: z.boolean().default(false),
});

// Corpo fixo do e-mail (texto). O PDF vai como anexo — o Resend monta o MIME.
const REPORT_TEXT =
  "Olá!\n\n" +
  "Segue em anexo o relatório da sua triagem no Check-up Mental.\n" +
  "É um instrumento de triagem — não é diagnóstico. Leve este PDF ao seu médico " +
  "ou psicólogo para uma avaliação completa.\n\n" +
  "Se precisar de apoio agora: CVV 188 (24h) · cvv.org.br\n\n" +
  "— Check-up Mental · Cérebro Amigo\n";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  // fail-closed: e-mail dispara Resend (custo externo + reputação do domínio clínico
  // compartilhado magic-link/crise/onboarding). Sob falha de DB, negar em vez de abrir.
  const limit = await checkPdfLimit(ip, true); // mesmo teto do PDF (envio gera 1 PDF; anti-spam por IP)
  if (!limit.allowed) {
    const retryAfter = Math.ceil((limit.retryAfterMs ?? 3600000) / 1000);
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const { sessionId, email, scale, score, band, label, crisis } = parsed.data;

  // gera o PDF (mesmo componente do /api/pdf)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdf = (await renderToBuffer(
    createElement(CheckupPDF, { scale, score, band, label, crisis, rid: sessionId.slice(0, 8) }) as any
  )) as Buffer;

  // envia via Resend (PDF como anexo base64)
  try {
    await sendEmail({
      to: email,
      subject: "Seu relatório do Check-up Mental",
      text: REPORT_TEXT,
      attachments: [{ filename: `checkup-${scale}.pdf`, contentBase64: pdf.toString("base64") }],
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: falha ao enviar relatório por e-mail (${scale}): ${msg}`);
    return NextResponse.json({ error: "send_failed" }, { status: 502 });
  }

  // grava report_emails só após envio OK — hash bcrypt, nunca o e-mail bruto
  const db = getDb();
  if (db) {
    const emailHash = await bcrypt.hash(email, 10);
    await db
      .insert(reportEmails)
      .values({ sessionId, emailHash })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: falha ao gravar report_email: ${msg}`);
      });
  }

  return NextResponse.json({ ok: true });
}
