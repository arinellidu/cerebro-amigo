import { NextRequest, NextResponse } from "next/server"
import { gateway, GatewayError } from "@/lib/gateway"

// Thread paciente↔assistente (revisão do médico). Não loga conteúdo (LGPD).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ pacienteId: string }> }) {
  const { pacienteId } = await params
  try {
    const data = await gateway.get(`/api/v1/mensagens/paciente/${pacienteId}`)
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof GatewayError && (err.status === 401 || err.status === 403))
      return NextResponse.json({ error: "não autorizado" }, { status: 401 })
    return NextResponse.json({ error: "erro interno" }, { status: 500 })
  }
}
