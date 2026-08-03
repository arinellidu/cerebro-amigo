import { NextRequest, NextResponse } from "next/server"
import { gateway, gatewayErrorResponse } from "@/lib/gateway"
import { isSameOrigin } from "@/lib/same-origin"

// Escriba (médico): lê o rascunho factual, envia áudio para transcrição, edita o rascunho.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    return NextResponse.json(await gateway.get(`/api/v1/consultas/${id}/escriba`))
  } catch (err) {
    return gatewayErrorResponse(err)
  }
}

// Recebe { audioBase64, contentType } → gateway → agents-py (transcreve + rascunho).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  try {
    return NextResponse.json(await gateway.post(`/api/v1/consultas/${id}/escriba`, body))
  } catch (err) {
    return gatewayErrorResponse(err)
  }
}

// Médico edita o rascunho factual antes de aprovar.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  try {
    await gateway.patch(`/api/v1/consultas/${id}/escriba`, body)
    return new NextResponse(null, { status: 204 })
  } catch (err) {
    return gatewayErrorResponse(err)
  }
}
