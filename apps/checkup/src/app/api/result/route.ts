import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { testResults } from "@/lib/db/schema";

// Persistência do resultado APENAS com consentimento explícito (LGPD — dado sensível).
// Anônimo: session_id é aleatório, sem PII, sem respostas item-a-item. Sem e-mail aqui
// (e-mail vive em tabela separada, sem FK — ver /api/email-report).
const BodySchema = z.object({
  sessionId: z.string().uuid(),
  scaleId: z.enum(["phq9", "gad7", "asrs18", "audit", "mdq", "fagerstrom", "msi_bpd", "assist"]),
  totalScore: z.number().int().min(0).max(100),
  band: z.string().min(1),
  crisisFlag: z.boolean().default(false),
  consented: z.literal(true), // só grava com consentimento — recusa qualquer outro valor
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
      .insert(testResults)
      .values({
        sessionId: parsed.data.sessionId,
        scaleId: parsed.data.scaleId,
        totalScore: parsed.data.totalScore,
        band: parsed.data.band,
        crisisFlag: parsed.data.crisisFlag,
        consented: true,
      })
      .onConflictDoNothing({ target: testResults.sessionId }) // idempotente (session_id UNIQUE)
      .catch((err: unknown) => {
        // não bloqueia o fluxo, mas loga (CK-2): stderr → CloudWatch → alarme.
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: falha ao gravar test_result (${parsed.data.scaleId}): ${msg}`);
      });
  }

  return NextResponse.json({ ok: true });
}
