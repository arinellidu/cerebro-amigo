import { NextResponse } from "next/server"
import { gateway, GatewayError } from "@/lib/gateway"

export async function GET() {
  try {
    const data = await gateway.get("/api/v1/insights/pendentes")
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof GatewayError) {
      // 402 = feature_requer_pro (ADR-059): repassa o corpo intacto p/ o widget abrir upsell.
      if (err.status === 402) return NextResponse.json(err.body, { status: 402 })
      return NextResponse.json({ error: err.body }, { status: err.status })
    }
    return NextResponse.json({ error: "upstream_error" }, { status: 502 })
  }
}
