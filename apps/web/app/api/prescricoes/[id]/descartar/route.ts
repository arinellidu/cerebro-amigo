import { NextRequest, NextResponse } from "next/server"
import { gateway, GatewayError } from "@/lib/gateway"
import { isSameOrigin } from "@/lib/same-origin"

// Médico descarta rascunho MEMED: sai da fila sem virar prescrição ativa. ADR-056.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const { id } = await params
  try {
    const data = await gateway.post(`/api/v1/prescricoes/${id}/descartar`, {})
    return NextResponse.json(data ?? { ok: true })
  } catch (err) {
    if (err instanceof GatewayError) {
      return NextResponse.json({ error: err.body }, { status: err.status })
    }
    return NextResponse.json({ error: "upstream_error" }, { status: 502 })
  }
}
