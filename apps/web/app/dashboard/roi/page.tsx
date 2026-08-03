"use client"

// Meu ROI (item 3 do top-3 de demo). Superfície que vende o retorno do Cérebro Amigo:
// receita potencial via recall de inativos, movimento de consultas, agenda futura, e a
// blindagem médico-legal. Tudo agregação read-only (sem dado clínico). O R$ é estimado
// no cliente a partir do valor de consulta informado pelo médico — rótulo sempre "estimado".

import { useEffect, useState, type ElementType } from "react"
import { Header } from "@/components/header"
import { Card, CardContent } from "@/components/ui/card"
import {
  Loader2, TrendingUp, Users, CalendarCheck, ShieldCheck, HeartPulse,
  RefreshCw, Lock, FileClock, Activity, Sparkles, AlertTriangle,
} from "lucide-react"

interface Roi {
  pacientesAtivos: number
  pacientesInativos: number
  consultasRealizadas30d: number
  consultasRealizadasTotal: number
  consultasAgendadas: number
  crisesTotal: number
  crises30d: number
}
interface Blindagem {
  crisesTotal: number
  crises30d: number
  examesTotal: number
  examesAtrasados: number
  renovacoesPendentes: number
  interacoesBase: number
  eventosAuditados: number
}

const brl0 = (n: number) => `R$ ${Math.round(n ?? 0).toLocaleString("pt-BR")}`

