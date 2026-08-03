import { NextResponse } from "next/server"
import { gateway, GatewayError } from "@/lib/gateway"

// Check-ins de humor recentes (auto-relato dos pacientes do médico).
export async function GET() {
  try {
    const data = await gateway.get("/api/v1/evolucao/checkins")
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof GatewayError) {
      return NextResponse.json({ error: err.body }, { status: err.status })
    }
    return NextResponse.json({ error: "upstream_error" }, { status: 502 })
  }
}
