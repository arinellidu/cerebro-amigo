import { NextResponse } from "next/server"
import { gateway, gatewayErrorResponse } from "@/lib/gateway"

// Resumo de blindagem médico-legal (agregação read-only do que já existe).
export async function GET() {
  try {
    const data = await gateway.get("/api/v1/blindagem/resumo")
    return NextResponse.json(data)
  } catch (err) {
    return gatewayErrorResponse(err)
  }
}
