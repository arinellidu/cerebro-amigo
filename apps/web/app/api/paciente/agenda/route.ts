import { NextRequest, NextResponse } from "next/server"
import { gatewayFetch } from "@/lib/gateway-fetch"
import { cookies } from "next/headers"
import { isSameOrigin } from "@/lib/same-origin"

const GATEWAY = process.env.API_GATEWAY_URL ?? "http://localhost:5050"

async function tok() {
  return (await cookies()).get("paciente_token")?.value ?? null
}

// Minhas consultas
export async function GET() {
  const token = await tok()
  if (!token) return NextResponse.json({ erro: "não autenticado" }, { status: 401 })
  const res = await gatewayFetch(`${GATEWAY}/api/v1/portal/paciente/agenda`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  })
  return new NextResponse(await res.text(), {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  })
}

// Agendar consulta (nasce pendente de confirmação do médico)
export async function POST(req: NextRequest) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const token = await tok()
  if (!token) return NextResponse.json({ erro: "não autenticado" }, { status: 401 })
  const b = await req.json().catch(() => null)
  if (!b?.iniciaEm) return NextResponse.json({ erro: "iniciaEm obrigatório" }, { status: 400 })
  const res = await gatewayFetch(`${GATEWAY}/api/v1/portal/paciente/agenda`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ iniciaEm: b.iniciaEm, modalidade: b.modalidade ?? "teleconsulta" }),
  })
  return new NextResponse(res.status === 204 ? null : await res.text(), {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  })
}
