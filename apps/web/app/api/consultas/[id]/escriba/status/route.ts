import { NextRequest, NextResponse } from "next/server"
import { gateway, gatewayErrorResponse } from "@/lib/gateway"

// Escriba (médico): status do consentimento do paciente (checar antes de gravar).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    return NextResponse.json(await gateway.get(`/api/v1/consultas/${id}/escriba/status`))
  } catch (err) {
    return gatewayErrorResponse(err)
  }
}
