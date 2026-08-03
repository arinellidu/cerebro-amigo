"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ShieldAlert, ShieldCheck, ShieldQuestion, Loader2, Search } from "lucide-react"
import { MedicamentoPickerClasse } from "@/components/medicamentos/picker-classe"

interface Alerta {
  tipo: string // "interacao" | "duplicidade"
  severidade: string // "grave" | "moderada"
  medicamentoA: string
  medicamentoB: string
  mecanismo: string
  recomendacao: string | null
  fonte: string | null
}

interface Resposta {
  alertas: Alerta[]
  disclaimer: string
  catalogoVersao: string | null
}

/**
 * Segunda barreira de interações/duplicidade (A5, ADR-032). Checagem
 * DETERMINÍSTICA contra base local versionada — NÃO é IA, NÃO substitui o MEMED
 * nem a bula. Ao abrir, avalia o conjunto de prescrições ATIVAS do paciente; o
 * médico pode testar um medicamento candidato antes de prescrever. A decisão é
 * sempre do médico.
 */
export function VerificadorInteracoes({ pacienteId }: { pacienteId: string }) {
  const [resp, setResp] = useState<Resposta | null>(null)
  const [loading, setLoading] = useState(true)
  // Erro distingue "a checagem FALHOU" de "rodou e não achou nada". Nunca
  // colapsar os dois: uma 2ª barreira que falhou não pode parecer "sem interações".
  const [erro, setErro] = useState(false)
  const [candidato, setCandidato] = useState("")
  // Nomes avaliados na última checagem (texto livre ou seleção do catálogo) — mostrados
  // como chips p/ o médico ver exatamente o que foi cruzado contra os ativos do paciente.
  const [consultados, setConsultados] = useState<string[]>([])

  const checar = useCallback(
    async (medicamentos?: string[]) => {
      setLoading(true)
      setErro(false)
      setConsultados(medicamentos ?? [])
      try {
        const r = await fetch("/api/prescricoes/checar-interacoes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pacienteId, medicamentos: medicamentos ?? [] }),
        })
        const d = await r.json().catch(() => null)
        if (r.ok && d) {
          setResp(d)
        } else {
          setResp(null)
          setErro(true)
        }
      } catch {
        setResp(null)
        setErro(true)
      } finally {
        setLoading(false)
      }
    },
    [pacienteId],
  )

  useEffect(() => {
    void checar()
  }, [checar])

  const alertas = resp?.alertas ?? []
  const temGrave = alertas.some((a) => a.severidade === "grave")

  return (
    <div className="rounded-xl border border-border/70 bg-card/50 p-4">
      <div className="mb-3 flex items-center gap-2">
        {erro ? (
          <ShieldQuestion className="h-4 w-4 text-warning" />
        ) : alertas.length > 0 ? (
          <ShieldAlert className={`h-4 w-4 ${temGrave ? "text-coral" : "text-warning"}`} />
        ) : (
          <ShieldCheck className="h-4 w-4 text-primary" />
        )}
        <h4 className="text-sm font-semibold text-foreground">Interações (2ª barreira)</h4>
      </div>

      {/* Testar medicamento(s) candidato(s) contra os ativos do paciente:
          digitar OU escolher do catálogo por classe (sem precisar lembrar o nome). */}
      <div className="mb-3 space-y-2">
        <div className="flex gap-2">
          <Input
            value={candidato}
            onChange={(e) => setCandidato(e.target.value)}
            placeholder="Avaliar medicamento (ex.: Tramadol)"
            className="h-9 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && candidato.trim()) void checar([candidato.trim()])
            }}
          />
          <Button
            type="button"
            variant="secondary"
            className="h-9 gap-1.5"
            disabled={loading || !candidato.trim()}
            onClick={() => candidato.trim() && void checar([candidato.trim()])}
          >
            <Search className="h-4 w-4" /> Verificar
          </Button>
        </div>
        <MedicamentoPickerClasse
          onConfirmar={(nomes) => {
            setCandidato("")
            void checar(nomes)
          }}
        />
        {consultados.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[0.7rem] text-muted-foreground">Avaliando:</span>
            {consultados.map((n) => (
              <Badge key={n} variant="outline" className="text-[0.7rem]">
                {n}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-4 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : erro ? (
        <div
          role="alert"
          className="rounded-lg border-l-2 border-warning bg-warning/5 p-2.5 text-sm"
        >
          <p className="font-medium text-foreground">Não foi possível verificar interações agora.</p>
          <p className="mt-0.5 text-muted-foreground">
            A 2ª barreira não foi concluída — <span className="font-medium text-foreground">não trate esta tela como &quot;sem interações&quot;</span>. Verifique novamente antes de prescrever.
          </p>
          <Button
            type="button"
            variant="secondary"
            className="mt-2 h-8 gap-1.5"
            onClick={() => void checar(candidato.trim() ? [candidato.trim()] : undefined)}
          >
            <Search className="h-3.5 w-3.5" /> Tentar novamente
          </Button>
        </div>
      ) : alertas.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">
          Nenhuma interação conhecida na base local.
        </p>
      ) : (
        <ul className="space-y-2">
          {alertas.map((a, i) => {
            const grave = a.severidade === "grave"
            return (
              <li
                key={i}
                className={`rounded-lg border-l-2 p-2.5 text-sm ${grave ? "border-coral bg-coral/5" : "border-warning bg-warning/5"}`}
              >
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  <Badge variant={grave ? "destructive" : "secondary"} className="text-[0.65rem] uppercase">
                    {a.severidade}
                  </Badge>
                  <Badge variant="outline" className="text-[0.65rem]">
                    {a.tipo === "duplicidade" ? "duplicidade" : "interação"}
                  </Badge>
                  <span className="font-medium text-foreground">
                    {a.medicamentoA} × {a.medicamentoB}
                  </span>
                </div>
                <p className="text-muted-foreground">{a.mecanismo}</p>
                {a.recomendacao && <p className="mt-0.5 text-foreground/80">{a.recomendacao}</p>}
                {a.fonte && <p className="mt-0.5 text-[0.7rem] text-muted-foreground">Fonte: {a.fonte}</p>}
              </li>
            )
          })}
        </ul>
      )}

      {resp?.disclaimer && (
        <p className="mt-3 border-t border-border/60 pt-2 text-[0.7rem] leading-snug text-muted-foreground">
          {resp.disclaimer}
        </p>
      )}
    </div>
  )
}
