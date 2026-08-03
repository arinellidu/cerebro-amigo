import { NextRequest, NextResponse } from "next/server"
import { gateway, GatewayError } from "@/lib/gateway"
import { isSameOrigin } from "@/lib/same-origin"

// Agenda do médico no intervalo [de, ate). Default no gateway: hoje..+7d.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const qs = new URLSearchParams()
  const de = searchParams.get("de")
  const ate = searchParams.get("ate")
  if (de) qs.set("de", de)
  if (ate) qs.set("ate", ate)
  const sufixo = qs.toString() ? `?${qs}` : ""

  try {
    const data = await gateway.get(`/api/v1/consultas/${sufixo}`)
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof GatewayError && (err.status === 401 || err.status === 403))
      return NextResponse.json({ error: "não autorizado" }, { status: 401 })
    return NextResponse.json({ error: "erro interno" }, { status: 500 })
  }
}

// Agenda nova consulta.
export async function POST(req: NextRequest) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "corpo inválido" }, { status: 400 })
  try {
    const data = await gateway.post("/api/v1/consultas/", body)
    return NextResponse.json(data, { status: 201 })
  } catch (err) {
    if (err instanceof GatewayError) {
      if (err.status === 401 || err.status === 403)
        return NextResponse.json({ error: "não autorizado" }, { status: 401 })
      if (err.status === 400) return NextResponse.json(err.body, { status: 400 })
    }
    return NextResponse.json({ error: "erro interno" }, { status: 500 })
  }
}
