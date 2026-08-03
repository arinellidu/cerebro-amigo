import { NextRequest, NextResponse } from "next/server"
import { gateway, gatewayErrorResponse } from "@/lib/gateway"
import { isSameOrigin } from "@/lib/same-origin"

// Gera URL de upload presigned (PUT direto no S3). O browser sobe o arquivo
// usando essa URL; depois chama POST /api/conta/documentos para registrar.

export async function POST(req: NextRequest) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "corpo_invalido" }, { status: 400 })
  try {
    return NextResponse.json(await gateway.post("/api/v1/conta/documentos/upload-url", body))
  } catch (e) {
    return gatewayErrorResponse(e)
  }
}
