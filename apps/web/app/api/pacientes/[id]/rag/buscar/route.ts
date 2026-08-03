import { NextRequest, NextResponse } from "next/server"
import { gateway, GatewayError } from "@/lib/gateway"
import { isSameOrigin } from "@/lib/same-origin"

// Busca semântica no prontuário do paciente (RAG, ADR-028). Retrieval-only:
// devolve trechos citados, sem conduta gerada. O tenant (medico_id) é validado e
// injetado no gateway a partir do JWT — o browser nunca envia o tenant.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const { id } = await params
  const body = await req.json().catch(() => null)
  const query = body?.query
  if (!query || typeof query !== "string" || !query.trim())
    return NextResponse.json({ error: "query obrigatória" }, { status: 400 })

  try {
    const data = await gateway.post(`/api/v1/pacientes/${id}/rag/buscar`, {
      query: query.trim(),
      k: body?.k,
      fontes: body?.fontes,
      incluirKb: body?.incluirKb ?? true,
    })
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof GatewayError) {
      // 402 = feature_requer_pro (ADR-059): RAG é Pro+. Repassa p/ a UI abrir upsell.
      if (err.status === 402) return NextResponse.json(err.body, { status: 402 })
      if (err.status === 401 || err.status === 403)
        return NextResponse.json({ error: "não autorizado" }, { status: 401 })
      if (err.status === 503)
        return NextResponse.json({ error: "busca indisponível" }, { status: 503 })
    }
    return NextResponse.json({ error: "erro interno" }, { status: 500 })
  }
}
