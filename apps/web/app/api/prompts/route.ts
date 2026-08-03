import { NextRequest, NextResponse } from "next/server"
import { gateway, GatewayError } from "@/lib/gateway"
import { promptTravado } from "@/lib/prompts-guard"
import { isSameOrigin } from "@/lib/same-origin"

/**
 * GET /api/prompts — lista prompts ativos do gateway.
 * POST /api/prompts — cria nova versão de prompt (admin only).
 */

export async function GET() {
  try {
    const data = await gateway.get("/api/v1/prompts/")
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof GatewayError) {
      if (err.status === 401 || err.status === 403)
        return NextResponse.json({ error: "não autorizado" }, { status: 401 })
    }
    return NextResponse.json({ error: "erro interno" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "corpo inválido" }, { status: 400 })

  // Defesa em profundidade (a trava definitiva vive no gateway): bloqueia já no
  // BFF a criação de versão de prompt de salvaguarda clínica (crise/auditoria).
  if (promptTravado(body.agente, body.nome))
    return NextResponse.json(
      {
        error: "prompt_travado",
        detalhe:
          "Prompt de salvaguarda clínica (detecção de crise / auditoria) não pode ser alterado pelo painel.",
      },
      { status: 409 },
    )

  try {
    const data = await gateway.post("/api/v1/prompts/", body)
    return NextResponse.json(data, { status: 201 })
  } catch (err) {
    if (err instanceof GatewayError) {
      if (err.status === 401 || err.status === 403)
        return NextResponse.json({ error: "não autorizado" }, { status: 401 })
      if (err.status === 400 || err.status === 409)
        return NextResponse.json(err.body, { status: err.status })
    }
    return NextResponse.json({ error: "erro interno" }, { status: 500 })
  }
}
