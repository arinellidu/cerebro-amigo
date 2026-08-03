"use client"

import Link from "next/link"
import { ShieldAlert, PauseCircle, Activity, CheckCircle2, ChevronRight, type LucideIcon } from "lucide-react"
import { useAdminStatus } from "./admin-status"

// Zona-herói da visão geral: o que exige ação do admin AGORA. Mesma linguagem da
// "Fila de atenção" do dashboard médico. Supervisão de crise é a função nº1 do
// admin (clinical-safety) — não pode ficar escondida atrás de cliques.
type Severidade = "critico" | "alerta"

interface ItemAtencao {
  chave: string
  label: string
  valor: number
  detalhe: string
  href: string
  icon: LucideIcon
  sev: Severidade
}

const SEV_CFG: Record<Severidade, { card: string; icone: string; valor: string }> = {
  critico: {
    card: "border-destructive/30 bg-destructive/[0.06] hover:border-destructive/50",
    icone: "bg-destructive/15 text-destructive",
    valor: "text-destructive",
  },
  alerta: {
    card: "border-warning/30 bg-warning/[0.06] hover:border-warning/50",
    icone: "bg-warning/15 text-warning",
    valor: "text-warning",
  },
}

export function AdminAtencao() {
  const s = useAdminStatus()

  if (s.loading) {
    return <div className="h-[92px] animate-pulse rounded-2xl border border-noir-line bg-noir-surface" />
  }

  const todos: ItemAtencao[] = [
    {
      chave: "crises",
      label: "Crises sem notificação",
      valor: s.crisesSemNotificacao,
      detalhe: "Médico ainda não foi avisado",
      href: "/admin/crises",
      icon: ShieldAlert,
      sev: "critico",
    },
    {
      chave: "pausadas",
      label: "Automações pausadas",
      valor: s.automacoesPausadas,
      detalhe: "Pacientes com protocolo de crise ativo",
      href: "/admin/crises",
      icon: PauseCircle,
      sev: "alerta",
    },
    {
      chave: "agentes",
      label: "Agentes com erro recente",
      valor: s.agentesComErro,
      detalhe: "Falhas nas últimas execuções",
      href: "/admin/agentes",
      icon: Activity,
      sev: "alerta",
    },
  ]
  const itens = todos.filter((i) => i.valor > 0)

  const temCritico = itens.some((i) => i.sev === "critico")

  // Estado calmo — nada exige atenção. Reforça que o sistema está sob controle.
  if (itens.length === 0) {
    return (
      <section className="flex items-center gap-3 rounded-2xl border border-success/25 bg-success/[0.05] px-5 py-4">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-success/15 text-success">
          <CheckCircle2 className="h-4 w-4" />
        </span>
        <div>
          <p className="text-sm font-medium text-foreground">Nada exige atenção agora</p>
          <p className="text-xs text-muted-foreground">
            Sem crises pendentes, automações pausadas ou falhas de agente {s.erro && "· status parcial"}
          </p>
        </div>
      </section>
    )
  }

  return (
    <section
      className={`relative overflow-hidden rounded-2xl border bg-noir-surface p-5 ${
        temCritico ? "border-destructive/25 glow-coral-lg" : "border-warning/25"
      }`}
    >
      <span
        aria-hidden
        className={`absolute inset-x-0 top-0 h-px ${
          temCritico
            ? "bg-gradient-to-r from-transparent via-destructive/60 to-transparent"
            : "bg-gradient-to-r from-transparent via-warning/60 to-transparent"
        }`}
      />
      <div className="mb-4 flex items-center gap-2">
        <ShieldAlert className={`h-4 w-4 ${temCritico ? "text-destructive" : "text-warning"}`} />
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Precisa de atenção</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {itens.map((i) => {
          const cfg = SEV_CFG[i.sev]
          return (
            <Link
              key={i.chave}
              href={i.href}
              className={`group flex items-center gap-3 rounded-xl border p-3 transition-all ${cfg.card}`}
            >
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${cfg.icone}`}>
                <i.icon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className={`text-2xl font-bold tabular-nums ${cfg.valor}`}>{i.valor}</span>
                  <span className="truncate text-sm font-medium text-foreground">{i.label}</span>
                </div>
                <p className="truncate text-xs text-muted-foreground">{i.detalhe}</p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
            </Link>
          )
        })}
      </div>
    </section>
  )
}
