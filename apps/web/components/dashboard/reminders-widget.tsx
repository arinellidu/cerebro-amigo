"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CheckCircle2, Clock, AlertCircle, Loader2, Check, X } from "lucide-react"
import { tempoRelativo } from "@/lib/tempo"
import { readFeatureGate } from "@/lib/feature-gate"
import { UpsellFeature } from "@/components/assinatura/upsell-feature"

interface Insight {
  id: string
  pacienteId: string
  nomePaciente: string | null
  agente: string
  titulo: string
  severidade: string
  criadoEm: string
}

const sevConfig: Record<string, { icon: typeof Clock; color: string; bg: string }> = {
  critico: { icon: AlertCircle, color: "text-coral", bg: "bg-coral/7" },
  urgente: { icon: AlertCircle, color: "text-coral", bg: "bg-coral/7" },
  atencao: { icon: Clock, color: "text-warning", bg: "bg-warning/7" },
  info: { icon: CheckCircle2, color: "text-primary", bg: "bg-primary/7" },
}

const delayClass = ["delay-100", "delay-200", "delay-300", "delay-400"]

export function RemindersWidget() {
  const [insights, setInsights] = useState<Insight[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  // Feature gate (ADR-059): insights = Pro+. 402 `feature_requer_pro` → mostra upsell.
  const [bloqueado, setBloqueado] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    fetch("/api/insights")
      .then(async (r) => {
        const gate = await readFeatureGate(r)
        if (!vivo) return
        if (gate) { setBloqueado(gate.feature); return }
        const rows = r.ok ? await r.json() : []
        setInsights(Array.isArray(rows) ? rows : [])
      })
      .catch(() => { if (vivo) setInsights([]) })
      .finally(() => { if (vivo) setLoading(false) })
    return () => { vivo = false }
  }, [])

  // Marca visto / descarta. Otimista: remove da lista; se falhar, mantém.
  async function agir(id: string, acao: "visualizar" | "descartar") {
    setBusy(id)
    const anterior = insights
    setInsights((prev) => prev.filter((x) => x.id !== id))
    try {
      const r = await fetch(`/api/insights/${id}/${acao}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      if (!r.ok) setInsights(anterior)
    } catch {
      setInsights(anterior)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className="border-border/80 hover:border-primary/25 hover:shadow-[0_4px_24px_rgba(94,75,139,0.07)] transition-all duration-200">
      <CardHeader className="pb-1 pt-5 px-5">
        <CardTitle className="text-[0.9375rem] font-semibold text-foreground">Alertas dos agentes</CardTitle>
      </CardHeader>
      <CardContent className="px-3 pt-1 pb-3">
        {loading ? (
          <div className="flex justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : bloqueado ? (
          <div className="px-2 py-2">
            <UpsellFeature feature={bloqueado} variant="inline" />
          </div>
        ) : insights.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-muted-foreground">
            Nenhum alerta no momento.
          </p>
        ) : (
          <div className="space-y-1">
            {insights.slice(0, 4).map((r, i) => {
              const cfg = sevConfig[r.severidade] ?? sevConfig.info
              const Icon = cfg.icon
              return (
                <div
                  key={r.id}
                  className={`flex items-start gap-3 px-3 py-2.5 rounded-xl ${cfg.bg} animate-fade-left ${delayClass[i]}`}
                >
                  <div className="mt-0.5 flex-shrink-0">
                    <Icon size={17} className={cfg.color} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{r.titulo}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.nomePaciente ?? "Paciente"} · {tempoRelativo(r.criadoEm)}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-0.5">
                    {busy === r.id ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => agir(r.id, "visualizar")}
                          title="Marcar como visto"
                          aria-label="Marcar como visto"
                          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-background hover:text-primary"
                        >
                          <Check size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => agir(r.id, "descartar")}
                          title="Descartar"
                          aria-label="Descartar"
                          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-background hover:text-coral"
                        >
                          <X size={15} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <Button
          variant="ghost"
          asChild
          className="mt-1 h-8 w-full text-xs text-primary hover:bg-secondary hover:text-purple-dark"
        >
          <Link href="/dashboard/pacientes">Ver pacientes</Link>
        </Button>
      </CardContent>
    </Card>
  )
}
