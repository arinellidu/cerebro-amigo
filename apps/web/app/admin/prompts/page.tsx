"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { FileText, Lock, Loader2, RefreshCw, AlertCircle } from "lucide-react"
import { promptTravado } from "@/lib/prompts-guard"
import { ErroCarregar } from "@/components/admin/erro-carregar"

interface PromptAtivo {
  id: string
  agente: string
  nome: string
  versao: number
  conteudo: string
  metadata?: string
  criadoEm: string
  criadoPorNome?: string
}

export default function AdminPromptsPage() {
  const [prompts, setPrompts] = useState<PromptAtivo[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null)
    try {
      const r = await fetch("/api/prompts/")
      if (r.status === 401) { window.location.href = "/login"; return }
      if (!r.ok) { setErro("Não foi possível carregar os prompts."); return }
      setPrompts(await r.json())
    } catch {
      setErro("Erro de conexão ao carregar os prompts.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    carregar()
  }, [carregar])

  const porAgente = prompts.reduce<Record<string, PromptAtivo[]>>((acc, p) => {
    ;(acc[p.agente] ??= []).push(p)
    return acc
  }, {})

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <FileText className="h-5 w-5 text-primary" />
            <p className="font-mono text-xs uppercase tracking-widest text-primary">IA</p>
          </div>
          <h1 className="text-2xl font-semibold text-foreground">Editor de Prompts</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Prompts system dos agentes e do orchestrator. Cada alteração cria nova versão; a anterior é preservada para auditoria.
          </p>
        </div>
        <Button variant="glass" size="sm" onClick={carregar} disabled={loading} className="gap-1.5">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : erro ? (
        <ErroCarregar mensagem={erro} onRetry={carregar} />
      ) : prompts.length === 0 ? (
        <div className="flex items-center gap-2 rounded-2xl border border-dashed border-noir-line bg-noir-surface p-16 justify-center text-sm text-muted-foreground">
          <AlertCircle className="w-4 h-4" />
          Nenhum prompt cadastrado. Os builtin (hardcoded) estão em uso.
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(porAgente).map(([agente, lista]) => (
            <div key={agente} className="rounded-2xl border border-noir-line bg-noir-surface overflow-hidden">
              <div className="border-b border-noir-line bg-noir-surface-raised px-5 py-3">
                <p className="font-mono text-sm font-medium capitalize text-foreground">{agente.replace(/_/g, " ")}</p>
              </div>
              <div className="divide-y divide-noir-line">
                {lista.map((p) => {
                  const travado = promptTravado(p.agente, p.nome)
                  return (
                    <div key={p.id} className="flex items-start justify-between gap-4 px-5 py-3.5">
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium capitalize text-foreground">{p.nome.replace(/_/g, " ")}</span>
                          <span className="rounded-md border border-noir-line px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                            v{p.versao}
                          </span>
                          {travado && (
                            <span className="inline-flex items-center gap-1 rounded-md bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                              <Lock className="h-2.5 w-2.5" /> Crise · somente leitura
                            </span>
                          )}
                        </div>
                        <p className="line-clamp-1 max-w-xl text-xs text-muted-foreground">{p.conteudo.slice(0, 140)}…</p>
                        <p className="text-[11px] text-muted-foreground/70">
                          Editado por {p.criadoPorNome ?? "sistema"} em {new Date(p.criadoEm).toLocaleDateString("pt-BR")}
                        </p>
                      </div>
                      <Link href={`/admin/prompts/${encodeURIComponent(p.agente)}/${encodeURIComponent(p.nome)}`}>
                        <Button size="sm" variant="ghost">
                          {travado ? "Ver" : "Ver / Editar"}
                        </Button>
                      </Link>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
