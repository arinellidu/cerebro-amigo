import { NextRequest, NextResponse } from "next/server"
import { gatewayFetch } from "@/lib/gateway-fetch"
import { cookies } from "next/headers"
import { isSameOrigin } from "@/lib/same-origin"

const GATEWAY = process.env.API_GATEWAY_URL ?? "http://localhost:5050"

// Proxy SSE da resposta da IA na Vercel (Fluid Compute): teto de execução da
// Function. Uma resposta de LLM cabe com folga em 300s. POST-stream (não é
// EventSource) não reconecta sozinho → manter folga p/ não truncar a geração.
export const maxDuration = 300

async function token() {
  return (await cookies()).get("paciente_token")?.value ?? null
}

// Histórico read-only da conversa (mensagens decifradas no gateway).
export async function GET() {
  const t = await token()
  if (!t) return NextResponse.json({ erro: "não autenticado" }, { status: 401 })

  const res = await gatewayFetch(`${GATEWAY}/api/v1/portal/paciente/conversa`, {
    headers: { Authorization: `Bearer ${t}` },
    cache: "no-store",
  })
  const body = await res.text()
  return new NextResponse(body, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  })
}

// Proxy SSE da conversa paciente↔IA. paciente_id é derivado do JWT no gateway
// (nunca do body). Repassa o stream sem bufferizar. NÃO loga o conteúdo da
// mensagem (LGPD — dado clínico cru não vai pra log).
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const t = await token()
  if (!t) return NextResponse.json({ erro: "não autenticado" }, { status: 401 })

  const body = await req.json().catch(() => null)
  const mensagem = typeof body?.mensagem === "string" ? body.mensagem : ""
  if (!mensagem.trim()) {
    return NextResponse.json({ erro: "mensagem obrigatória" }, { status: 400 })
  }
  const idempotencyKey =
    typeof body?.idempotencyKey === "string" && body.idempotencyKey
      ? body.idempotencyKey
      : crypto.randomUUID()

  let upstream: Response
  try {
    upstream = await gatewayFetch(`${GATEWAY}/api/portal/conversation/message`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${t}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ mensagem, idempotencyKey }),
      cache: "no-store",
    })
  } catch {
    return NextResponse.json({ erro: "serviço indisponível" }, { status: 502 })
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "")
    return new NextResponse(text || JSON.stringify({ erro: "falha no orquestrador" }), {
      status: upstream.status || 502,
      headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json" },
    })
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
