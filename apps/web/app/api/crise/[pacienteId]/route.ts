import { NextRequest, NextResponse } from "next/server"
import { gateway, GatewayError } from "@/lib/gateway"

// Detalhe da última crise de um paciente (read-only). Tenant via JWT do médico.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ pacienteId: string }> },
) {
  const { pacienteId } = await params
  try {
    const data = await gateway.get(`/api/v1/crise/${pacienteId}`)
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof GatewayError) {
      return NextResponse.json({ error: err.body }, { status: err.status })
    }
    return NextResponse.json({ error: "upstream_error" }, { status: 502 })
  }
}
