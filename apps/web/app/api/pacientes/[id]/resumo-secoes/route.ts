import { NextRequest, NextResponse } from "next/server"
import { gateway } from "@/lib/gateway"

// Contagens leves por seção do prontuário, p/ badges no menu. Reusa endpoints
// já validados (tenant resolvido no gateway pelo JWT) — sem SQL novo e sem risco
// de vazamento entre médicos. Cada fonte é tolerante a falha: se uma cair, aquela
// seção apenas não recebe badge (null), sem derrubar as demais.
async function contar(path: string, pick: (d: unknown) => number): Promise<number | null> {
  try {
    return pick(await gateway.get(path))
  } catch {
    return null
  }
}

const tamArray = (d: unknown) => (Array.isArray(d) ? d.length : 0)

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [medicacoes, exames, escalas] = await Promise.all([
    contar(`/api/v1/medicacoes-em-uso/paciente/${id}`, tamArray),
    contar(`/api/v1/pacientes/${id}/exames`, tamArray),
    contar(`/api/v1/pacientes/${id}/escalas/historico`, (d) => {
      const escalas = (d as { escalas?: unknown[] } | null)?.escalas
      return Array.isArray(escalas) ? escalas.length : 0
    }),
  ])

  return NextResponse.json({ medicacoes, exames, escalas })
}
