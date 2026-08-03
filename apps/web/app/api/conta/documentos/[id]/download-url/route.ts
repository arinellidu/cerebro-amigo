import { NextResponse } from "next/server"
import { gateway, gatewayErrorResponse } from "@/lib/gateway"

type Ctx = { params: Promise<{ id: string }> }

// Presigned GET (curto) para baixar um doc do próprio médico. RLS no gateway
// garante que só o dono recebe a key.
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params
  try {
    return NextResponse.json(await gateway.get(`/api/v1/conta/documentos/${id}/download-url`))
  } catch (e) {
    return gatewayErrorResponse(e)
  }
}
