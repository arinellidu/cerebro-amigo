"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2, TrendingDown, TrendingUp, Minus, CheckCircle2, Activity } from "lucide-react"

interface Ponto {
  score: number
  interpretacao: string
  respondidoEm: string
}
interface DesfechoEscala {
  codigo: string
  nome: string
  pontos: Ponto[]
  baseline: number
  atual: number
  variacaoPct: number | null
  resposta: boolean
  remissao: boolean
  tempoAteRespostaDias: number | null
}
interface Historico {
  escalas: DesfechoEscala[]
  ultimaTrocaMedicacao: string | null
}

// Pontuação máxima de cada instrumento (escala do gráfico).
const MAX: Record<string, number> = { phq9: 27, gad7: 21 }
const INTERP_LABEL: Record<string, string> = {
  minima: "mínima",
  leve: "leve",
  moderada: "moderada",
  moderadamente_grave: "mod. grave",
  grave: "grave",
}

function semanasDesde(iso: string | null): number | null {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / (7 * 24 * 3600 * 1000))
}

// Gráfico de trajetória: linha dos scores + linha de remissão (score 5).
function GraficoEscala({ pontos, max }: { pontos: Ponto[]; max: number }) {
  const w = 280
  const h = 72
  const pad = 6
  const n = pontos.length
  const x = (i: number) => (n <= 1 ? w / 2 : pad + (i / (n - 1)) * (w - pad * 2))
  const y = (s: number) => h - pad - (Math.min(s, max) / max) * (h - pad * 2)
  const linha = pontos.map((p, i) => `${x(i)},${y(p.score)}`).join(" ")
  const yRemissao = y(5)

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Trajetória da escala">
      {/* faixa de remissão (score < 5) */}
      <line
        x1={pad}
        x2={w - pad}
        y1={yRemissao}
        y2={yRemissao}
        stroke="currentColor"
        className="text-success/40"
        strokeWidth="1"
        strokeDasharray="3 3"
      />
      {n > 1 && (
        <polyline
          points={linha}
          fill="none"
          stroke="currentColor"
          className="text-primary"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      {pontos.map((p, i) => (
        <circle
          key={i}
          cx={x(i)}
          cy={y(p.score)}
          r="3"
          className={p.score < 5 ? "fill-success" : "fill-primary"}
        />
      ))}
    </svg>
  )
}

function CardEscala({ e, ultimaTroca }: { e: DesfechoEscala; ultimaTroca: string | null }) {
  const max = MAX[e.codigo] ?? 27
  const Trend = e.variacaoPct == null || e.variacaoPct === 0 ? Minus : e.variacaoPct < 0 ? TrendingDown : TrendingUp
  // Queda no score = melhora → verde. Subida → vermelho.
  const trendCor = e.variacaoPct == null || e.variacaoPct === 0
    ? "text-muted-foreground"
    : e.variacaoPct < 0
      ? "text-success"
      : "text-destructive"

  const semanasTroca = semanasDesde(ultimaTroca)
  const semRespostaPosTroca = !e.resposta && semanasTroca != null && semanasTroca >= 4

  return (
    <Card className="border-border/50">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">{e.nome}</p>
          <div className="flex items-center gap-1.5">
            {e.remissao && (
              <Badge className="border-0 bg-success/15 text-xs text-success">
                <CheckCircle2 className="mr-1 h-3 w-3" /> Remissão
              </Badge>
            )}
            {!e.remissao && e.resposta && (
              <Badge className="border-0 bg-primary/15 text-xs text-primary">Resposta</Badge>
            )}
          </div>
        </div>

        <GraficoEscala pontos={e.pontos} max={max} />

        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Inicial</p>
            <p className="text-lg font-bold text-foreground">{e.baseline}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Atual</p>
            <p className="text-lg font-bold text-foreground">
              {e.atual}
              <span className="text-xs font-normal text-muted-foreground">/{max}</span>
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Variação</p>
            <p className={`flex items-center justify-center gap-0.5 text-lg font-bold ${trendCor}`}>
              <Trend className="h-4 w-4" />
              {e.variacaoPct == null ? "—" : `${e.variacaoPct > 0 ? "+" : ""}${e.variacaoPct}%`}
            </p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Atual: severidade {INTERP_LABEL[e.pontos.at(-1)?.interpretacao ?? ""] ?? "—"}
          {e.tempoAteRespostaDias != null && ` · resposta em ${e.tempoAteRespostaDias} dias`}
          {` · ${e.pontos.length} registro${e.pontos.length !== 1 ? "s" : ""}`}
        </p>

        {semRespostaPosTroca && (
          <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
            Sem resposta (queda &lt; 50%) há {semanasTroca} semanas desde a última mudança de
            medicação. Dado para sua avaliação — a interpretação clínica é sua.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Evolução longitudinal das escalas (PHQ-9/GAD-7) — Measurement-Based Care.
 * Mostra trajetória, resposta (queda ≥50%) e remissão (&lt;5) de forma FACTUAL.
 * A IA não interpreta; o médico decide (regra #1). O alerta de não-resposta é
 * apenas a exibição de um fato agregado (sem recomendação de conduta).
 */
export function EvolucaoEscalasPanel({ pacienteId }: { pacienteId: string }) {
  const [dados, setDados] = useState<Historico | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let vivo = true
    setLoading(true)
    fetch(`/api/pacientes/${pacienteId}/escalas/historico`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: Historico) => vivo && setDados(d))
      .catch(() => vivo && setDados(null))
      .finally(() => vivo && setLoading(false))
    return () => {
      vivo = false
    }
  }, [pacienteId])

  if (loading)
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )

  if (!dados || dados.escalas.length === 0)
    return (
      <Card className="border-border/50">
        <CardContent className="p-6 py-8 text-center">
          <Activity className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Nenhuma escala respondida ainda. As respostas de PHQ-9/GAD-7 do paciente aparecem aqui.
          </p>
        </CardContent>
      </Card>
    )

  return (
    <div className="space-y-3">
      {dados.escalas.map((e) => (
        <CardEscala key={e.codigo} e={e} ultimaTroca={dados.ultimaTrocaMedicacao} />
      ))}
      <p className="px-1 text-[11px] text-muted-foreground">
        Resposta = queda ≥ 50% do score inicial · Remissão = score &lt; 5. Agregação factual; a
        decisão clínica é do médico.
      </p>
    </div>
  )
}
