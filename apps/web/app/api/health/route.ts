import { connection } from "next/server"

// Probe de saude do ALB (web-asg-alb.yaml) e do HEALTHCHECK do Dockerfile.
//
// Anti-cold-start: numa instancia recem-criada (deploy/instance-refresh ou failover
// do ASG) a 1a render paga o JIT do Next standalone. Aqui exercitamos as rotas
// publicas de entrada (/ e /login) no boot do processo e so devolvemos 200 DEPOIS
// de quente. Como o ALB so marca a instancia InService apos 200 (HealthyThreshold=2),
// nenhum usuario cai numa instancia fria.
//
// Sob `cacheComponents` (next.config.mjs) nao se usa `export const dynamic`;
// connection() opta por avaliacao a cada request, pra refletir `ready` ao vivo
// (senao o handler seria pre-renderizado no build com ready=false p/ sempre).

const PORT = process.env.PORT || "3000"
const ON_VERCEL = process.env.VERCEL === "1"
let ready = false
let warming = false

async function warm() {
  if (warming || ready) return
  warming = true
  try {
    await Promise.all([
      fetch(`http://127.0.0.1:${PORT}/`, { cache: "no-store" }),
      fetch(`http://127.0.0.1:${PORT}/login`, { cache: "no-store" }),
    ])
  } catch {
    // best-effort: se o warmup falhar, liberamos mesmo assim (nao travar o ALB).
  }
  ready = true
}

// Dispara no carregamento do modulo — 1o probe ao /api/health no boot da instancia.
// No Vercel nao ha ALB nem processo persistente a aquecer; um 503 no primeiro
// cold start seria apenas um falso negativo. O warmup continua ativo no EC2.
if (!ON_VERCEL) warm()

export async function GET() {
  await connection()
  const healthy = ON_VERCEL || ready
  return new Response(healthy ? "ok" : "warming", {
    status: healthy ? 200 : 503,
    headers: { "cache-control": "no-store" },
  })
}
