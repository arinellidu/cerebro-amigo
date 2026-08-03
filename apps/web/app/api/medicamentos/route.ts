import { NextRequest, NextResponse } from "next/server"
import { gateway, GatewayError } from "@/lib/gateway"

// Catálogo de fármacos (read-only) — busca no `medicamentos` do gateway. Usado pelo
// picker de "Medicações em uso". Fonte autoritativa (não IA); descrição = revisão clínica.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? ""
  try {
    const data = await gateway.get(
      `/api/v1/medicamentos/?q=${encodeURIComponent(q)}&limit=20`,
    )
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof GatewayError)
      return NextResponse.json({ error: err.body }, { status: err.status })
    return NextResponse.json({ error: "upstream_error" }, { status: 502 })
  }
}
