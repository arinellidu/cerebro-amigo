import { NextRequest, NextResponse } from "next/server"
import { gatewayProxy } from "@/lib/gateway-fetch"
import { cookies } from "next/headers"
import { isSameOrigin } from "@/lib/same-origin"

const GATEWAY = process.env.API_GATEWAY_URL ?? "http://localhost:5050"

async function tok() {
  return (await cookies()).get("paciente_token")?.value ?? null
}

// GET /api/paciente/audio — listar mensagens
export async function GET() {
  const token = await tok()
  if (!token) return NextResponse.json({ erro: "não autenticado" }, { status: 401 })
  return gatewayProxy(`${GATEWAY}/api/v1/portal/paciente/mensagens-audio`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

// POST /api/paciente/audio — registrar após upload
export async function POST(req: NextRequest) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const token = await tok()
  if (!token) return NextResponse.json({ erro: "não autenticado" }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (!body?.s3Key) return NextResponse.json({ erro: "s3Key obrigatório" }, { status: 400 })
  return gatewayProxy(`${GATEWAY}/api/v1/portal/paciente/mensagens-audio`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ s3Key: body.s3Key, duracaoS: body.duracaoS ?? 0 }),
  })
}
