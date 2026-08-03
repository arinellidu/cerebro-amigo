import { NextRequest, NextResponse } from "next/server"
import { isSameOrigin } from "@/lib/same-origin"

export async function POST(req: NextRequest) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax, que não barra POST cross-site.
  // Sem isto, um form de outro site poderia forçar logout do médico (DoS).
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "origem_invalida" }, { status: 403 })
  }
  const res = NextResponse.json({ ok: true })
  res.cookies.set("auth_token", "", { httpOnly: true, path: "/", maxAge: 0 })
  return res
}
