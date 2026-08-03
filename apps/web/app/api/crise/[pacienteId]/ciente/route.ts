import { NextRequest, NextResponse } from "next/server"
import { gateway, GatewayError } from "@/lib/gateway"
import { isSameOrigin } from "@/lib/same-origin"

// Médico confirma ciência da crise (ack). Encerra a escada de escalonamento
// do notifier (ADR-041) sem retomar a automação — isso é um ato clínico à parte.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ pacienteId: string }> },
) {
  // CSRF (T1-9): cookie de sessão é sameSite=lax e não barra POST cross-site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ erro: "origem inválida" }, { status: 403 })
  }
  const { pacienteId } = await params
  try {
    await gateway.post(`/api/v1/crise/${pacienteId}/ciente`, {})
    return new NextResponse(null, { status: 204 })
  } catch (err) {
    if (err instanceof GatewayError) {
      return NextResponse.json({ error: err.body }, { status: err.status })
    }
    return NextResponse.json({ error: "upstream_error" }, { status: 502 })
  }
}
