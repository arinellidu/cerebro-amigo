import { NextRequest, NextResponse } from "next/server"
import { gateway, GatewayError } from "@/lib/gateway"
import { isSameOrigin } from "@/lib/same-origin"

// Re-emite o magic link de acesso do paciente (fluxo médico de recuperação).
// Proxia pro gateway, que ANCORA no médico do JWT (tenant — 404 se não for paciente
// dele), aplica rate-limit e ENVIA o link por e-mail ao próprio paciente (validade 1h).
// Retorna { enviado, email, url? } — `url` só vem como fallback se o e-mail falhar.
// O paciente abre a URL e define a própria senha em /p/entrar (hash + auditoria).
export async function POST(req: NextRequest) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const body = await req.json().catch(() => null)
  const email = typeof body?.email === "string" ? body.email.trim() : ""
  if (!email) return NextResponse.json({ error: "email obrigatório" }, { status: 400 })

  try {
    const data = await gateway.post("/api/v1/auth/paciente/magic-link", {
      email,
      proposito: "recuperacao",
    })
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof GatewayError) {
      if (err.status === 401 || err.status === 403)
        return NextResponse.json({ error: "não autorizado" }, { status: 401 })
      if (err.status === 404)
        return NextResponse.json({ error: "paciente não encontrado" }, { status: 404 })
      if (err.status === 429)
        return NextResponse.json({ error: "muitas tentativas, aguarde um pouco" }, { status: 429 })
    }
    return NextResponse.json({ error: "erro interno" }, { status: 500 })
  }
}
