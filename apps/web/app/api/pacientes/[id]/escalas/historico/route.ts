import { NextRequest, NextResponse } from "next/server"
import { gateway, GatewayError } from "@/lib/gateway"

// Histórico longitudinal de escalas (PHQ-9/GAD-7) de um paciente — Measurement-
// Based Care. Tenant é validado no gateway (JOIN pacientes.medico_responsavel_id).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const data = await gateway.get(`/api/v1/pacientes/${id}/escalas/historico`)
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof GatewayError && (err.status === 401 || err.status === 403))
      return NextResponse.json({ error: "não autorizado" }, { status: 401 })
    return NextResponse.json({ error: "erro interno" }, { status: 500 })
  }
}
