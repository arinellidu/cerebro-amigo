"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Users, MessageSquare, CheckSquare, TrendingUp, DollarSign,
  Activity, RefreshCw, Loader2, Cpu, ShieldCheck,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ErroCarregar } from "@/components/admin/erro-carregar"
import { AdminAtencao } from "@/components/admin/admin-atencao"

interface Metricas {
  totalMedicos: number
  totalPacientes: number
  medicosAtivos7d: number
  pacientesAtivos7d: number
  mensagens7d: number
  checkinsRespondidos7d: number
  trials: number
  pendentes: number
  assinaturasAtivas: number
  mrr: number
  receitaMes: number
  receitaTotal: number
  custoLlmMesUsd: number
  custoLlmTotalUsd: number
  lucroBrutoMes: number
  calculadoEm: string
}

function fmt(n: number, cifras = 2) {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: cifras, maximumFractionDigits: cifras })
}
function brl(n: number) {
  return `R$ ${fmt(n)}`
}
function usd(n: number) {
  return `$ ${fmt(n, 4)}`
}

interface KpiProps {
  title: string
  value: string
  sub?: string
  icon: React.ElementType
  iconCls?: string
  glow?: boolean
  coral?: boolean
}

function KpiCard({ title, value, sub, icon: Icon, iconCls, glow, coral }: KpiProps) {
  return (
    <Card
      className={`border-noir-line bg-noir-surface transition-all hover:-translate-y-0.5 ${
        glow ? "glow-purple-lg" : coral ? "glow-coral-lg" : ""
      }`}
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{title}</p>
          <span className={`grid h-9 w-9 place-items-center rounded-xl border border-noir-line ${iconCls ?? "bg-noir-surface-raised text-primary"}`}>
            <Icon className="h-4 w-4" />
          </span>
        </div>
        <p className="mt-3 text-3xl font-bold tracking-tight text-foreground">{value}</p>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  )
}

export default function AdminOverview() {
  const [m, setM] = useState<Metricas | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setRefreshing(true)
    try {
      const r = await fetch("/api/admin/metricas")
      if (r.status === 401) { window.location.href = "/login"; return }
      if (!r.ok) { setErro("Não foi possível carregar as métricas."); return }
      setM(await r.json()); setErro(null)
    } catch {
      setErro("Erro de conexão ao carregar as métricas.")
    } finally {
      setRefreshing(false)
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    carregar()
    const id = setInterval(carregar, 30_000) // polling 30s
    return () => clearInterval(id)
  }, [carregar])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  // Primeira carga falhou: mostra erro em vez de um dashboard "fantasma" de zeros.
  if (!m) {
    return (
      <div className="p-8">
        <ErroCarregar mensagem={erro ?? "Não foi possível carregar as métricas."} onRetry={carregar} />
      </div>
    )
  }

  const atualizado = m ? new Date(m.calculadoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck className="h-5 w-5 text-accent" />
            <p className="font-mono text-xs uppercase tracking-widest text-accent">Admin Master</p>
          </div>
          <h1 className="text-2xl font-semibold text-foreground">Visão geral da plataforma</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Atualiza automaticamente a cada 30s · última: {atualizado}
            {erro && <span className="ml-2 text-destructive">⚠ última atualização falhou</span>}
          </p>
        </div>
        <Button variant="glass" size="sm" onClick={carregar} disabled={refreshing} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {/* Zona-herói: o que exige ação do admin agora (crises, automações, agentes) */}
      <AdminAtencao />

      {/* Financeiro em destaque */}
      <section>
        <h2 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-4">Financeiro</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            title="MRR (BRL)"
            value={brl(m?.mrr ?? 0)}
            sub="Receita mensal recorrente"
            icon={DollarSign}
            iconCls="bg-accent/15 text-accent"
            coral
          />
          <KpiCard
            title="Receita este mês"
            value={brl(m?.receitaMes ?? 0)}
            sub="Pagamentos confirmados"
            icon={TrendingUp}
            iconCls="bg-primary/15 text-primary"
            glow
          />
          <KpiCard
            title="Lucro bruto mês"
            value={brl(m?.lucroBrutoMes ?? 0)}
            sub="Receita (infra não incluída)"
            icon={Activity}
            iconCls="bg-success/15 text-success"
          />
          <KpiCard
            title="Custo LLM (mês)"
            value={usd(m?.custoLlmMesUsd ?? 0)}
            sub={`Total: ${usd(m?.custoLlmTotalUsd ?? 0)}`}
            icon={Cpu}
            iconCls="bg-warning/15 text-warning"
          />
        </div>
      </section>

      {/* Plataforma */}
      <section>
        <h2 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-4">Plataforma</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            title="Médicos"
            value={String(m?.totalMedicos ?? 0)}
            sub={`${m?.medicosAtivos7d ?? 0} ativos nos últimos 7d`}
            icon={Users}
          />
          <KpiCard
            title="Pacientes"
            value={String(m?.totalPacientes ?? 0)}
            sub={`${m?.pacientesAtivos7d ?? 0} ativos nos últimos 7d`}
            icon={Users}
          />
          <KpiCard
            title="Mensagens (7d)"
            value={String(m?.mensagens7d ?? 0)}
            sub="Paciente ↔ IA"
            icon={MessageSquare}
          />
          <KpiCard
            title="Check-ins (7d)"
            value={String(m?.checkinsRespondidos7d ?? 0)}
            sub="Respondidos no intervalo"
            icon={CheckSquare}
          />
        </div>
      </section>

      {/* Assinaturas */}
      <section>
        <h2 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-4">Assinaturas</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <KpiCard
            title="Assinaturas ativas"
            value={String(m?.assinaturasAtivas ?? 0)}
            sub="Pagando mensalidade"
            icon={DollarSign}
            iconCls="bg-success/15 text-success"
          />
          <KpiCard
            title="Pendentes"
            value={String(m?.pendentes ?? 0)}
            sub="Aguardando 1º pagamento (ADR-055)"
            icon={Activity}
            iconCls="bg-warning/15 text-warning"
          />
        </div>
      </section>

      {/* Receita total (rodapé de contexto) */}
      <div className="rounded-2xl border border-noir-line bg-noir-surface-raised px-6 py-4 flex items-center justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Receita total histórica</p>
          <p className="text-2xl font-bold text-foreground mt-1">{brl(m?.receitaTotal ?? 0)}</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Custo LLM total</p>
          <p className="text-lg font-semibold text-foreground mt-1">{usd(m?.custoLlmTotalUsd ?? 0)}</p>
        </div>
      </div>
    </div>
  )
}
