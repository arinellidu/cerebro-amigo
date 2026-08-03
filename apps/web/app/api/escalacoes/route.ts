import { NextResponse } from "next/server"
import { gateway, GatewayError } from "@/lib/gateway"

// Conversas escaladas para atendimento humano (auditor/crise).
export async function GET() {
  try {
    const data = await gateway.get("/api/v1/escalacoes")
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof GatewayError) {
      return NextResponse.json({ error: err.body }, { status: err.status })
    }
    return NextResponse.json({ error: "upstream_error" }, { status: 502 })
  }
}
