"use client"

import { useEffect, useState } from "react"
import { Header } from "@/components/header"
import { Card, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Smile, Meh, Frown, TrendingUp, TrendingDown, Minus, Loader2 } from "lucide-react"
import { tempoRelativo } from "@/lib/tempo"
import { Sparkline } from "@/components/dashboard/sparkline"

interface CheckinHumor {
  id: string
  pacienteId: string
  pacienteNome: string | null
  humor: number
  nota: string | null
  registradoEm: string
}

interface PacienteHumor {
  pacienteId: string
  nome: string
  ultimoHumor: number
  nota: string | null
  quando: string
  serie: number[] // cronológico (antigo → recente), até 7
  delta: number | null
}

const moodClasses: Record<string, { text: string; bg: string; icon: typeof Smile }> = {
  "Muito bem": { text: "text-success", bg: "bg-success", icon: Smile },
  Bem: { text: "text-primary", bg: "bg-primary", icon: Smile },
  Neutro: { text: "text-warning", bg: "bg-warning", icon: Meh },
  Mal: { text: "text-coral", bg: "bg-coral", icon: Frown },
}

function band(h: number): keyof typeof moodClasses {
  if (h >= 8) return "Muito bem"
  if (h >= 6) return "Bem"
  if (h >= 4) return "Neutro"
  return "Mal"
}

function trendIcon(delta: number | null) {
  if (delta === null) return <Minus className="h-4 w-4 text-warning" />
  if (delta > 0) return <TrendingUp className="h-4 w-4 text-success" />
  if (delta < 0) return <TrendingDown className="h-4 w-4 text-coral" />
  return <Minus className="h-4 w-4 text-warning" />
}

// Agrupa os auto-relatos por paciente: 1 card por paciente (mais recente no topo).
function agrupar(lista: CheckinHumor[]): PacienteHumor[] {
  const mapa = new Map<string, CheckinHumor[]>()
  for (const c of lista) {
    const arr = mapa.get(c.pacienteId) ?? []
    arr.push(c) // lista vem do gateway em ordem decrescente
    mapa.set(c.pacienteId, arr)
  }
  const out: PacienteHumor[] = []
  for (const [pacienteId, entradas] of mapa) {
    const ultimo = entradas[0]
    const anterior = entradas[1]
    const serie = entradas.slice(0, 7).map((e) => e.humor).reverse()
    out.push({
      pacienteId,
      nome: ultimo.pacienteNome ?? "Paciente",
      ultimoHumor: ultimo.humor,
      nota: ultimo.nota,
      quando: ultimo.registradoEm,
      serie,
      delta: anterior ? ultimo.humor - anterior.humor : null,
    })
  }
  return out
}

export default function CheckinsPage() {
  const [pacientes, setPacientes] = useState<PacienteHumor[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/checkins")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: CheckinHumor[]) => setPacientes(agrupar(Array.isArray(rows) ? rows : [])))
      .catch(() => setPacientes([]))
      .finally(() => setLoading(false))
  }, [])

  // Resumo: nº de pacientes por faixa de humor do último registro.
  const resumo = (["Muito bem", "Bem", "Neutro", "Mal"] as const).map((label) => ({
    label,
    count: pacientes.filter((p) => band(p.ultimoHumor) === label).length,
  }))

  return (
    <div className="min-h-screen">
      <Header
        title="Check-ins de Humor"
        subtitle="Humor reportado pelos pacientes — fatos, sem interpretação automática"
      />

      <div className="p-6 space-y-6">
        {/* Resumo por faixa */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {resumo.map((m) => {
            const cfg = moodClasses[m.label]
            const Icon = cfg.icon
            return (
              <Card key={m.label} className="border-border/50">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">{m.label}</p>
                      <p className={`text-2xl font-bold ${cfg.text}`}>
                        {loading ? "…" : m.count}
                      </p>
                    </div>
                    <div className={`h-12 w-12 rounded-xl flex items-center justify-center ${cfg.bg}/10`}>
                      <Icon className={`h-6 w-6 ${cfg.text}`} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>

        <h2 className="text-lg font-semibold text-foreground">Por paciente</h2>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : pacientes.length === 0 ? (
          <Card className="border-border/50">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Nenhum registro de humor ainda.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {pacientes.map((p) => {
              const label = band(p.ultimoHumor)
              const cfg = moodClasses[label]
              const Icon = cfg.icon
              return (
                <Card key={p.pacienteId} className="border-border/50 hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      <Avatar className="h-12 w-12 border-2 border-primary/20">
                        <AvatarFallback className="bg-secondary text-primary font-medium">
                          {p.nome.split(" ").filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join("")}
                        </AvatarFallback>
                      </Avatar>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-medium text-foreground">{p.nome}</h3>
                          {trendIcon(p.delta)}
                        </div>
                        <div className="flex items-center gap-2 mb-2">
                          <div className={`h-8 w-8 rounded-full flex items-center justify-center ${cfg.bg}/10`}>
                            <Icon className={`h-4 w-4 ${cfg.text}`} />
                          </div>
                          <Badge className={`${cfg.bg}/10 ${cfg.text} border-0`}>
                            {label} ({p.ultimoHumor}/10)
                          </Badge>
                          <span className="text-xs text-muted-foreground">{tempoRelativo(p.quando)}</span>
                        </div>
                        {p.nota && (
                          <p className="text-sm text-muted-foreground italic mb-3">&quot;{p.nota}&quot;</p>
                        )}

                        {p.serie.length > 0 && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">Tendência:</span>
                            <span className={cfg.text}>
                              <Sparkline values={p.serie} width={104} height={26} />
                            </span>
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {p.serie.length} registro{p.serie.length === 1 ? "" : "s"}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
