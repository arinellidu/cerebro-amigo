import { NextRequest, NextResponse } from "next/server"
import { gatewayProxy } from "@/lib/gateway-fetch"
import { cookies } from "next/headers"
import { isSameOrigin } from "@/lib/same-origin"

const GATEWAY = process.env.API_GATEWAY_URL ?? "http://localhost:5050"

// POST /api/paciente/audio/upload-url — gera presigned PUT para o S3
export async function POST(req: NextRequest) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const token = (await cookies()).get("paciente_token")?.value
  if (!token) return NextResponse.json({ erro: "não autenticado" }, { status: 401 })
  return gatewayProxy(`${GATEWAY}/api/v1/portal/paciente/mensagens-audio/upload-url`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  })
}
