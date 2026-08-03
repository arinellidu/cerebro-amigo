"use client"

import { useEffect, useState } from "react"

/** Perfil do médico logado — espelha GET /api/me → /api/v1/auth/me. */
export interface Me {
  medicoId: string
  nome: string
  crm: string | null
  especialidade: string | null
  usuarioId: string
  email: string
  role: string
  // Assinatura (ADR-055) — exposto p/ a UI (banner/paywall). SEM enforcement nesta
  // fase: o gate real vem na Fase D. `bloqueado` é só um sinal pro front aqui.
  assinaturaStatus?: string | null
  liberado?: boolean
  bloqueado?: boolean
  emPrazo?: boolean
  diasRestantes?: number | null
  motivo?: string
  prazoPagamentoAte?: string | null
  // ADR-065: trial de aquisição read-only (pendente, em prazo, sem plano pago). A UI
  // mostra banner read-only + teaser; escrita (exceto pacientes) e IA ficam bloqueadas.
  readOnly?: boolean
  // Plano + features de IA liberadas (ADR-059). `features` espelha PlanCatalog.FeaturesDe;
  // a UI usa p/ travar afordância de IA (mostrar upsell) antes mesmo de chamar o backend.
  plano?: string | null
  features?: string[]
  // ADR-066: avatar (presigned GET curto). Ausente = mostra iniciais.
  fotoUrl?: string | null
}

// Cache de módulo: evita refetch quando vários componentes (sidebar + header)
// usam o hook na mesma navegação.
let cache: Me | null = null
let inflight: Promise<Me | null> | null = null

function buscar(): Promise<Me | null> {
  if (cache) return Promise.resolve(cache)
  if (!inflight) {
    inflight = fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Me | null) => {
        cache = d
        return d
      })
      .catch(() => null)
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

export function useMe(): Me | null {
  // Sempre null no SSR e no primeiro paint do client — evita mismatch quando o
  // cache de módulo já foi preenchido (navegação anterior, HMR). Dados reais
  // entram no useEffect, após a hidratação.
  const [me, setMe] = useState<Me | null>(null)

  useEffect(() => {
    let vivo = true
    const aplicar = (d: Me | null) => {
      if (vivo) setMe(d)
    }
    if (cache) {
      aplicar(cache)
    } else {
      buscar().then(aplicar)
    }
    return () => {
      vivo = false
    }
  }, [])

  return me
}
