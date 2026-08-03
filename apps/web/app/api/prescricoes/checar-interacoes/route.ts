import { NextRequest, NextResponse } from "next/server"
import { gateway, gatewayErrorResponse } from "@/lib/gateway"
import { isSameOrigin } from "@/lib/same-origin"

// Segunda barreira de interações/duplicidade (A5). Repassa o corpo ao gateway
// (determinístico, base local). { medicamentos?: string[], pacienteId?: string }
export async function POST(req: NextRequest) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  try {
    const body = await req.json().catch(() => ({}))
    const data = await gateway.post("/api/v1/prescricoes/checar-interacoes", body)
    return NextResponse.json(data)
  } catch (err) {
    return gatewayErrorResponse(err)
  }
}
