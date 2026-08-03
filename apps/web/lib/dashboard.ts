import { cache } from "react"
import { gateway } from "./gateway"
import { iniciais } from "./iniciais"

// Fontes reais (gateway .NET):
//   GET /api/v1/pacientes          → lista do médico logado
//   GET /api/v1/insights/pendentes → alertas dos agentes
// Sem endpoint de "stats" dedicado — derivamos no servidor a partir das duas
// listas. Uma única busca por request (React cache dedupe entre os <Suspense>).

interface PacienteListItem {
  numero: number
  id: string
  waId: string | null
  nome: string | null
  email: string | null
  prescricoesAtivas: number
  ultimaMsg: string | null
}

interface InsightDto {
  id: string
  pacienteId: string
  severidade: string
}

export interface RecentePaciente {
  id: string
  numero: number
  nome: string
  iniciais: string
  ultimaMsg: string | null
  severidade: string | null
}

export interface DashboardData {
  totalPacientes: number
  prescricoesAtivas: number
  insightsPendentes: number
  insightsCriticos: number
  ativosSemana: number
  recentes: RecentePaciente[]
}

const SEV_RANK: Record<string, number> = { critico: 1, urgente: 2, atencao: 3, info: 4 }

export const getDashboard = cache(async (): Promise<DashboardData> => {
  // Falha do gateway não derruba a página — cai pra vazio (zeros).
  const [pacientes, insights] = await Promise.all([
    gateway.get<PacienteListItem[]>("/api/v1/pacientes").catch(() => [] as PacienteListItem[]),
    gateway.get<InsightDto[]>("/api/v1/insights/pendentes").catch(() => [] as InsightDto[]),
  ])

  // Severidade mais alta por paciente (insight.pacienteId === paciente.id, ambos cliente_id).
  const sevPorPaciente = new Map<string, string>()
  for (const i of insights) {
    const atual = sevPorPaciente.get(i.pacienteId)
    if (!atual || (SEV_RANK[i.severidade] ?? 9) < (SEV_RANK[atual] ?? 9)) {
      sevPorPaciente.set(i.pacienteId, i.severidade)
    }
  }

  const seteDiasAtras = Date.now() - 7 * 24 * 60 * 60 * 1000
  const ativosSemana = pacientes.filter(
    (p) => p.ultimaMsg && new Date(p.ultimaMsg).getTime() >= seteDiasAtras,
  ).length

  const recentes: RecentePaciente[] = pacientes.slice(0, 5).map((p) => ({
    id: p.id,
    numero: p.numero,
    nome: p.nome ?? `Paciente ${p.numero}`,
    iniciais: iniciais(p.nome, "?"),
    ultimaMsg: p.ultimaMsg,
    severidade: sevPorPaciente.get(p.id) ?? null,
  }))

  return {
    totalPacientes: pacientes.length,
    prescricoesAtivas: pacientes.reduce((s, p) => s + (p.prescricoesAtivas ?? 0), 0),
    insightsPendentes: insights.length,
    insightsCriticos: insights.filter((i) => i.severidade === "critico" || i.severidade === "urgente").length,
    ativosSemana,
    recentes,
  }
})
