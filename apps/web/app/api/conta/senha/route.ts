import { NextRequest, NextResponse } from "next/server"
import { gateway, gatewayErrorResponse } from "@/lib/gateway"
import { isSameOrigin } from "@/lib/same-origin"

// Trocar senha do médico logado (verifica a atual no gateway).
export async function POST(req: NextRequest) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "corpo_invalido" }, { status: 400 })
  try {
    await gateway.post("/api/v1/me/senha", body)
    return new NextResponse(null, { status: 204 })
  } catch (e) {
    return gatewayErrorResponse(e)
  }
}
