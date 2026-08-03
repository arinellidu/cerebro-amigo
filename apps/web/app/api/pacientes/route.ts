import { NextRequest, NextResponse } from "next/server"
import { gateway, GatewayError } from "@/lib/gateway"
import { isSameOrigin } from "@/lib/same-origin"

export async function GET() {
  try {
    const data = await gateway.get("/api/v1/pacientes/")
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof GatewayError) {
      if (err.status === 401 || err.status === 403)
        return NextResponse.json({ error: "não autorizado" }, { status: 401 })
    }
    return NextResponse.json({ error: "erro interno" }, { status: 500 })
  }
}

// Cria 1 paciente (fluxo médico). modo magic-link (default) ou senha provisória.
export async function POST(req: NextRequest) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "corpo inválido" }, { status: 400 })

  try {
    const data = await gateway.post("/api/v1/pacientes/", body)
    return NextResponse.json(data, { status: 201 })
  } catch (err) {
    if (err instanceof GatewayError) {
      if (err.status === 401 || err.status === 403)
        return NextResponse.json({ error: "não autorizado" }, { status: 401 })
      // 400 (validação) e 409 (duplicado/conflito) carregam mensagem clínica;
      // 402 (gate de assinatura, ADR-055) carrega o corpo do paywall p/ a UI.
      if (err.status === 400 || err.status === 402 || err.status === 409)
        return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json({ error: "erro interno" }, { status: 500 })
  }
}
