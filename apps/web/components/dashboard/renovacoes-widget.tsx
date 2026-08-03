"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { FileClock, Loader2, Check, X, AlertCircle } from "lucide-react"

interface Renovacao {
  id: string
  medicamento: string
  receitaTipo: string | null
  venceEm: string
  status: string
  diasParaVencer: number
  pacienteId: string
  pacienteNome: string | null
}

function venceTexto(dias: number): string {
  if (dias < 0) return `venceu há ${Math.abs(dias)} dia(s)`
  if (dias === 0) return "vence hoje"
  return `vence em ${dias} dia(s)`
}

// Renovações de receita controlada próximas do vencimento (A4). A fila é gerada
// pelo job determinístico; o médico reemite via MEMED e marca como renovada.
export function RenovacoesWidget() {
  const [itens, setItens] = useState<Renovacao[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/renovacoes")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setItens(Array.isArray(rows) ? rows : []))
      .catch(() => setItens([]))
      .finally(() => setLoading(false))
  }, [])

  // Otimista: remove da lista; se falhar, restaura.
  async function resolver(id: string, acao: "renovada" | "dispensar") {
    setBusy(id)
    const anterior = itens
    setItens((prev) => prev.filter((x) => x.id !== id))
    try {
      const r = await fetch(`/api/renovacoes/${id}/${acao}`, { method: "POST" })
      if (!r.ok) setItens(anterior)
    } catch {
      setItens(anterior)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className="border-border/80 hover:border-primary/25 transition-all duration-200">
      <CardHeader className="pb-1 pt-5 px-5">
        <CardTitle className="flex items-center gap-2 text-[0.9375rem] font-semibold text-foreground">
          <FileClock className="h-4 w-4 text-primary" /> Renovações de receita
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pt-1 pb-3">
        {loading ? (
          <div className="flex justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : itens.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-muted-foreground">
            Nenhuma renovação pendente.
          </p>
        ) : (
          <div className="space-y-1">
            {itens.slice(0, 5).map((r) => {
              const urgente = r.diasParaVencer <= 2
              return (
                <div
                  key={r.id}
                  className={`flex items-start gap-3 rounded-xl px-3 py-2.5 ${urgente ? "bg-coral/7" : "bg-warning/7"}`}
                >
                  <AlertCircle size={17} className={`mt-0.5 flex-shrink-0 ${urgente ? "text-coral" : "text-warning"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{r.medicamento}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.pacienteNome ?? "Paciente"} · {venceTexto(r.diasParaVencer)}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-0.5">
                    {busy === r.id ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => resolver(r.id, "renovada")}
                          title="Marcar como renovada"
                          aria-label="Marcar como renovada"
                          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-background hover:text-primary"
                        >
                          <Check size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => resolver(r.id, "dispensar")}
                          title="Dispensar"
                          aria-label="Dispensar"
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
          <Link href="/dashboard/prontuarios">Ver prontuários</Link>
        </Button>
      </CardContent>
    </Card>
  )
}
