import { NextRequest, NextResponse } from "next/server"
import { gateway, GatewayError } from "@/lib/gateway"

// Slots livres do médico logado num dia (YYYY-MM-DD).
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const data = searchParams.get("data")
  if (!data) return NextResponse.json({ error: "data obrigatória" }, { status: 400 })
  try {
    const d = await gateway.get(`/api/v1/consultas/disponibilidade?data=${encodeURIComponent(data)}`)
    return NextResponse.json(d)
  } catch (err) {
    if (err instanceof GatewayError) {
      if (err.status === 400) return NextResponse.json(err.body, { status: 400 })
      if (err.status === 401 || err.status === 403)
        return NextResponse.json({ error: "não autorizado" }, { status: 401 })
    }
    return NextResponse.json({ error: "erro interno" }, { status: 500 })
  }
}
