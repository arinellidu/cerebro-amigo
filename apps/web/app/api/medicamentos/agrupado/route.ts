import { NextResponse } from "next/server"
import { gateway, GatewayError } from "@/lib/gateway"

// Catálogo completo de fármacos (read-only) p/ o picker por classe terapêutica.
// O cliente agrupa por classe; o médico escolhe sem precisar lembrar o nome.
export async function GET() {
  try {
    const data = await gateway.get("/api/v1/medicamentos/agrupado")
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof GatewayError)
      return NextResponse.json({ error: err.body }, { status: err.status })
    return NextResponse.json({ error: "upstream_error" }, { status: 502 })
  }
}
