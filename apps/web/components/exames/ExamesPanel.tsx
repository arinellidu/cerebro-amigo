"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2, FlaskConical, AlertTriangle, CheckCircle2, Clock } from "lucide-react"

interface Exame {
  id: string
  tipoExame: string
  motivo: string
  devidoEm: string
  status: string
  refLabel: string | null
  refUnidade: string | null
  refMin: number | null
  refMax: number | null
  resultadoValor: number | null
  resultadoEm: string | null
  foraFaixa: boolean | null
  atrasado: boolean
}

const LABEL: Record<string, string> = {
  litemia: "Litemia",
  hemograma: "Hemograma",
  funcao_hepatica: "Função hepática",
  perfil_metabolico: "Perfil metabólico",
  peso: "Peso",
  ecg_qt: "ECG (QTc)",
}

function dataBR(iso: string | null) {
  if (!iso) return "—"
  return new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR")
}
function faixaTexto(e: Exame) {
  if (e.refMin == null && e.refMax == null) return null
  const u = e.refUnidade ? ` ${e.refUnidade}` : ""
  return `Ref.: ${e.refMin ?? "—"}–${e.refMax ?? "—"}${u}`
}

/**
 * Painel de monitoramento de exames laboratoriais (S2). A agenda vem do job
 * determinístico (gerador_exames); aqui o médico vê pendentes/atrasados e
 * registra o resultado. Faixa e flag fora-de-faixa são factuais; a decisão é
 * do médico (regra #1) — nada de conduta sugerida pela IA.
 */
export function ExamesPanel({ pacienteId }: { pacienteId: string }) {
  const [exames, setExames] = useState<Exame[]>([])
  const [loading, setLoading] = useState(true)
  const [valores, setValores] = useState<Record<string, string>>({})
  const [salvando, setSalvando] = useState<string | null>(null)
  const [erros, setErros] = useState<Record<string, string>>({})

  const carregar = useCallback(() => {
    setLoading(true)
    fetch(`/api/pacientes/${pacienteId}/exames`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: Exame[]) => setExames(Array.isArray(d) ? d : []))
      .catch(() => setExames([]))
      .finally(() => setLoading(false))
  }, [pacienteId])

  useEffect(() => carregar(), [carregar])

  async function registrar(ex: Exame) {
    const raw = (valores[ex.id] ?? "").trim().replace(",", ".")
    const valor = Number(raw)
    if (!raw || Number.isNaN(valor)) return
    setSalvando(ex.id)
    setErros((e) => ({ ...e, [ex.id]: "" }))
    try {
      const r = await fetch(`/api/exames/${ex.id}/resultado`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ valor }),
      })
      if (r.ok) {
        setValores((v) => ({ ...v, [ex.id]: "" }))
        carregar()
      } else {
        setErros((e) => ({
          ...e,
          [ex.id]: "Não foi possível registrar o resultado do exame. Tente novamente.",
        }))
      }
    } catch {
      setErros((e) => ({
        ...e,
        [ex.id]: "Não foi possível registrar o resultado do exame. Tente novamente.",
      }))
    } finally {
      setSalvando(null)
    }
  }

  if (loading)
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )

  const pendentes = exames.filter((e) => e.status === "agendado")
  const realizados = exames.filter((e) => e.status === "realizado")

  if (exames.length === 0)
    return (
      <Card className="border-border/50">
        <CardContent className="p-6 py-8 text-center">
          <FlaskConical className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Nenhum exame de monitoramento agendado. O agendamento é gerado das prescrições
            ativas (lítio, clozapina, antipsicóticos, valproato).
          </p>
        </CardContent>
      </Card>
    )

  return (
    <div className="space-y-4">
      {pendentes.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            A realizar
          </p>
          {pendentes.map((e) => (
            <Card key={e.id} className={`border-border/50 ${e.atrasado ? "border-warning/50" : ""}`}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">
                    {LABEL[e.tipoExame] ?? e.tipoExame}
                  </p>
                  {e.atrasado ? (
                    <Badge className="border-0 bg-warning/15 text-xs text-warning">
                      <AlertTriangle className="mr-1 h-3 w-3" /> Atrasado
                    </Badge>
                  ) : (
                    <Badge className="border-0 bg-muted text-xs text-muted-foreground">
                      <Clock className="mr-1 h-3 w-3" /> {dataBR(e.devidoEm)}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Motivo: {e.motivo}
                  {faixaTexto(e) ? ` · ${faixaTexto(e)}` : ""}
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <Input
                    inputMode="decimal"
                    placeholder={e.refUnidade ? `valor (${e.refUnidade})` : "valor"}
                    value={valores[e.id] ?? ""}
                    onChange={(ev) => setValores((v) => ({ ...v, [e.id]: ev.target.value }))}
                    className="h-9 max-w-[160px]"
                  />
                  <Button
                    size="sm"
                    onClick={() => registrar(e)}
                    disabled={salvando === e.id || !(valores[e.id] ?? "").trim()}
                  >
                    {salvando === e.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Registrar"}
                  </Button>
                </div>
                {erros[e.id] ? (
                  <p className="flex items-center gap-1 text-xs text-destructive" role="alert">
                    <AlertTriangle className="h-3 w-3 shrink-0" /> {erros[e.id]}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {realizados.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Resultados
          </p>
          {realizados.map((e) => (
            <Card key={e.id} className="border-border/50">
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {LABEL[e.tipoExame] ?? e.tipoExame}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {e.resultadoValor ?? "—"}
                    {e.refUnidade ? ` ${e.refUnidade}` : ""} · {dataBR(e.resultadoEm)}
                    {faixaTexto(e) ? ` · ${faixaTexto(e)}` : ""}
                  </p>
                </div>
                {e.foraFaixa === true ? (
                  <Badge className="border-0 bg-destructive/15 text-xs text-destructive">
                    <AlertTriangle className="mr-1 h-3 w-3" /> Fora da faixa
                  </Badge>
                ) : e.foraFaixa === false ? (
                  <Badge className="border-0 bg-success/15 text-xs text-success">
                    <CheckCircle2 className="mr-1 h-3 w-3" /> Na faixa
                  </Badge>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="px-1 text-[11px] text-muted-foreground">
        Agenda determinística a partir das prescrições ativas. Faixas de referência são
        factuais; a interpretação e a conduta são do médico.
      </p>
    </div>
  )
}
