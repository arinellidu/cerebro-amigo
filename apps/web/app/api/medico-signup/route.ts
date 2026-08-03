import { NextRequest, NextResponse } from "next/server"
import { gatewayFetch } from "@/lib/gateway-fetch"
import { isSameOrigin } from "@/lib/same-origin"

// BFF do auto-cadastro de médico externo (ADR-046). Repassa p/ o gateway
// POST /api/v1/auth/medico/signup. Anônimo (sem cookie). Encaminha o IP real do
// cliente (X-Forwarded-For) p/ o rate-limit por IP do gateway funcionar — senão o
// gateway veria sempre o IP do servidor web.
const GATEWAY = process.env.API_GATEWAY_URL ?? "http://localhost:5050"

export async function POST(req: NextRequest) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const body = await req.json().catch(() => null)
  // ADR-065: CPF obrigatório no signup (identidade forte + self-checkout Asaas).
  if (!body?.nome || !body?.email || !body?.crm || !body?.crmUf || !body?.cpf) {
    return NextResponse.json({ error: "campos_obrigatorios" }, { status: 400 })
  }

  // IP real do cliente: o que o Caddy/Vercel colocou no XFF da requisição que chegou aqui.
  const xff = req.headers.get("x-forwarded-for") ?? ""

  try {
    const r = await gatewayFetch(`${GATEWAY}/api/v1/auth/medico/signup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(xff ? { "X-Forwarded-For": xff } : {}),
      },
      body: JSON.stringify({
        nome: body.nome,
        email: body.email,
        crm: body.crm,
        crmUf: body.crmUf,
        cpf: body.cpf,
        src: body.src ?? null,
        rid: body.rid ?? null,
        // Token do Cloudflare Turnstile (ADR-055). O gateway é quem valida; aqui
        // só repassamos. null quando o captcha está desligado (sem site key).
        turnstileToken: body.turnstileToken ?? null,
      }),
      cache: "no-store",
    })
    return new NextResponse(await r.text(), {
      status: r.status,
      headers: { "content-type": "application/json" },
    })
  } catch {
    return NextResponse.json({ error: "erro_interno" }, { status: 502 })
  }
}
