import { NextRequest, NextResponse } from "next/server"
import { gateway, GatewayError } from "@/lib/gateway"
import { isSameOrigin } from "@/lib/same-origin"

// Importação em lote de pacientes. O array validado vem do client (preview .xlsx).
// Multi-tenant: o gateway escopa tudo ao médico do JWT (cookie auth_token).
export async function POST(req: NextRequest) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const body = await req.json().catch(() => null)
  if (!body || !Array.isArray(body.pacientes)) {
    return NextResponse.json(
      { error: "corpo inválido: esperado { pacientes: [...] }" },
      { status: 400 },
    )
  }

  try {
    const data = await gateway.post("/api/v1/pacientes/importar", body)
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof GatewayError) {
      if (err.status === 401 || err.status === 403)
        return NextResponse.json({ error: "não autorizado" }, { status: 401 })
    }
    return NextResponse.json({ error: "erro interno" }, { status: 500 })
  }
}
