import { NextResponse } from "next/server"
import { gateway, GatewayError } from "@/lib/gateway"

// Assinatura da plataforma do médico logado (Fluxo A, ADR-034).
export async function GET() {
  try {
    const data = await gateway.get("/api/v1/minha-assinatura")
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof GatewayError) {
      if (err.status === 404) return NextResponse.json({ error: "sem_assinatura" }, { status: 404 })
      if (err.status === 401 || err.status === 403)
        return NextResponse.json({ error: "não autorizado" }, { status: err.status })
    }
    return NextResponse.json({ error: "erro interno" }, { status: 500 })
  }
}
