"use client"

import { useEffect, useState } from "react"
import dynamic from "next/dynamic"
import { Header } from "@/components/header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Users,
  Calendar,
  Activity,
  Heart,
  Loader2,
} from "lucide-react"
import { Sparkline } from "@/components/dashboard/sparkline"

const GrowthChart = dynamic(
  () => import("@/components/dashboard/growth-chart").then((m) => m.GrowthChart),
  { loading: () => <ChartSkeleton /> },
)

const MoodChart = dynamic(
  () => import("@/components/dashboard/mood-chart").then((m) => m.MoodChart),
  { loading: () => <ChartSkeleton /> },
)

function ChartSkeleton() {
  return <div className="h-[250px] animate-pulse bg-muted rounded-xl" />
}

interface Resumo {
  stats: {
    taxaAdesao: number | null
    humorMedio: number | null
    pacientesAtivos: number
    consultasMes: number
  } | null
  mensal: { month: string; pacientes: number; consultas: number }[]
  humorSemana: { dia: string; muitoBem: number; bem: number; neutro: number; mal: number }[]
  progresso: {
    pacienteId: string
    nome: string
    humorAtual: number | null
    deltaHumor: number | null
    adesao: number | null
  }[]
}

function initials(nome: string) {
  return nome.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("")
}

function fmt(n: number | null | undefined, suffix = "") {
  return n === null || n === undefined ? "—" : `${n}${suffix}`
}

export default function EvolucaoPage() {
  const [data, setData] = useState<Resumo | null>(null)
  const [loading, setLoading] = useState(true)
  // Série de humor por paciente (mesma fonte real dos check-ins) p/ a sparkline.
  const [serieMap, setSerieMap] = useState<Map<string, number[]>>(new Map())

  useEffect(() => {
    fetch("/api/evolucao")
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))

    fetch("/api/checkins")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: { pacienteId: string; humor: number }[]) => {
        const m = new Map<string, number[]>()
        for (const c of Array.isArray(rows) ? rows : []) {
          const arr = m.get(c.pacienteId) ?? []
          arr.push(c.humor) // gateway devolve em ordem decrescente
          m.set(c.pacienteId, arr)
        }
        // cronológico (antigo → recente), no máx. 12 pontos
        for (const [k, v] of m) m.set(k, v.slice(0, 12).reverse())
        setSerieMap(m)
      })
      .catch(() => setSerieMap(new Map()))
  }, [])

  const s = data?.stats
  const statCards = [
    { title: "Taxa de adesão", value: fmt(s?.taxaAdesao, "%"), icon: Activity },
    { title: "Média de humor (0–10)", value: fmt(s?.humorMedio), icon: Heart },
    { title: "Pacientes ativos (30d)", value: fmt(s?.pacientesAtivos), icon: Users },
    { title: "Consultas no mês", value: fmt(s?.consultasMes), icon: Calendar },
  ]

  const moodData = (data?.humorSemana ?? []).map((h) => ({
    day: h.dia,
    muitoBem: h.muitoBem,
    bem: h.bem,
    neutro: h.neutro,
    mal: h.mal,
  }))

  return (
    <div className="min-h-screen">
      <Header title="Evolução" subtitle="Sinais reportados pelos seus pacientes" />

      <div className="p-6 space-y-6">
        {/* Stats Cards (fatos agregados) */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {statCards.map((stat) => (
            <Card key={stat.title} className="border-border/50">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="h-10 w-10 rounded-lg bg-secondary flex items-center justify-center">
                    <stat.icon className="h-5 w-5 text-primary" />
                  </div>
                </div>
                <p className="text-2xl font-bold text-foreground">
                  {loading ? "…" : stat.value}
                </p>
                <p className="text-xs text-muted-foreground">{stat.title}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Crescimento mensal */}
          <Card className="border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-foreground">
                Atividade mensal
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[250px] w-full">
                <GrowthChart data={data?.mensal ?? []} />
              </div>
              <div className="flex items-center justify-center gap-6 mt-2">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-primary" />
                  <span className="text-xs text-muted-foreground">Pacientes novos</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-primary" />
                  <span className="text-xs text-muted-foreground">Consultas</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Distribuição de humor */}
          <Card className="border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-foreground">
                Humor reportado (últimos 7 dias)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[250px] w-full">
                <MoodChart data={moodData} />
              </div>
              <div className="flex items-center justify-center gap-4 mt-2 flex-wrap">
                <Legenda cor="bg-success" texto="Muito bem" />
                <Legenda cor="bg-primary" texto="Bem" />
                <Legenda cor="bg-warning" texto="Neutro" />
                <Legenda cor="bg-coral" texto="Mal" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Progresso factual por paciente (sem interpretação clínica) */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-foreground">
              Humor e adesão por paciente
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : (data?.progresso?.length ?? 0) === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Sem registros de humor no período.
              </p>
            ) : (
              <div className="space-y-4">
                {data!.progresso.map((p) => {
                  const sobe = (p.deltaHumor ?? 0) > 0
                  const desce = (p.deltaHumor ?? 0) < 0
                  return (
                    <div
                      key={p.pacienteId}
                      className="flex items-center gap-4 p-4 rounded-lg bg-muted/30"
                    >
                      <Avatar className="h-11 w-11 border-2 border-primary/20">
                        <AvatarFallback className="bg-secondary text-primary font-medium">
                          {initials(p.nome)}
                        </AvatarFallback>
                      </Avatar>

                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-foreground">{p.nome}</h4>
                        <p className="text-sm text-muted-foreground">
                          Humor médio (15d): {fmt(p.humorAtual)} · Adesão: {fmt(p.adesao, "%")}
                        </p>
                      </div>

                      {(() => {
                        const serie = serieMap.get(p.pacienteId) ?? []
                        if (serie.length < 2) return null
                        return (
                          <span
                            className="hidden text-primary sm:block"
                            title="Humor reportado (últimos registros)"
                          >
                            <Sparkline values={serie} width={88} height={28} />
                          </span>
                        )
                      })()}

                      <div
                        className={`flex items-center gap-1 px-3 py-1.5 rounded-full ${
                          sobe
                            ? "bg-success/10 text-success"
                            : desce
                              ? "bg-coral/10 text-coral"
                              : "bg-muted text-muted-foreground"
                        }`}
                        title="Variação do humor médio reportado vs. quinzena anterior"
                      >
                        {sobe ? (
                          <TrendingUp className="h-4 w-4" />
                        ) : desce ? (
                          <TrendingDown className="h-4 w-4" />
                        ) : (
                          <Minus className="h-4 w-4" />
                        )}
                        <span className="text-sm font-semibold">
                          {p.deltaHumor === null || p.deltaHumor === undefined
                            ? "—"
                            : `${p.deltaHumor > 0 ? "+" : ""}${p.deltaHumor}`}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Legenda({ cor, texto }: { cor: string; texto: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-3 w-3 rounded-sm ${cor}`} />
      <span className="text-xs text-muted-foreground">{texto}</span>
    </div>
  )
}
