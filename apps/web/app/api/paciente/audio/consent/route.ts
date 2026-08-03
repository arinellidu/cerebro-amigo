import { NextRequest, NextResponse } from "next/server"
import { gatewayFetch } from "@/lib/gateway-fetch"
import { cookies } from "next/headers"
import { isSameOrigin } from "@/lib/same-origin"

const GATEWAY = process.env.API_GATEWAY_URL ?? "http://localhost:5050"

async function tok() {
  return (await cookies()).get("paciente_token")?.value ?? null
}

// GET — verificar consentimento
export async function GET() {
  const token = await tok()
  if (!token) return NextResponse.json({ erro: "não autenticado" }, { status: 401 })
  const res = await gatewayFetch(`${GATEWAY}/api/v1/portal/paciente/mensagens-audio/consent`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return new NextResponse(await res.text(), { status: res.status })
}

// POST — registrar consentimento
export async function POST(req: NextRequest) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const token = await tok()
  if (!token) return NextResponse.json({ erro: "não autenticado" }, { status: 401 })
  const res = await gatewayFetch(`${GATEWAY}/api/v1/portal/paciente/mensagens-audio/consent`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  })
  return new NextResponse(null, { status: res.status })
}
