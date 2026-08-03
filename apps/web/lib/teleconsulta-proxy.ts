/**
 * Helpers de BFF para a sinalização da teleconsulta. Repassam o stream SSE do
 * gateway (sem bufferizar) e os sinais POST. Usados só em Route Handlers —
 * nunca expõem a URL do gateway ao browser. O cookie httpOnly (auth_token ou
 * paciente_token) é lido na rota e passado aqui como Bearer.
 *
 * Não logam o corpo: SDP/ICE contêm IP (PII). Só metadados, se necessário.
 */
import { NextResponse } from "next/server"
import { gatewayFetch } from "@/lib/gateway-fetch"

const GATEWAY = process.env.API_GATEWAY_URL ?? "http://localhost:5050"

/** Passthrough do SSE de sinalização (servidor→cliente). */
export async function proxySinalSSE(gatewayPath: string, token: string | undefined) {
  if (!token) return new NextResponse("não autenticado", { status: 401 })

  let upstream: Response
  try {
    upstream = await gatewayFetch(`${GATEWAY}${gatewayPath}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
      cache: "no-store",
    })
  } catch {
    return new NextResponse("serviço indisponível", { status: 502 })
  }

  if (!upstream.ok || !upstream.body) {
    return new NextResponse(await upstream.text().catch(() => ""), {
      status: upstream.status || 502,
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

/** Envia um sinal (offer/answer/candidate/bye) ao outro peer via gateway. */
export async function proxySinalPOST(
  gatewayPath: string,
  token: string | undefined,
  body: string,
) {
  if (!token) return NextResponse.json({ erro: "não autenticado" }, { status: 401 })

  const res = await gatewayFetch(`${GATEWAY}${gatewayPath}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body,
    cache: "no-store",
  })
  return new NextResponse(res.status === 204 ? null : await res.text(), {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  })
}
