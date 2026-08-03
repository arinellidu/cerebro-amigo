import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { funnelEvents } from "@/lib/db/schema";

const EVENT_TYPES = [
  "test_started",
  "crisis_routed",
  "test_completed",
  "report_generated",
  "email_report_sent",
  "qr_scanned",
  "doctor_signup_started",
  "instagram_follow_click",
] as const;

// Lado paciente manda sessionId (UUID); lado médico (qr_scanned/doctor_signup_started
// no /medico) manda só o `rid` de 8 chars do QR. Pelo menos um é obrigatório (ADR-046).
const BodySchema = z
  .object({
    event: z.enum(EVENT_TYPES),
    sessionId: z.string().uuid().optional(),
    rid: z
      .string()
      .trim()
      .min(4)
      .max(32)
      .regex(/^[A-Za-z0-9-]+$/)
      .optional(),
    scaleId: z.enum(["phq9", "gad7", "asrs18", "audit", "mdq", "fagerstrom", "msi_bpd", "assist"]).optional(),
  })
  .refine((d) => d.sessionId != null || d.rid != null, {
    message: "sessionId ou rid obrigatório",
  });

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const db = getDb();
  if (db) {
    await db
      .insert(funnelEvents)
      .values({
        sessionId: parsed.data.sessionId ?? null,
        eventType: parsed.data.event,
        scaleId: parsed.data.scaleId ?? null,
        rid: parsed.data.rid ?? null,
      })
      .catch((err: unknown) => {
        // Analytics NÃO bloqueia o fluxo (retorna ok mesmo assim), mas o erro é
        // LOGADO p/ não ficar invisível (CK-2 — foi o que mascarou o bug de SSL).
        // stderr → CloudWatch → metric filter/alarme (CK-1). Sem PII: só a mensagem
        // do erro + tipo de evento (não o session_id nem payload).
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: falha ao gravar funnel_event (${parsed.data.event}): ${msg}`);
      });
  }

  return NextResponse.json({ ok: true });
}
