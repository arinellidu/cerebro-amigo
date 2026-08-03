import type { NextRequest } from "next/server"

/**
 * Defesa de CSRF para Route Handlers que mudam estado (T1-9).
 *
 * Server Actions já têm proteção nativa do Next (compara Origin × Host); Route Handlers
 * (ex.: POST /api/auth/logout) não. Aceita só requisição same-origin: o header `Origin`
 * (ou, na ausência, `Referer`) precisa casar com o host efetivo — `X-Forwarded-Host`
 * atrás do ALB, senão `Host`. Sem nenhuma das duas origens → rejeita (POST de browser
 * sempre manda Origin; form cross-site manda a origem do atacante).
 */
export function isSameOrigin(req: NextRequest): boolean {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host")
  if (!host) return false
  const source = req.headers.get("origin") ?? req.headers.get("referer")
  if (!source) return false
  try {
    return new URL(source).host === host
  } catch {
    return false
  }
}
