"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ShieldAlert,
  MessageSquare,
  AlertCircle,
  BellOff,
  Pill,
  Loader2,
  ChevronRight,
  CheckCircle2,
  Activity,
  Heart,
  TrendingDown,
  Minus,
  Inbox,
} from "lucide-react"
import { tempoRelativo } from "@/lib/tempo"

interface FilaItem {
  tipo: string
  pacienteId: string
  pacienteNome: string | null
  severidade: string
  titulo: string
  quando: string
}

interface FilaDeltaSinal {
  tipo: string
  titulo: string
  quando: string
}

interface FilaDeltaPaciente {
  pacienteId: string
  pacienteNome: string | null
  scorePiora: number
  severidade: string
  sinais: FilaDeltaSinal[]
}

interface FilaResponse {
  itens: FilaItem[]
  deltas: FilaDeltaPaciente[]
}

const TIPO_CFG: Record<
  string,
  { icon: typeof ShieldAlert; rota: string; label: string; secao?: string }
> = {
  crise: { icon: ShieldAlert, rota: "/dashboard/prontuarios", label: "Crise", secao: "timeline" },
  escalacao: { icon: MessageSquare, rota: "/dashboard/mensagens", label: "Escalação" },
  insight: { icon: AlertCircle, rota: "/dashboard/prontuarios", label: "Alerta", secao: "timeline" },
  checkin_perdido: { icon: BellOff, rota: "/dashboard/checkins", label: "Check-in" },
  nao_adesao: { icon: Pill, rota: "/dashboard/prontuarios", label: "Adesão", secao: "prescricoes" },
}

const DELTA_CFG: Record<string, { icon: typeof Activity; label: string }> = {
  escala: { icon: Activity, label: "Escala" },
  humor: { icon: Heart, label: "Humor" },
  adesao: { icon: Pill, label: "Adesão" },
  humor_baixo: { icon: TrendingDown, label: "Humor" },
}

const SEV_CFG: Record<string, { dot: string; chip: string }> = {
  critico: { dot: "bg-coral", chip: "text-coral bg-coral/10" },
  urgente: { dot: "bg-coral", chip: "text-coral bg-coral/10" },
  atencao: { dot: "bg-warning", chip: "text-warning bg-warning/10" },
  info: { dot: "bg-primary", chip: "text-primary bg-primary/10" },
}

function hrefItem(it: FilaItem, cfg: (typeof TIPO_CFG)[string]) {
  return cfg.rota === "/dashboard/prontuarios"
    ? `/dashboard/prontuarios/${it.pacienteId}/${cfg.secao ?? "timeline"}`
    : `${cfg.rota}?paciente=${it.pacienteId}`
}

function ItemRow({ it, idx }: { it: FilaItem; idx: number }) {
  const cfg = TIPO_CFG[it.tipo] ?? TIPO_CFG.insight
  const sev = SEV_CFG[it.severidade] ?? SEV_CFG.info
  const Icon = cfg.icon

  return (
    <Link
      key={`${it.tipo}-${it.pacienteId}-${idx}`}
      href={hrefItem(it, cfg)}
      className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-secondary"
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${sev.dot}`} />
      <Icon size={17} className="shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{it.titulo}</p>
        <p className="text-xs text-muted-foreground">
          {it.pacienteNome ?? "Paciente"} · {tempoRelativo(it.quando)}
        </p>
      </div>
      <span
        className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium sm:inline ${sev.chip}`}
      >
        {cfg.label}
      </span>
      <ChevronRight size={16} className="shrink-0 text-muted-foreground" />
    </Link>
  )
}

