import { NextRequest, NextResponse } from "next/server"
import { gatewayFetch } from "@/lib/gateway-fetch"
import { cookies } from "next/headers"
import { isSameOrigin } from "@/lib/same-origin"

const GATEWAY = process.env.API_GATEWAY_URL ?? "http://localhost:5050"

async function tok() {
  return (await cookies()).get("paciente_token")?.value ?? null
}

// Registra subscription. Recebe o PushSubscription.toJSON() do browser:
//   { endpoint, keys: { p256dh, auth } }
export async function POST(req: NextRequest) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const token = await tok()
  if (!token) return NextResponse.json({ erro: "não autenticado" }, { status: 401 })
  const sub = await req.json().catch(() => null)
  const endpoint = sub?.endpoint
  const p256dh = sub?.keys?.p256dh
  const auth = sub?.keys?.auth
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ erro: "subscription inválida" }, { status: 400 })
  }
  const res = await gatewayFetch(`${GATEWAY}/api/v1/portal/paciente/push/subscribe`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint, p256dhKey: p256dh, authKey: auth }),
  })
  return new NextResponse(res.status === 204 ? null : await res.text(), { status: res.status })
}

// Cancela subscription. Recebe { endpoint }.
export async function DELETE(req: NextRequest) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const token = await tok()
  if (!token) return NextResponse.json({ erro: "não autenticado" }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const endpoint = body?.endpoint
  if (!endpoint) return NextResponse.json({ erro: "endpoint ausente" }, { status: 400 })
  const res = await gatewayFetch(`${GATEWAY}/api/v1/portal/paciente/push/unsubscribe`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  })
  return new NextResponse(res.status === 204 ? null : await res.text(), { status: res.status })
}
