"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { AlertTriangle, Loader2, MessageSquareWarning } from "lucide-react"
import { tempoRelativo } from "@/lib/tempo"

interface Escalacao {
  conversaId: string
  pacienteId: string
  pacienteNome: string | null
  status: string
  criadaEm: string
  ultimaEm: string | null
  motivo: string | null
}

/**
 * Fila de escalação humana no topo de Mensagens. Some quando vazia. "Assumir"
 * devolve a conversa ao fluxo (status='aberta'). clinical-safety #4: o humano é
 * o loop; aqui só metadados, sem conteúdo de conversa.
 */
export function EscalacaoInbox() {
  const [itens, setItens] = useState<Escalacao[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/escalacoes")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setItens(Array.isArray(rows) ? rows : []))
      .catch(() => setItens([]))
      .finally(() => setLoading(false))
  }, [])

  async function assumir(conversaId: string) {
    setBusy(conversaId)
    setErro(null)
    try {
      const r = await fetch(`/api/escalacoes/${conversaId}/assumir`, { method: "POST" })
      if (r.ok) {
        setItens((prev) => prev.filter((x) => x.conversaId !== conversaId))
      } else {
        // Falha conhecida do backend: mantém o item na fila (estado seguro,
        // a conversa continua com dono pendente) e avisa o médico.
        setErro(conversaId)
      }
    } catch {
      // Falha de rede/inesperada: idem — não some da fila, só avisa.
      setErro(conversaId)
    } finally {
      setBusy(null)
    }
  }

  if (loading || itens.length === 0) return null

  return (
    <div className="border-b border-coral/30 bg-coral/5 px-4 py-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
        <MessageSquareWarning className="h-4 w-4 text-coral" />
        Escalações aguardando você ({itens.length})
      </div>
      <div className="space-y-1.5">
        {itens.map((e) => (
          <div key={e.conversaId} className="rounded-xl bg-background/70 px-3 py-2">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-4 w-4 shrink-0 text-coral" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {e.pacienteNome ?? "Paciente"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {e.motivo ?? "Conversa em atendimento humano"} ·{" "}
                  {tempoRelativo(e.ultimaEm ?? e.criadaEm)}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-8 shrink-0"
                disabled={busy === e.conversaId}
                onClick={() => assumir(e.conversaId)}
              >
                {busy === e.conversaId ? <Loader2 className="h-4 w-4 animate-spin" /> : "Assumir"}
              </Button>
            </div>
            {erro === e.conversaId && (
              <p className="mt-1.5 pl-7 text-xs text-coral" role="alert">
                Não foi possível assumir esta conversa agora. Tente novamente em instantes.
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
