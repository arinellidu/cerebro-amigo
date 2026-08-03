import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateDevolutiva } from "@/lib/ai/devolutiva";
import { checkDevolutivaLimit } from "@/lib/ratelimit";
import { getClientIp } from "@/lib/client-ip";

const BodySchema = z.object({
  scaleId: z.enum(["phq9", "gad7", "asrs18", "audit", "mdq", "fagerstrom", "msi_bpd", "assist"]),
  totalScore: z.number().int().min(0).max(50),
  // .max() obrigatório: `bandLabel` entra CRU no prompt do LLM (devolutiva.ts). Sem teto,
  // o atacante manda string gigante e infla os input-tokens por chamada (max_tokens só
  // limita a SAÍDA) — vetor central de denial-of-wallet. O maior label legítimo
  // ("sintomas moderadamente graves") tem <40 chars; `band` é um slug curto.
  band: z.string().min(1).max(24),
  bandLabel: z.string().min(1).max(48),
  sessionId: z.string().uuid().optional(),
  partAPositives: z.number().int().min(0).max(18).optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const ip = getClientIp(req);
  const sessionId = parsed.data.sessionId ?? `anon-${ip}`;
  const limit = await checkDevolutivaLimit(ip, sessionId);

  if (!limit.allowed) {
    const retryAfter = Math.ceil(((limit.retryAfterMs ?? 3600000)) / 1000);
    return NextResponse.json(
      { error: "rate_limited", reason: limit.reason },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfter) },
      }
    );
  }

  const devolutiva = await generateDevolutiva(parsed.data);
  return NextResponse.json(devolutiva);
}
