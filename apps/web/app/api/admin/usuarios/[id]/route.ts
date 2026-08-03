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
  const url = new URL(req.url)
  const action = url.searchParams.get("action") // "perfil" | "senha" | "role"
  const path =
    action === "senha" ? `/api/v1/admin/usuarios/${id}/senha`
    : action === "role" ? `/api/v1/admin/usuarios/${id}/role`
    : `/api/v1/admin/usuarios/${id}` // perfil: nome/email
  try {
    await gateway.patch(path, body)
    return new NextResponse(null, { status: 204 })
  } catch (err) {
    if (err instanceof GatewayError) {
      if (err.status === 409) return NextResponse.json(err.body, { status: 409 })
      if (err.status === 400) return NextResponse.json(err.body, { status: 400 })
      if (err.status === 401 || err.status === 403)
        return NextResponse.json({ error: "não autorizado" }, { status: err.status })
      if (err.status === 404) return NextResponse.json({ error: "não encontrado" }, { status: 404 })
    }
    return NextResponse.json({ error: "erro interno" }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const { id } = await params
  try {
    await gateway.post(`/api/v1/admin/usuarios/${id}/reativar`, {})
    return new NextResponse(null, { status: 204 })
  } catch (err) {
    if (err instanceof GatewayError) {
      if (err.status === 403) return NextResponse.json({ error: "não autorizado" }, { status: 403 })
      if (err.status === 404) return NextResponse.json({ error: "não encontrado" }, { status: 404 })
    }
    return NextResponse.json({ error: "erro interno" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const { id } = await params
  try {
    await gateway.delete(`/api/v1/admin/usuarios/${id}`)
    return new NextResponse(null, { status: 204 })
  } catch (err) {
    if (err instanceof GatewayError) {
      if (err.status === 400) return NextResponse.json(err.body, { status: 400 })
      if (err.status === 401 || err.status === 403)
        return NextResponse.json({ error: "não autorizado" }, { status: err.status })
      if (err.status === 404) return NextResponse.json({ error: "não encontrado" }, { status: 404 })
    }
    return NextResponse.json({ error: "erro interno" }, { status: 500 })
  }
}
