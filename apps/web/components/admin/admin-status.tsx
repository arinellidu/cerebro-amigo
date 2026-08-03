"use client"

import { createContext, useContext, useEffect, useState } from "react"

// Status operacional do admin, compartilhado entre a sidebar (pontos) e a
// zona-herói da visão geral. Um único poller (60s) sobre endpoints que já
// existem — sem backend novo. Tolerante a falha: cai para zeros + flag de erro,
// nunca derruba o layout. Sem conteúdo clínico: só contagens.
export interface AdminStatus {
  crisesSemNotificacao: number
  automacoesPausadas: number
  agentesComErro: number
  loading: boolean
  erro: boolean
}

const VAZIO: AdminStatus = {
  crisesSemNotificacao: 0,
  automacoesPausadas: 0,
  agentesComErro: 0,
  loading: true,
  erro: false,
}

const Ctx = createContext<AdminStatus>(VAZIO)
export const useAdminStatus = () => useContext(Ctx)

export function AdminStatusProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AdminStatus>(VAZIO)

  useEffect(() => {
    let vivo = true

    async function carregar() {
      const [crises, agentes] = await Promise.all([
        fetch("/api/admin/crises").then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch("/api/admin/agentes-saude").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ])
      if (!vivo) return
      setStatus({
        crisesSemNotificacao: crises?.semNotificacao ?? 0,
        automacoesPausadas: crises?.automacaoPausada ?? 0,
        agentesComErro: Array.isArray(agentes?.errosRecentes) ? agentes.errosRecentes.length : 0,
        loading: false,
        erro: crises == null && agentes == null,
      })
    }

    carregar()
    const id = setInterval(carregar, 60_000)
    return () => {
      vivo = false
      clearInterval(id)
    }
  }, [])

  return <Ctx.Provider value={status}>{children}</Ctx.Provider>
}
