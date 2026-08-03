import { NextRequest, NextResponse } from "next/server"
import { gateway, gatewayErrorResponse } from "@/lib/gateway"
import { isSameOrigin } from "@/lib/same-origin"

// LGPD: registra pedido de exclusão (soft — admin processa). Exige a senha atual
// (reautenticação, ADR-066 review) — encaminha o corpo ao gateway, que valida.
export async function POST(req: NextRequest) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const body = await req.json().catch(() => ({}))
  try {
    await gateway.post("/api/v1/me/exclusao", body ?? {})
    return new NextResponse(null, { status: 202 })
  } catch (e) {
    return gatewayErrorResponse(e)
  }
}
