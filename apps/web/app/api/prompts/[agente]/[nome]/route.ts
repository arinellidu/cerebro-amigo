import { NextResponse } from "next/server"
import { gateway, GatewayError } from "@/lib/gateway"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ agente: string; nome: string }> }
) {
  try {
    const { agente, nome } = await params
    const data = await gateway.get(
      `/api/v1/prompts/${encodeURIComponent(agente)}/${encodeURIComponent(nome)}`
    )
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof GatewayError) {
      if (err.status === 401 || err.status === 403)
        return NextResponse.json({ error: "não autorizado" }, { status: 401 })
    }
    return NextResponse.json({ error: "erro interno" }, { status: 500 })
  }
}
