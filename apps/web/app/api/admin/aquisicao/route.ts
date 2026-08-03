import { NextResponse } from "next/server"
import { gateway, GatewayError } from "@/lib/gateway"

/**
 * Cockpit de Aquisição — Cérebro Amigo (https://www.cerebroamigo.com.br).
 *
 * Agrega DUAS fontes ISOLADAS e calcula a métrica norte do Check-up Mental
 * ("médicos cadastrados por 1.000 testes concluídos"):
 *   • Gateway clínico (schema `public`): médicos por origem + status de assinatura.
 *   • Check-up Mental (schema `checkup`): funil de testes/eventos por escala.
 *
 * O JOIN é LÓGICO, aqui no BFF — cada serviço lê só o seu schema. O gateway clínico
 * NÃO tem grant no schema `checkup` (ADR-042/migration 0036); por isso a junção mora
 * no BFF (regra de fronteira: "agregação para tela → web/BFF"). ADR-046 / ADR-050.
 */

const CHECKUP_METRICS_URL =
  process.env.CHECKUP_METRICS_URL ?? "https://checkup.cerebroamigo.com.br/api/funnel-metrics"

interface EscalaFunil {
  scale: string
  testStarted: number
  testCompleted: number
  reportGenerated: number
}
interface FunnelMetrics {
  eventos: Record<string, number>
  escalas: EscalaFunil[]
  testCompletedPorMes: { mes: string; n: number }[]
  geradoEm: string
}

interface AquisicaoClinico {
  porOrigem: { origem: string; n: number }[]
  checkup: {
    total: number
    ativos: number
    emTrial: number
    ridsAtribuidos: number
    porStatus: { status: string; n: number }[]
    cadastrosPorMes: { mes: string; n: number }[]
    recentes: { medicoNome: string | null; status: string; rid: string | null; criadoEm: string }[]
  }
}

async function fetchCheckup(): Promise<{ data: FunnelMetrics | null; erro: string | null }> {
  const token = process.env.CHECKUP_METRICS_TOKEN
  if (!token) return { data: null, erro: "CHECKUP_METRICS_TOKEN não configurado" }
  try {
    const r = await fetch(CHECKUP_METRICS_URL, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(5000), // não pendurar o cockpit se o Check-up lentar
    })
    if (!r.ok) return { data: null, erro: `Check-up respondeu ${r.status}` }
    return { data: (await r.json()) as FunnelMetrics, erro: null }
  } catch {
    return { data: null, erro: "Check-up inacessível" }
  }
}

export async function GET() {
  try {
    // Lado clínico (gateway, com cookie auth) e lado checkup (token) em paralelo.
    const [clinico, checkup] = await Promise.all([
      gateway.get<AquisicaoClinico>("/api/v1/admin/aquisicao"),
      fetchCheckup(),
    ])

    const testCompleted = checkup.data?.eventos.test_completed ?? 0
    const medicosCheckup = clinico.checkup?.total ?? 0
    // métrica norte: médicos cadastrados por 1.000 testes concluídos
    const medicosPor1000 = testCompleted > 0 ? (medicosCheckup / testCompleted) * 1000 : null

    return NextResponse.json({
      clinico,
      checkup: checkup.data,
      checkupErro: checkup.erro,
      metricaNorte: { medicosCheckup, medicosAtivos: clinico.checkup?.ativos ?? 0, testCompleted, medicosPor1000 },
      site: "https://www.cerebroamigo.com.br",
    })
  } catch (err) {
    if (err instanceof GatewayError) {
      if (err.status === 401 || err.status === 403)
        return NextResponse.json({ error: "não autorizado" }, { status: 401 })
      // preserva a semântica do gateway (404/409/429/503…) em vez de achatar tudo em 500
      return NextResponse.json({ error: "erro no gateway" }, { status: err.status || 502 })
    }
    return NextResponse.json({ error: "erro interno" }, { status: 500 })
  }
}
