import { NextRequest, NextResponse } from "next/server"
import { gatewayFetch } from "@/lib/gateway-fetch"
import { cookies } from "next/headers"
import { isSameOrigin } from "@/lib/same-origin"

const GATEWAY = process.env.API_GATEWAY_URL ?? "http://localhost:5050"

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const token = (await cookies()).get("paciente_token")?.value
  if (!token) return NextResponse.json({ erro: "não autenticado" }, { status: 401 })

  const res = await gatewayFetch(`${GATEWAY}/api/v1/portal/paciente/onboarding/concluido`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  })
  return new NextResponse(res.status === 204 ? null : await res.text(), { status: res.status })
}
