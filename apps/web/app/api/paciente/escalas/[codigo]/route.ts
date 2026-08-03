import { NextRequest, NextResponse } from "next/server"
import { gatewayFetch } from "@/lib/gateway-fetch"
import { cookies } from "next/headers"

const GATEWAY = process.env.API_GATEWAY_URL ?? "http://localhost:5050"

// Instrumento versionado (PHQ-9/GAD-7) p/ o portal renderizar o formulário.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params
  const token = (await cookies()).get("paciente_token")?.value
  if (!token) return NextResponse.json({ erro: "não autenticado" }, { status: 401 })

  const res = await gatewayFetch(`${GATEWAY}/api/v1/portal/paciente/escalas/${codigo}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  })
  return new NextResponse(res.status === 204 ? null : await res.text(), {
    status: res.status,
    headers: { "Content-Type": res.headers.get("content-type") ?? "application/json" },
  })
}
