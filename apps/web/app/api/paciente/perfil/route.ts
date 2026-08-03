import { NextRequest, NextResponse } from "next/server"
import { gatewayFetch } from "@/lib/gateway-fetch"
import { cookies } from "next/headers"
import { isSameOrigin } from "@/lib/same-origin"

const GATEWAY = process.env.API_GATEWAY_URL ?? "http://localhost:5050"

async function tok() {
  return (await cookies()).get("paciente_token")?.value ?? null
}

export async function GET() {
  const token = await tok()
  if (!token) return NextResponse.json({ erro: "não autenticado" }, { status: 401 })
  const res = await gatewayFetch(`${GATEWAY}/api/v1/portal/paciente/perfil`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  })
  return new NextResponse(await res.text(), {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  })
}

export async function PATCH(req: NextRequest) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const token = await tok()
  if (!token) return NextResponse.json({ erro: "não autenticado" }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const res = await gatewayFetch(`${GATEWAY}/api/v1/portal/paciente/perfil`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      nome: body?.nome ?? null,
      email: body?.email ?? null,
      cpf: body?.cpf ?? null,
      telefone: body?.telefone ?? null,
      cep: body?.cep ?? null,
      logradouro: body?.logradouro ?? null,
      numero: body?.numero ?? null,
      complemento: body?.complemento ?? null,
      bairro: body?.bairro ?? null,
      cidade: body?.cidade ?? null,
      uf: body?.uf ?? null,
    }),
  })
  return new NextResponse(res.status === 204 ? null : await res.text(), {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  })
}
