"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Sparkles, Loader2, Copy, Check, ChevronDown, ChevronUp } from "lucide-react"

const TIPOS = [
  { v: "confirmar", label: "Confirmar presença" },
  { v: "remarcar", label: "Remarcar consulta" },
  { v: "lembrete_logistico", label: "Lembrete logístico" },
]

/**
 * Composer de comunicação ADMINISTRATIVA. A IA (orchestrator-py, guard imutável)
 * só rascunha texto administrativo — nunca clínico. O médico edita e envia pelo
 * próprio canal; não há envio automático ao paciente.
 */
export function RascunhoAdmin({
  pacienteId,
  pacienteNome,
}: {
  pacienteId: string
  pacienteNome: string | null
}) {
  const [aberto, setAberto] = useState(false)
  const [tipo, setTipo] = useState("confirmar")
  const [contexto, setContexto] = useState("")
  const [gerando, setGerando] = useState(false)
  const [rascunho, setRascunho] = useState("")
  const [recusado, setRecusado] = useState(false)
  const [copiado, setCopiado] = useState(false)

  async function gerar() {
    setGerando(true)
    setRecusado(false)
    try {
      const r = await fetch("/api/comunicacao/rascunho", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pacienteId, tipo, nomePaciente: pacienteNome ?? "", contexto }),
      })
      const data = await r.json().catch(() => null)
      if (data?.administrativo === false) {
        setRecusado(true)
        setRascunho("")
      } else {
        setRascunho(data?.rascunho ?? "")
      }
    } finally {
      setGerando(false)
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(rascunho)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      /* clipboard indisponível */
    }
  }

  return (
    <div className="border-t border-border/60 bg-background px-5 py-3">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex items-center gap-2 text-xs font-medium text-primary"
      >
        <Sparkles className="h-3.5 w-3.5" /> Rascunhar comunicação administrativa
        {aberto ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {aberto && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger className="h-9 w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS.map((t) => (
                  <SelectItem key={t.v} value={t.v}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Dados (ex.: nova data 12/06 às 15h)"
              value={contexto}
              onChange={(e) => setContexto(e.target.value)}
              className="h-9 min-w-[220px] flex-1"
            />
            <Button size="sm" onClick={gerar} disabled={gerando} className="h-9 gap-1.5">
              {gerando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Gerar
            </Button>
          </div>

          {recusado && (
            <p className="text-xs text-coral">
              O pedido parece exigir conteúdo clínico — a IA só rascunha comunicação
              administrativa. Reformule de forma logística.
            </p>
          )}

          {rascunho && (
            <div className="space-y-2">
              <textarea
                value={rascunho}
                onChange={(e) => setRascunho(e.target.value)}
                rows={4}
                className="w-full resize-none rounded-xl border border-border/60 bg-muted/30 p-3 text-sm outline-none focus:border-primary"
              />
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={copiar} className="h-8 gap-1.5">
                  {copiado ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiado ? "Copiado" : "Copiar"}
                </Button>
                <span className="text-xs text-muted-foreground">
                  Revise antes de enviar pelo seu canal. Conteúdo administrativo apenas.
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
