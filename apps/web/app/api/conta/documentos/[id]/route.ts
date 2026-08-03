import { NextRequest, NextResponse } from "next/server"
import { gateway, gatewayErrorResponse } from "@/lib/gateway"
import { isSameOrigin } from "@/lib/same-origin"

type Ctx = { params: Promise<{ id: string }> }

// Remove um doc que o próprio médico enviou (gateway barra 'disponibilizado').
export async function DELETE(req: NextRequest, { params }: Ctx) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const { id } = await params
  try {
    await gateway.delete(`/api/v1/conta/documentos/${id}`)
    return new NextResponse(null, { status: 204 })
  } catch (e) {
    return gatewayErrorResponse(e)
  }
}
