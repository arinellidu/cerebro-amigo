import { NextRequest, NextResponse } from "next/server"
import { gateway, GatewayError } from "@/lib/gateway"
import { isSameOrigin } from "@/lib/same-origin"

export async function POST(req: NextRequest) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "corpo inválido" }, { status: 400 })
  try {
    const data = await gateway.post("/api/v1/admin/onboarding/medico", body)
    return NextResponse.json(data, { status: 201 })
  } catch (err) {
    if (err instanceof GatewayError) {
      if (err.status === 409) return NextResponse.json({ error: "email_em_uso" }, { status: 409 })
      if (err.status === 422) return NextResponse.json(err.body, { status: 422 }) // crm_invalido
      if (err.status === 503) return NextResponse.json(err.body, { status: 503 }) // cfm_indisponivel
      if (err.status === 500) return NextResponse.json(err.body, { status: 500 }) // crm_validacao_nao_configurada
      if (err.status === 400) return NextResponse.json(err.body, { status: 400 })
      if (err.status === 401 || err.status === 403)
        return NextResponse.json({ error: "não autorizado" }, { status: err.status })
    }
    return NextResponse.json({ error: "erro interno" }, { status: 500 })
  }
}
