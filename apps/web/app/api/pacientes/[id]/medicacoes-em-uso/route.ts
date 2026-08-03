import { NextRequest, NextResponse } from "next/server"
import { gateway, GatewayError } from "@/lib/gateway"
import { isSameOrigin } from "@/lib/same-origin"

// Medicações em uso (reconciliação, ADR-062) do paciente. Tenant resolvido no gateway
// pelo JWT — o browser nunca manda médico/tenant.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    return NextResponse.json(await gateway.get(`/api/v1/medicacoes-em-uso/paciente/${id}`))
  } catch (err) {
    if (err instanceof GatewayError) return NextResponse.json({ error: err.body }, { status: err.status })
    return NextResponse.json({ error: "upstream_error" }, { status: 502 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  try {
    const data = await gateway.post(`/api/v1/medicacoes-em-uso/paciente/${id}`, body)
    return NextResponse.json(data, { status: 201 })
  } catch (err) {
    if (err instanceof GatewayError) return NextResponse.json({ error: err.body }, { status: err.status })
    return NextResponse.json({ error: "upstream_error" }, { status: 502 })
  }
}
