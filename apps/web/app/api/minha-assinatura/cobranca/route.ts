import { NextResponse, type NextRequest } from "next/server"
import { gateway, GatewayError } from "@/lib/gateway"
import { isSameOrigin } from "@/lib/same-origin"

// Self-checkout do médico (ADR-055 Fase C): cria a cobrança Asaas da própria
// assinatura e devolve o invoiceUrl. Repassa os erros do gateway (cpf_obrigatorio,
// asaas_nao_configurado, ja_ativa, plano_invalido, asaas_*_falhou).
export async function POST(req: NextRequest) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "corpo_invalido" }, { status: 400 })
  try {
    const data = await gateway.post("/api/v1/minha-assinatura/cobranca", body)
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof GatewayError) return NextResponse.json(err.body, { status: err.status })
    return NextResponse.json({ error: "erro_conexao" }, { status: 502 })
  }
}
