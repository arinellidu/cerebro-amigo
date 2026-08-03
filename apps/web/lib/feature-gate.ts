// Gate de FEATURE por plano (ADR-059), lado cliente. Espelha PlanCatalog/FeatureKeys do
// gateway: o backend é a fonte da verdade (402 `feature_requer_pro`); aqui só decidimos
// como mostrar o upsell e travar a afordância antes de chamar.

export const FEATURE = {
  briefingIa: "briefing_ia",
  iaInsights: "ia_insights",
  rag: "rag",
  escriba: "escriba",
} as const

export type FeatureKey = (typeof FEATURE)[keyof typeof FEATURE]

/** Rótulo humano de cada feature (copy de upsell). */
export const FEATURE_LABELS: Record<string, string> = {
  briefing_ia: "Briefing pré-consulta com IA",
  ia_insights: "Insights dos agentes",
  rag: "Busca semântica no prontuário",
  escriba: "Escriba — transcrição + rascunho",
}

/** Plano mínimo (label) que inclui a feature — fatiamento 1/+2/+1 do ADR-059. */
export const PLANO_MINIMO: Record<string, string> = {
  briefing_ia: "Essencial",
  ia_insights: "Pro",
  rag: "Pro",
  escriba: "Master",
}

/**
 * Nome humano do plano (sem preço) — código físico de `assinaturas.plano` → rótulo do
 * ADR-059. `trial`/`enterprise` são legados. Espelha o PLANO_LABEL do /admin/financeiro,
 * mas sem o valor (as telas do médico já mostram `valorMensal` num campo próprio).
 */
export const PLANO_NOME: Record<string, string> = {
  pendente: "Pendente",
  trial: "Trial (legado)",
  starter: "Essencial",
  pro: "Pro",
  master: "Master",
  enterprise: "Clínica (legado)",
}

/** Rótulo do plano p/ exibição; cai no próprio código se desconhecido, "—" se vazio. */
export function planoNome(p?: string | null): string {
  return p ? (PLANO_NOME[p] ?? p) : "—"
}

/** O plano atual (via me.features) inclui a feature? Usado p/ travar a UI proativamente. */
export function temFeature(features: string[] | undefined | null, feature: string): boolean {
  return Array.isArray(features) && features.includes(feature)
}

export interface FeatureGateBlock {
  feature: string
  checkoutUrl: string
}

/**
 * Detecta o bloqueio de feature numa resposta de fetch. Só dispara em 402 com
 * `feature_requer_pro` (não confunde com o 402 `assinatura_inativa` do paywall).
 * Usa res.clone() p/ não consumir o corpo do chamador.
 */
export async function readFeatureGate(res: Response): Promise<FeatureGateBlock | null> {
  if (res.status !== 402) return null
  const body = await res.clone().json().catch(() => null)
  if (body && body.error === "feature_requer_pro") {
    return {
      feature: String(body.feature ?? ""),
      checkoutUrl: String(body.checkoutUrl ?? "/dashboard/financeiro"),
    }
  }
  return null
}
