import { NextResponse } from "next/server"
import { gateway, gatewayErrorResponse } from "@/lib/gateway"

// Resumo de ROI do médico (agregação read-only — contagens, sem dado clínico).
export async function GET() {
  try {
    const data = await gateway.get("/api/v1/roi/resumo")
    return NextResponse.json(data)
  } catch (err) {
    return gatewayErrorResponse(err)
  }
}
