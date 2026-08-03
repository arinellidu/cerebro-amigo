"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import Link from "next/link"
import { useMe } from "@/lib/use-me"
import { Button } from "@/components/ui/button"
import { ShieldAlert, Lock, Check, Loader2 } from "lucide-react"
import { PagueViaPix } from "@/components/assinatura/pague-via-pix"
import { ReadOnlyBanner } from "@/components/assinatura/read-only-banner"

/**
 * Paywall do dashboard (ADR-055, Fase D — UI). Reflete o gate do gateway:
 * médico com assinatura bloqueada (pendente vencido / suspensa) vê a tela de
 * ativação no lugar do conteúdo; em prazo vê um banner de aviso.
 *
 * INVARIANTE CLÍNICA (clinical-safety #2/#3): o paywall NUNCA cega o médico para a
 * crise. (1) Rotas exentas (financeiro = onde paga) renderizam normal. (2) A própria
 * tela de paywall lista as CRISES ATIVAS e permite "Estou ciente" — usando a API de
 * crise, que o gateway não gateia. (3) Fail-open de UX: enquanto `me` carrega (null),
 * mostra o conteúdo; a barreira real é o gateway (402), não esta UI.
 */
interface CriseAtiva {
  pacienteId: string
  pacienteNome: string
  gatilho: string
  origem: string
}

// Rotas que um médico bloqueado PRECISA alcançar (não mostram paywall).
function isExempt(pathname: string): boolean {
  return pathname.startsWith("/dashboard/financeiro") // onde o médico paga/ativa
}

export function PaywallGate({ children }: { children: React.ReactNode }) {
  const me = useMe()
  const pathname = usePathname()

  // Carregando/erro → não bloqueia (o gateway é a barreira real).
  if (!me) return <>{children}</>

  if (me.bloqueado && !isExempt(pathname)) return <PaywallScreen motivo={me.motivo} />

  // ADR-065: trial de aquisição read-only tem precedência sobre o banner de prazo —
  // comunica que o painel está em modo demonstração (escrita/IA travadas, exceto pacientes).
  if (me.readOnly) return (<><ReadOnlyBanner dias={me.diasRestantes ?? null} />{children}</>)

  if (me.emPrazo) return (<><PrazoBanner dias={me.diasRestantes ?? null} />{children}</>)

  return <>{children}</>
}

function PrazoBanner({ dias }: { dias: number | null }) {
  return (
    <div className="sticky top-0 z-30 border-b border-amber-500/30 bg-amber-500/10 px-6 py-2.5 text-sm text-amber-700 dark:text-amber-400">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>
          Sua assinatura está pendente
          {dias != null ? ` — ${dias} dia${dias === 1 ? "" : "s"} para ativar` : ""}. Garanta seu acesso.
        </span>
        <Link href="/dashboard/financeiro">
          <Button size="sm" variant="outline" className="h-8">Ativar agora</Button>
        </Link>
      </div>
    </div>
  )
}

function PaywallScreen({ motivo }: { motivo?: string }) {
  const [crises, setCrises] = useState<CriseAtiva[]>([])

  useEffect(() => {
    let vivo = true
    fetch("/api/crise")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { if (vivo) setCrises(Array.isArray(d) ? d : []) })
      .catch(() => {})
    return () => { vivo = false }
  }, [])

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-lg space-y-6">
        {crises.length > 0 && <CriseConsole crises={crises} />}

        <div className="rounded-2xl border border-border/60 bg-card p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <Lock className="h-6 w-6 text-primary" />
          </div>
          <h1 className="mt-4 text-xl font-semibold text-foreground">Ative sua assinatura</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {motivo === "suspensa"
              ? "Sua assinatura está suspensa por falta de pagamento."
              : "O prazo de pagamento da sua assinatura venceu."}{" "}
            Reative para voltar ao painel.
          </p>
          <Link href="/dashboard/financeiro">
            <Button className="mt-5 w-full">Ativar assinatura</Button>
          </Link>
          <p className="mt-3 text-xs text-muted-foreground">
            Emergências de pacientes (crises) continuam ativas e não dependem da assinatura.
          </p>
        </div>

        {/* Modo bootstrap (sem Asaas): chave Pix p/ o médico pagar manualmente. */}
        <PagueViaPix />
      </div>
    </div>
  )
}

function CriseConsole({ crises }: { crises: CriseAtiva[] }) {
  return (
    <div className="rounded-2xl border border-coral/30 bg-coral/7 p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <ShieldAlert className="h-5 w-5 text-coral" /> Crises ativas ({crises.length})
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Acesso à crise não é bloqueado pela assinatura.
      </p>
      <ul className="mt-3 space-y-2">
        {crises.map((c) => (
          <CriseItem key={c.pacienteId} c={c} />
        ))}
      </ul>
    </div>
  )
}

function CriseItem({ c }: { c: CriseAtiva }) {
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)

  async function ciente() {
    setBusy(true)
    try {
      const r = await fetch(`/api/crise/${c.pacienteId}/ciente`, { method: "POST" })
      if (r.ok) setAck(true)
    } catch {
      /* alerta segue ativo; e-mail/push (ADR-041) é o canal garantido */
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/60 p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{c.pacienteNome}</p>
        <p className="text-xs text-muted-foreground">gatilho: {c.gatilho} · via {c.origem}</p>
      </div>
      {ack ? (
        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-emerald-600">
          <Check className="h-3.5 w-3.5" /> ciente
        </span>
      ) : (
        <Button size="sm" variant="outline" className="h-8 shrink-0" disabled={busy} onClick={ciente}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Estou ciente"}
        </Button>
      )}
    </li>
  )
}
