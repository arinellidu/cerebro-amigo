import { NextRequest, NextResponse } from "next/server"
import { gatewayFetch } from "@/lib/gateway-fetch"
import { cookies } from "next/headers"
import { isSameOrigin } from "@/lib/same-origin"

const GATEWAY = process.env.API_GATEWAY_URL ?? "http://localhost:5050"

// Médico finaliza a teleconsulta a partir da agenda: o gateway agenda a
// expiração do link (válido até NOW()+15min, com cap de 120min após o fim
// previsto). Não derruba quem está na sala — só bloqueia reentrada depois.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const { id } = await params
  const token = (await cookies()).get("auth_token")?.value
  if (!token) return NextResponse.json({ erro: "não autenticado" }, { status: 401 })

  const res = await gatewayFetch(`${GATEWAY}/api/v1/consultas/${id}/video/finalizar`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  })
  return new NextResponse(res.status === 204 ? null : await res.text(), {
    status: res.status,
    headers: { "Content-Type": res.headers.get("content-type") ?? "application/json" },
  })
}
