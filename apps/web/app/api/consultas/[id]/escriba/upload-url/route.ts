import { NextRequest, NextResponse } from "next/server"
import { gateway, gatewayErrorResponse } from "@/lib/gateway"
import { isSameOrigin } from "@/lib/same-origin"

// Escriba presencial (ADR-075): gera uma URL presigned (PUT) para o browser subir o
// áudio da consulta direto no S3 (dodge do cap 25MB base64). Body { contentType }.
// Retorna { uploadUrl, s3Key }.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  try {
    return NextResponse.json(await gateway.post(`/api/v1/consultas/${id}/escriba/upload-url`, body))
  } catch (err) {
    return gatewayErrorResponse(err)
  }
}
