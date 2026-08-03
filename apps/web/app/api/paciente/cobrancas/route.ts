import { NextResponse } from "next/server"
import { gatewayPaciente, GatewayPacienteError } from "@/lib/gateway-paciente"

// Cobranças pendentes do paciente logado (portal) — para pagar via Pix.
export async function GET() {
  try {
    const data = await gatewayPaciente.get("/api/v1/portal/paciente/cobrancas")
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof GatewayPacienteError && (err.status === 401 || err.status === 403))
      return NextResponse.json({ error: "nao_autorizado" }, { status: 401 })
    return NextResponse.json({ error: "erro" }, { status: 500 })
  }
}
