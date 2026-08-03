// Envio transacional do checkup via Resend (REST). Substitui o AWS SES (ADR-061):
// remove a dependência de SES production-access e alinha ao provider já usado no lado
// clínico (magic-link/crise/onboarding). LGPD: o dado-store do checkup segue no RDS
// sa-east-1 e o e-mail bruto NUNCA é gravado (só hash bcrypt / cifra em repouso) —
// muda só o TRANSPORTE do e-mail. Ponto único de troca de provider (config, não refactor).

const FROM_DEFAULT = "Check-up Mental <noreply@cerebroamigo.com.br>";

export interface EmailAttachment {
  filename: string;
  /** Conteúdo em base64 (ex.: pdf.toString("base64")). */
  contentBase64: string;
}

export interface SendEmailArgs {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
}

/**
 * Envia um e-mail via Resend. Lança em falha (HTTP != 2xx ou key ausente); o chamador
 * trata/loga SEM PII. Não grava nem loga o destinatário.
 */
export async function sendEmail({ to, subject, text, html, attachments }: SendEmailArgs): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY ausente");

  const body: Record<string, unknown> = {
    from: process.env.EMAIL_FROM ?? FROM_DEFAULT,
    to: [to],
    subject,
    text,
  };
  if (html) body.html = html;
  if (attachments?.length) {
    body.attachments = attachments.map((a) => ({ filename: a.filename, content: a.contentBase64 }));
  }

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`resend ${resp.status}: ${detail.slice(0, 200)}`);
  }
}
