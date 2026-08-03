"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Search, Loader2, Quote, Info } from "lucide-react"
import { useMe } from "@/lib/use-me"
import { FEATURE, temFeature, readFeatureGate } from "@/lib/feature-gate"
import { UpsellFeature } from "@/components/assinatura/upsell-feature"
import { useFeatureUpsell } from "@/components/assinatura/feature-upsell"

// Busca semântica (RAG, ADR-028) no histórico do paciente. Doctor-facing,
// retrieval-only: lista trechos CITADOS do que foi relatado, com fonte e
// relevância. A IA não interpreta nem sugere conduta (regra clínica #1).

interface Trecho {
  fonte_tipo: string
  fonte_id: string | null
  paciente_id: string | null
  trecho: string
  score: number
  data: string | null
}

const FONTE_LABEL: Record<string, string> = {
  mensagem: "Mensagem",
  diario: "Diário",
  sintoma: "Sintoma",
  evento: "Evento",
  consulta: "Consulta",
  medicamento: "Base clínica",
}

export function BuscaSemantica({ pacienteId }: { pacienteId: string }) {
  const me = useMe()
  const { showUpsell } = useFeatureUpsell()
  const [query, setQuery] = useState("")
  const [trechos, setTrechos] = useState<Trecho[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  // Feature gate (ADR-059): RAG = Pro+. Trava proativa (me.features) + reativa (402).
  const [bloqueado, setBloqueado] = useState(false)
  const semRag = (me?.features != null && !temFeature(me.features, FEATURE.rag)) || bloqueado

  const buscar = async () => {
    const q = query.trim()
    if (!q) return
    setLoading(true)
    setErro(null)
    try {
      const res = await fetch(`/api/pacientes/${pacienteId}/rag/buscar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, incluirKb: true }),
      })
      { const gate = await readFeatureGate(res); if (gate) { setBloqueado(true); setTrechos(null); showUpsell(gate.feature); return } }
      if (!res.ok) {
        setErro(res.status === 503 ? "Busca indisponível no momento." : "Não foi possível buscar.")
        setTrechos(null)
        return
      }
      const data = await res.json()
      setTrechos(data.trechos ?? [])
    } catch {
      setErro("Erro de conexão.")
      setTrechos(null)
    } finally {
      setLoading(false)
    }
  }

  if (semRag) return <UpsellFeature feature={FEATURE.rag} />

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && buscar()}
          placeholder="Buscar no histórico (ex.: quando relatou insônia?)"
          className="flex-1"
        />
        <Button onClick={buscar} disabled={loading || !query.trim()}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </Button>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 shrink-0" />
        Busca factual no que o paciente relatou. A IA não interpreta nem sugere conduta.
      </p>

      {erro && (
        <Card className="border-border/50">
          <CardContent className="p-4 text-sm text-muted-foreground">{erro}</CardContent>
        </Card>
      )}

      {trechos && !erro && trechos.length === 0 && (
        <Card className="border-border/50">
          <CardContent className="p-6 text-center py-8">
            <Search className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Nenhum trecho relevante encontrado.</p>
          </CardContent>
        </Card>
      )}

      {trechos &&
        trechos.map((t, i) => (
          <Card key={t.fonte_id ?? i} className="border-border/50">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
                  <Quote className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="secondary" className="text-xs">
                      {FONTE_LABEL[t.fonte_tipo] ?? t.fonte_tipo}
                    </Badge>
                    {t.data && (
                      <span className="text-xs text-muted-foreground">
                        {new Date(t.data).toLocaleDateString("pt-BR")}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground ml-auto">
                      {Math.round(t.score * 100)}% relevância
                    </span>
                  </div>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{t.trecho}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
    </div>
  )
}
