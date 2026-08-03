import { NextResponse } from "next/server"
import { gateway, gatewayErrorResponse } from "@/lib/gateway"

// Resumo financeiro + ROI do médico (cockpit de monetização).
export async function GET() {
  try {
    const data = await gateway.get("/api/v1/financeiro/resumo")
    return NextResponse.json(data)
  } catch (err) {
    return gatewayErrorResponse(err)
  }
}
