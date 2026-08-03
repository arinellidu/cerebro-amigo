"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import { Smile, Meh, Frown, Loader2 } from "lucide-react"
import { tempoRelativo } from "@/lib/tempo"

// Auto-relato de humor dos pacientes do médico (fatos, sem interpretação).
// Fonte real: GET /api/checkins → /api/v1/evolucao/checkins (tenant via JWT).
interface CheckinHumor {
  id: string
  pacienteId: string
  pacienteNome: string | null
  humor: number
  nota: string | null
  registradoEm: string
}

const FAIXAS = [
  { label: "Muito bem", min: 8, color: "text-success", bar: "bg-success", bg: "bg-success/10", icon: Smile },
  { label: "Bem", min: 6, color: "text-primary", bar: "bg-primary", bg: "bg-primary/10", icon: Smile },
  { label: "Neutro", min: 4, color: "text-warning", bar: "bg-warning", bg: "bg-warning/10", icon: Meh },
  { label: "Mal", min: 0, color: "text-coral", bar: "bg-coral", bg: "bg-coral/10", icon: Frown },
] as const

function faixaDe(h: number) {
  return FAIXAS.find((f) => h >= f.min) ?? FAIXAS[FAIXAS.length - 1]
}

export function CheckinWidget() {
  const [rows, setRows] = useState<CheckinHumor[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/checkins")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: CheckinHumor[]) => setRows(Array.isArray(data) ? data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [])

  // Último humor por paciente (a lista vem em ordem decrescente do gateway).
  const ultimoPorPaciente = new Map<string, CheckinHumor>()
  for (const c of rows) {
    if (!ultimoPorPaciente.has(c.pacienteId)) ultimoPorPaciente.set(c.pacienteId, c)
  }
  const ultimos = [...ultimoPorPaciente.values()]
  const totalPacientes = ultimos.length

  const distribuicao = FAIXAS.map((f) => ({
    ...f,
    count: ultimos.filter((c) => faixaDe(c.humor).label === f.label).length,
  }))

  const recentes = rows.slice(0, 3)

  return (
    <Card className="border-border/80 hover:border-primary/25 hover:shadow-[0_4px_24px_rgba(94,75,139,0.07)] transition-all duration-200">
      <CardHeader className="pb-1 pt-5 px-5">
        <CardTitle className="text-[0.9375rem] font-semibold text-foreground">Check-in de humor</CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">
          {loading ? "Carregando…" : `${totalPacientes} paciente${totalPacientes === 1 ? "" : "s"} com registro`}
        </p>
      </CardHeader>
      <CardContent className="px-5 pt-1 pb-4">
        {loading ? (
          <div className="flex justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : totalPacientes === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">
            Nenhum registro de humor ainda.
          </p>
        ) : (
          <>
            {/* Distribuição por faixa (último humor de cada paciente) */}
            <div className="space-y-2.5 mb-4">
              {distribuicao.map((f) => (
                <div key={f.label} className="flex items-center gap-3">
                  <div className={`h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0 ${f.bg}`}>
                    <f.icon size={14} className={f.color} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between mb-1">
                      <span className="text-xs text-muted-foreground">{f.label}</span>
                      <span className={`text-xs font-semibold tabular-nums ${f.color}`}>{f.count}</span>
                    </div>
                    <Progress
                      value={totalPacientes > 0 ? (f.count / totalPacientes) * 100 : 0}
                      className="h-[5px] [&>div]:rounded-full"
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Registros recentes */}
            <div className="pt-3 border-t border-border/50">
              <p className="text-xs font-semibold text-foreground mb-2">Recentes</p>
              <div className="space-y-1.5">
                {recentes.map((c) => {
                  const f = faixaDe(c.humor)
                  return (
                    <Link
                      key={c.id}
                      href={`/dashboard/prontuarios/${c.pacienteId}/timeline`}
                      className="flex items-center gap-3 p-2 rounded-xl hover:bg-muted/40 transition-colors"
                    >
                      <div className={`h-7 w-7 rounded-full flex items-center justify-center flex-shrink-0 ${f.bg}`}>
                        <f.icon size={13} className={f.color} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{c.pacienteNome ?? "Paciente"}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {f.label} · {c.humor}/10
                        </p>
                      </div>
                      <span className="text-[11px] text-muted-foreground flex-shrink-0">
                        {tempoRelativo(c.registradoEm)}
                      </span>
                    </Link>
                  )
                })}
              </div>
            </div>

            <Button
              variant="ghost"
              asChild
              className="mt-1 h-8 w-full text-xs text-primary hover:bg-secondary hover:text-purple-dark"
            >
              <Link href="/dashboard/checkins">Ver todos os check-ins</Link>
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
