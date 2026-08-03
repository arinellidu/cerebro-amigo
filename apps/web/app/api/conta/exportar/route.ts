import { NextResponse } from "next/server"
import { gateway, gatewayErrorResponse } from "@/lib/gateway"

// LGPD: baixa os dados de cadastro do médico como JSON (attachment).
export async function GET() {
  try {
    const data = await gateway.get("/api/v1/me/exportar")
    if (data === null || data === undefined) return NextResponse.json({ error: "sem_dados" }, { status: 502 })
    return new NextResponse(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": 'attachment; filename="meus-dados-cerebro-amigo.json"',
        // Dado pessoal (CPF) — nunca cachear em CDN/proxy/disco do browser.
        "Cache-Control": "no-store",
      },
    })
  } catch (e) {
    return gatewayErrorResponse(e)
  }
}