function DeltaCard({ delta }: { delta: FilaDeltaPaciente }) {
  const sev = SEV_CFG[delta.severidade] ?? SEV_CFG.atencao
  const ultimoSinal = delta.sinais.reduce(
    (max, s) => (new Date(s.quando) > new Date(max) ? s.quando : max),
    delta.sinais[0]?.quando ?? new Date().toISOString(),
  )

  return (
    <Link
      href={`/dashboard/prontuarios/${delta.pacienteId}/timeline`}
      className="block rounded-xl border border-border/60 px-3 py-3 transition-colors hover:bg-secondary/60"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">
            {delta.pacienteNome ?? "Paciente"}
          </p>
          <p className="text-xs text-muted-foreground">
            {delta.sinais.length} {delta.sinais.length === 1 ? "sinal" : "sinais"} de mudança ·{" "}
            {tempoRelativo(ultimoSinal)}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ${sev.chip}`}>
          {delta.sinais.length >= 2 ? "Composto" : "Mudança"}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {delta.sinais.map((s, i) => {
          const cfg = DELTA_CFG[s.tipo] ?? { icon: Minus, label: "Sinal" }
          const Icon = cfg.icon
          return (
            <span
              key={`${s.tipo}-${i}`}
              className="inline-flex max-w-full items-center gap-1 rounded-lg bg-muted/50 px-2 py-1 text-[0.6875rem] text-muted-foreground"
              title={s.titulo}
            >
              <Icon size={12} className="shrink-0" />
              <span className="truncate">{s.titulo}</span>
            </span>
          )
        })}
      </div>
    </Link>
  )
}

export function FilaAtencao() {
  const [itens, setItens] = useState<FilaItem[]>([])
  const [deltas, setDeltas] = useState<FilaDeltaPaciente[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/fila")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: FilaResponse | FilaItem[] | null) => {
        if (!data) {
          setItens([])
          setDeltas([])
          return
        }
        // Compat: resposta antiga era array plano
        if (Array.isArray(data)) {
          setItens(data)
          setDeltas([])
          return
        }
        setItens(Array.isArray(data.itens) ? data.itens : [])
        setDeltas(Array.isArray(data.deltas) ? data.deltas : [])
      })
      .catch(() => {
        setItens([])
        setDeltas([])
      })
      .finally(() => setLoading(false))
  }, [])

  const totalPendencias = itens.length + deltas.length
  const vazio = !loading && itens.length === 0 && deltas.length === 0
  const temCritico = itens.some(
    (i) => i.severidade === "critico" || i.severidade === "urgente",
  )

  return (
    <Card
      className={`relative overflow-hidden border-primary/15 bg-gradient-to-b from-card to-card/40 ${
        !loading && temCritico ? "glow-coral-lg" : "glow-purple-lg"
      }`}
    >
      {/* faixa de acento superior — coral quando há item crítico */}
      <span
        aria-hidden
        className={`absolute inset-x-0 top-0 h-px ${
          !loading && temCritico
            ? "bg-gradient-to-r from-transparent via-coral/60 to-transparent"
            : "bg-gradient-to-r from-transparent via-primary/50 to-transparent"
        }`}
      />
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3 pt-5 px-5">
        <div className="flex items-start gap-3">
          <span
            className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
              !loading && temCritico ? "bg-coral/12 text-coral" : "bg-primary/12 text-primary"
            }`}
          >
            <Inbox size={18} />
          </span>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Prioridade agora
            </p>
            <CardTitle className="mt-0.5 text-lg font-semibold tracking-tight text-foreground">
              Fila de atenção
            </CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Ação imediata e mudanças recentes nos sinais reportados
            </p>
          </div>
        </div>
        {!loading && totalPendencias > 0 && (
          <span
            className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums ${
              temCritico ? "bg-coral/12 text-coral" : "bg-primary/12 text-primary"
            }`}
          >
            {totalPendencias}
          </span>
        )}
      </CardHeader>

      <CardContent className="space-y-4 px-3 pb-4 pt-1">
        {loading ? (
          <div className="flex justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : vazio ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <CheckCircle2 className="h-8 w-8 text-success" />
            <p className="text-sm text-muted-foreground">Nada pendente — tudo em dia.</p>
          </div>
        ) : (
          <>
            {itens.length > 0 && (
              <section>
                <p className="mb-1.5 px-3 text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
                  Ação imediata
                </p>
                <div className="space-y-1">
                  {itens.map((it, i) => (
                    <ItemRow key={`${it.tipo}-${it.pacienteId}-${i}`} it={it} idx={i} />
                  ))}
                </div>
              </section>
            )}

            {deltas.length > 0 && (
              <section>
                <p className="mb-1.5 px-3 text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
                  Mudanças recentes
                </p>
                <div className="space-y-2">
                  {deltas.map((d) => (
                    <DeltaCard key={d.pacienteId} delta={d} />
                  ))}
                </div>
                <p className="px-3 pt-1 text-[0.625rem] text-muted-foreground">
                  Agregação factual de escalas, humor e adesão reportados — sem interpretação clínica.
                </p>
              </section>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
