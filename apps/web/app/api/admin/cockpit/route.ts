import { NextResponse } from "next/server"
import { gateway, GatewayError } from "@/lib/gateway"

// Cockpit de receita do /admin (Fluxo A): MRR, receita/mês, inadimplência, funil.
export async function GET() {
  try {
    const data = await gateway.get("/api/v1/admin/cockpit")
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof GatewayError && (err.status === 401 || err.status === 403))
      return NextResponse.json({ error: "não autorizado" }, { status: 401 })
    return NextResponse.json({ error: "erro interno" }, { status: 500 })
  }
}
