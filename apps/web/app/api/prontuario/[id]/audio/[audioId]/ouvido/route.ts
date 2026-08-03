import { NextRequest, NextResponse } from "next/server"
import { gatewayFetch } from "@/lib/gateway-fetch"
import { cookies } from "next/headers"
import { isSameOrigin } from "@/lib/same-origin"

const GATEWAY = process.env.API_GATEWAY_URL ?? "http://localhost:5050"

// PATCH — marcar áudio como ouvido
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; audioId: string }> }
) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const { id, audioId } = await params
  const token = (await cookies()).get("auth_token")?.value
  if (!token) return NextResponse.json({ error: "não autorizado" }, { status: 401 })
  const res = await gatewayFetch(
    `${GATEWAY}/api/v1/prontuario/${id}/mensagens-audio/${audioId}/ouvido`,
    { method: "PATCH", headers: { Authorization: `Bearer ${token}` } }
  )
  return new NextResponse(null, { status: res.status })
}
