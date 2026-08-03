import { NextResponse } from "next/server"
import { gateway, gatewayErrorResponse } from "@/lib/gateway"

// Fila de renovações de receita do médico logado (A4). status=pendente por default.
export async function GET(req: Request) {
  try {
    const status = new URL(req.url).searchParams.get("status") ?? "pendente"
    const data = await gateway.get(`/api/v1/renovacoes?status=${encodeURIComponent(status)}`)
    return NextResponse.json(data)
  } catch (err) {
    return gatewayErrorResponse(err)
  }
}
