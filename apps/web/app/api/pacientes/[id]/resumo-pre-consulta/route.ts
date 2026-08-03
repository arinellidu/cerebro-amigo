import { NextRequest, NextResponse } from "next/server"
import { gateway, GatewayError } from "@/lib/gateway"
import { isSameOrigin } from "@/lib/same-origin"

// GET retorna o último resumo cacheado: { ultimo: ResumoPreConsultaDto | null }
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const data = await gateway.get(`/api/v1/pacientes/${id}/resumo-pre-consulta`)
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof GatewayError) {
      // 402 = feature_requer_pro (ADR-059): briefing IA. Repassa p/ a UI abrir upsell.
      if (err.status === 402) return NextResponse.json(err.body, { status: 402 })
      if (err.status === 401 || err.status === 403)
        return NextResponse.json({ error: "não autorizado" }, { status: 401 })
    }
    return NextResponse.json({ error: "erro interno" }, { status: 500 })
  }
}

// POST dispara geração on-demand (agents-py). Pode demorar — deixa o gateway esperar.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const { id } = await params
  try {
    const data = await gateway.post(`/api/v1/pacientes/${id}/resumo-pre-consulta`, {})
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof GatewayError) {
      if (err.status === 401 || err.status === 403)
        return NextResponse.json({ error: "não autorizado" }, { status: 401 })
      // 502/500 do agents-py — repassa pra UI mostrar "tente de novo"
      return NextResponse.json(err.body ?? { error: "falha ao gerar" }, { status: err.status })
    }
    return NextResponse.json({ error: "erro interno" }, { status: 500 })
  }
}
