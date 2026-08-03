import { NextRequest, NextResponse } from "next/server"
import { gateway, GatewayError } from "@/lib/gateway"

// GET — presigned URL de playback (1h)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; audioId: string }> }
) {
  const { id, audioId } = await params
  try {
    const data = await gateway.get(`/api/v1/prontuario/${id}/mensagens-audio/${audioId}/play-url`)
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof GatewayError && (err.status === 401 || err.status === 403))
      return NextResponse.json({ error: "não autorizado" }, { status: 401 })
    return NextResponse.json({ error: "erro interno" }, { status: 500 })
  }
}
