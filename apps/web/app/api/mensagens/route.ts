import { NextResponse } from "next/server"
import { gateway, GatewayError } from "@/lib/gateway"

// Inbox de conversas do médico (revisão). Não loga conteúdo (LGPD).
export async function GET() {
  try {
    const data = await gateway.get("/api/v1/mensagens/conversas")
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof GatewayError && (err.status === 401 || err.status === 403))
      return NextResponse.json({ error: "não autorizado" }, { status: 401 })
    return NextResponse.json({ error: "erro interno" }, { status: 500 })
  }
}