export default function RoiPage() {
  const [roi, setRoi] = useState<Roi | null>(null)
  const [bl, setBl] = useState<Blindagem | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [valor, setValor] = useState(300)

  useEffect(() => {
    Promise.all([
      fetch("/api/roi/resumo").then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
      fetch("/api/blindagem/resumo").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
      .then(([r, b]) => { setRoi(r); setBl(b) })
      .catch(() => setErro("Não foi possível carregar seu ROI."))
      .finally(() => setLoading(false))
  }, [])

  const recallPotencial = (roi?.pacientesInativos ?? 0) * valor
  const movimentado30d = (roi?.consultasRealizadas30d ?? 0) * valor
  const agendaFutura = (roi?.consultasAgendadas ?? 0) * valor

  return (
    <div className="p-8 space-y-8">
      <Header title="Meu ROI" subtitle="O retorno que o Cérebro Amigo gera no seu consultório" />

      {loading ? (
        <div className="flex justify-center py-20 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : erro || !roi ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">{erro ?? "Sem dados."}</CardContent></Card>
      ) : (
        <>
          {/* ── Estimador de receita ─────────────────────────────────── */}
          <Card className="overflow-hidden border-border/80">
            <CardContent className="p-6 space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold text-foreground">Potencial de receita</h2>
                </div>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  Valor médio da consulta
                  <span className="flex items-center rounded-lg border border-border bg-background pl-2.5 focus-within:ring-2 focus-within:ring-primary/30">
                    <span className="text-muted-foreground text-sm">R$</span>
                    <input
                      type="number" min={0} step={10} value={valor}
                      onChange={(e) => setValor(Math.max(0, Number(e.target.value) || 0))}
                      className="w-24 bg-transparent px-2 py-1.5 text-right text-sm font-semibold text-foreground outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </span>
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <Estimativa
                  destaque icon={RefreshCw} cor="coral"
                  valor={brl0(recallPotencial)} titulo="Recall de inativos / mês"
                  sub={`${roi.pacientesInativos} pacientes sem consulta há 90+ dias`}
                />
                <Estimativa
                  icon={TrendingUp} cor="primary"
                  valor={brl0(movimentado30d)} titulo="Movimentado (30 dias)"
                  sub={`${roi.consultasRealizadas30d} consultas realizadas`}
                />
                <Estimativa
                  icon={CalendarCheck} cor="success"
                  valor={brl0(agendaFutura)} titulo="Em agenda confirmada"
                  sub={`${roi.consultasAgendadas} consultas futuras`}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Estimativa: contagens reais do seu consultório × valor informado. O recall reativa pacientes
                automaticamente — receita que hoje fica na mesa.
              </p>
            </CardContent>
          </Card>

          {/* ── O que a plataforma fez por você ──────────────────────── */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-foreground">O que a plataforma fez por você</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Metrica icon={Users} cor="primary" valor={roi.pacientesAtivos} label="Pacientes em acompanhamento" />
              <Metrica icon={Activity} cor="primary" valor={roi.consultasRealizadasTotal} label="Consultas realizadas (total)" />
              <Metrica icon={HeartPulse} cor="coral" valor={roi.crisesTotal} label="Crises detectadas e tratadas" sub={`${roi.crises30d} em 30d`} />
              <Metrica icon={RefreshCw} cor="warning" valor={roi.pacientesInativos} label="Aguardando reativação" />
            </div>
          </section>

          {/* ── Blindagem médico-legal ───────────────────────────────── */}
          <Card className="border-border/80">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">Blindagem médico-legal</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                Conduta documentada, rastreável e <span className="text-foreground font-medium">imutável</span> — sua defesa em auditoria, CFM e processo.
              </p>
              {!bl ? (
                <p className="text-xs text-muted-foreground">Métricas de blindagem indisponíveis.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Linha icon={FileClock} label="Eventos auditados (imutável)" valor={bl.eventosAuditados} />
                  <Linha icon={HeartPulse} label="Protocolos de crise registrados" valor={bl.crisesTotal} sub={`${bl.crises30d} em 30d`} />
                  <Linha icon={Activity} label="Exames de monitoramento" valor={bl.examesTotal} sub={bl.examesAtrasados > 0 ? `${bl.examesAtrasados} atrasados` : "em dia"} alerta={bl.examesAtrasados > 0} />
                  <Linha icon={RefreshCw} label="Renovações controladas" valor={bl.renovacoesPendentes} sub="pendentes" />
                  <Linha icon={Lock} label="Interações na base de segurança" valor={bl.interacoesBase} />
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

const COR: Record<string, string> = {
  primary: "text-primary",
  coral: "text-coral",
  success: "text-success",
  warning: "text-warning",
}

function Estimativa({ icon: Icon, cor, valor, titulo, sub, destaque }: {
  icon: ElementType; cor: string; valor: string; titulo: string; sub: string; destaque?: boolean
}) {
  return (
    <div className={`rounded-xl border p-4 ${destaque ? "border-coral/40 bg-coral/5" : "border-border/70 bg-secondary/20"}`}>
      <Icon className={`h-4 w-4 ${COR[cor]}`} />
      <p className="mt-3 text-2xl font-bold tracking-tight text-foreground">{valor}</p>
      <p className="mt-1 text-sm font-medium text-foreground">{titulo}</p>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </div>
  )
}

function Metrica({ icon: Icon, cor, valor, label, sub }: {
  icon: ElementType; cor: string; valor: number; label: string; sub?: string
}) {
  return (
    <Card className="border-border/70">
      <CardContent className="p-4">
        <Icon className={`h-4 w-4 ${COR[cor]}`} />
        <p className="mt-3 text-2xl font-bold tracking-tight text-foreground">{valor}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
        {sub && <p className="text-[11px] text-muted-foreground/70">{sub}</p>}
      </CardContent>
    </Card>
  )
}

function Linha({ icon: Icon, label, valor, sub, alerta }: {
  icon: ElementType; label: string; valor: number; sub?: string; alerta?: boolean
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-secondary/20 px-3 py-2.5">
      <Icon className="h-4 w-4 flex-shrink-0 text-muted-foreground/60" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-muted-foreground">{label}</p>
        <p className="flex items-baseline gap-1.5">
          <span className="text-base font-semibold text-foreground">{valor}</span>
          {sub && <span className={`text-[11px] ${alerta ? "text-coral" : "text-muted-foreground/70"}`}>{sub}</span>}
        </p>
      </div>
    </div>
  )
}
