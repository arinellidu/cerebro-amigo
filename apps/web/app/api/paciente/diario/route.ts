import { NextRequest, NextResponse } from "next/server"
import { gatewayFetch } from "@/lib/gateway-fetch"
import { cookies } from "next/headers"
import { isSameOrigin } from "@/lib/same-origin"

const GATEWAY = process.env.API_GATEWAY_URL ?? "http://localhost:5050"

async function getToken() {
  const store = await cookies()
  return store.get("paciente_token")?.value ?? null
}

export async function GET() {
  const token = await getToken()
  if (!token) return NextResponse.json({ erro: "não autenticado" }, { status: 401 })

  const res = await gatewayFetch(`${GATEWAY}/api/v1/portal/paciente/diario/?pageSize=30`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  })
  const body = await res.text()
  return new NextResponse(body, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  })
}

export async function POST(req: NextRequest) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const token = await getToken()
  if (!token) return NextResponse.json({ erro: "não autenticado" }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body?.conteudo) {
    return NextResponse.json({ erro: "conteudo obrigatório" }, { status: 400 })
  }

  const res = await gatewayFetch(`${GATEWAY}/api/v1/portal/paciente/diario/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      titulo: body.titulo ?? null,
      conteudo: body.conteudo,
      humor: body.humor ?? null,
      tags: body.tags ?? [],
      compartilharComMedico: body.compartilharComMedico ?? false,
      tipo: body.tipo ?? "texto",
      transcricao: body.transcricao ?? null,
    }),
  })

  const respBody = await res.text()
  return new NextResponse(respBody, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  })
}
