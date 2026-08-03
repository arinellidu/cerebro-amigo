import { NextRequest, NextResponse } from "next/server"
import { gatewayFetch } from "@/lib/gateway-fetch"
import { cookies } from "next/headers"
import { isSameOrigin } from "@/lib/same-origin"

const GATEWAY = process.env.API_GATEWAY_URL ?? "http://localhost:5050"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const token = (await cookies()).get("paciente_token")?.value
  if (!token) return NextResponse.json({ erro: "não autenticado" }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const res = await gatewayFetch(
    `${GATEWAY}/api/v1/portal/paciente/medicacoes/confirmar/${id}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ status: body?.status ?? "tomada", nota: body?.nota ?? null }),
    },
  )
  // 204 NoContent no sucesso
  return new NextResponse(res.status === 204 ? null : await res.text(), {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  })
}
