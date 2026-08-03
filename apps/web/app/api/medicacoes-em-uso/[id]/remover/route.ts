import { NextRequest, NextResponse } from "next/server"
import { gateway, GatewayError } from "@/lib/gateway"
import { isSameOrigin } from "@/lib/same-origin"

// Remove (desativa) uma medicação em uso. Soft-delete no gateway (mantém histórico).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const { id } = await params
  try {
    await gateway.post(`/api/v1/medicacoes-em-uso/${id}/remover`, {})
    return new NextResponse(null, { status: 204 })
  } catch (err) {
    if (err instanceof GatewayError) return NextResponse.json({ error: err.body }, { status: err.status })
    return NextResponse.json({ error: "upstream_error" }, { status: 502 })
  }
}
