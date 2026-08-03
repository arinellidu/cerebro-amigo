import { NextResponse } from "next/server"
import { gateway, GatewayError } from "@/lib/gateway"

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const data = await gateway.get(`/api/v1/admin/medicos/${encodeURIComponent(id)}`)
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof GatewayError) {
      if (err.status === 404) return NextResponse.json({ error: "não encontrado" }, { status: 404 })
      if (err.status === 401 || err.status === 403)
        return NextResponse.json({ error: "não autorizado" }, { status: err.status })
    }
    return NextResponse.json({ error: "erro interno" }, { status: 500 })
  }
}
