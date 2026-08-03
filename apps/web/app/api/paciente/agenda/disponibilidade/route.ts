import { NextRequest, NextResponse } from "next/server"
import { gatewayFetch } from "@/lib/gateway-fetch"
import { cookies } from "next/headers"

const GATEWAY = process.env.API_GATEWAY_URL ?? "http://localhost:5050"

// Slots livres do meu médico num dia (YYYY-MM-DD)
export async function GET(req: NextRequest) {
  const token = (await cookies()).get("paciente_token")?.value ?? null
  if (!token) return NextResponse.json({ erro: "não autenticado" }, { status: 401 })
  const data = req.nextUrl.searchParams.get("data")
  if (!data) return NextResponse.json({ erro: "data obrigatória" }, { status: 400 })
  const res = await gatewayFetch(
    `${GATEWAY}/api/v1/portal/paciente/agenda/disponibilidade?data=${encodeURIComponent(data)}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
  )
  return new NextResponse(await res.text(), {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  })
}
