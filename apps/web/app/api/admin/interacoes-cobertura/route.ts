import { NextRequest, NextResponse } from "next/server"
import { gateway, GatewayError } from "@/lib/gateway"

// Relatório de pontos-cegos do A5: medicamentos prescritos sem match no dicionário.
export async function GET(req: NextRequest) {
  const ativasApenas = req.nextUrl.searchParams.get("ativasApenas") === "true"
  const qs = ativasApenas ? "?ativasApenas=true" : ""
  try {
    const data = await gateway.get(`/api/v1/admin/interacoes/cobertura${qs}`)
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof GatewayError && (err.status === 401 || err.status === 403))
      return NextResponse.json({ error: "não autorizado" }, { status: err.status })
    return NextResponse.json({ error: "erro interno" }, { status: 500 })
  }
}
