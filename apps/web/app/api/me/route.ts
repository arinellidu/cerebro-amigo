import { NextResponse } from "next/server"
import { gateway, GatewayError } from "@/lib/gateway"

// Valida a sessão e retorna perfil do médico logado.
// 200 = sessão válida + medico existe no DB.
// 401 = JWT inválido/expirado.
// 403 = JWT válido mas sem registro de médico (seed não foi executado).
export async function GET() {
  try {
    const data = await gateway.get("/api/v1/auth/me")
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof GatewayError) {
      if (err.status === 401)
        return NextResponse.json({ error: "sessao_expirada" }, { status: 401 })
      if (err.status === 403)
        return NextResponse.json({ error: "sem_conta_medico" }, { status: 403 })
    }
    return NextResponse.json({ error: "erro_conexao" }, { status: 502 })
  }
}
