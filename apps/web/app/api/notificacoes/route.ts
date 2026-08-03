import { NextResponse } from "next/server"
import { gateway, GatewayError } from "@/lib/gateway"

export async function GET() {
  try {
    const data = await gateway.get("/api/v1/notificacoes")
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof GatewayError) {
      return NextResponse.json({ error: err.body }, { status: err.status })
    }
    return NextResponse.json({ error: "upstream_error" }, { status: 502 })
  }
}
