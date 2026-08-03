import { NextRequest, NextResponse } from "next/server"
import { gateway, GatewayError } from "@/lib/gateway"

// Série de humor (médio por dia). ?dias=N (default 30 no gateway).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const dias = new URL(req.url).searchParams.get("dias")
  const sufixo = dias ? `?dias=${encodeURIComponent(dias)}` : ""
  try {
    const data = await gateway.get(`/api/v1/pacientes/${id}/humor${sufixo}`)
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof GatewayError && (err.status === 401 || err.status === 403))
      return NextResponse.json({ error: "não autorizado" }, { status: 401 })
    return NextResponse.json({ error: "erro interno" }, { status: 500 })
  }
}
