import { NextRequest, NextResponse } from "next/server"
import { gateway, GatewayError } from "@/lib/gateway"
import { isSameOrigin } from "@/lib/same-origin"

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Ctx) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  try {
    await gateway.patch(`/api/v1/admin/assinaturas/${id}`, body)
    return new NextResponse(null, { status: 204 })
  } catch (err) {
    if (err instanceof GatewayError) {
      if (err.status === 400) return NextResponse.json(err.body ?? { error: "erro" }, { status: 400 })
      if (err.status === 404) return NextResponse.json({ error: "não encontrado" }, { status: 404 })
      // Falha ao cancelar a recorrência no Asaas (status='cancelada'): repassa o
      // detalhe p/ o admin saber que a cobrança pode seguir viva.
      if (err.status === 502 || err.status === 503)
        return NextResponse.json(err.body ?? { error: "erro" }, { status: err.status })
      if (err.status === 401 || err.status === 403)
        return NextResponse.json({ error: "não autorizado" }, { status: err.status })
    }
    return NextResponse.json({ error: "erro interno" }, { status: 500 })
  }
}

// Registrar pagamento manual
export async function POST(req: NextRequest, { params }: Ctx) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "corpo inválido" }, { status: 400 })
  try {
    const data = await gateway.post(`/api/v1/admin/assinaturas/${id}/pagamento`, body)
    return NextResponse.json(data, { status: 201 })
  } catch (err) {
    if (err instanceof GatewayError) {
      if (err.status === 400) return NextResponse.json(err.body ?? { error: "erro" }, { status: 400 })
      if (err.status === 404) return NextResponse.json({ error: "não encontrado" }, { status: 404 })
      if (err.status === 401 || err.status === 403)
        return NextResponse.json({ error: "não autorizado" }, { status: err.status })
    }
    return NextResponse.json({ error: "erro interno" }, { status: 500 })
  }
}
