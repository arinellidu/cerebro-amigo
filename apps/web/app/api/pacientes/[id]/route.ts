import { NextRequest, NextResponse } from "next/server"
import { gateway, GatewayError } from "@/lib/gateway"

// Cabeçalho do prontuário: dados básicos de um paciente do médico logado.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    const data = await gateway.get(`/api/v1/pacientes/${id}`)
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof GatewayError) {
      if (err.status === 401 || err.status === 403)
        return NextResponse.json({ error: "não autorizado" }, { status: 401 })
      if (err.status === 404)
        return NextResponse.json({ error: "não encontrado" }, { status: 404 })
    }
    return NextResponse.json({ error: "erro interno" }, { status: 500 })
  }
}
