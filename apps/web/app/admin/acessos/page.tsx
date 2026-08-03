"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Eye, RefreshCw, Loader2, Search, AlertTriangle, ShieldCheck } from "lucide-react"
import { ErroCarregar } from "@/components/admin/erro-carregar"

interface Acesso {
  id: string
  criadoEm: string
  recurso: string
  medicoNome: string | null
  pacienteNome: string | null
  acessoCruzado: boolean
}
interface Trilha {
  total30d: number
  cruzados30d: number
  itens: Acesso[]
}

const RECURSO_LABEL: Record<string, string> = {
  timeline: "Timeline",
  humor: "Humor",
  adesao: "Adesão",
  resumo_pre_consulta: "Resumo pré-consulta",
  exames: "Exames",
}

const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR")

export default function AcessosPage() {
  const [t, setT] = useState<Trilha | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState("")

  const carregar = useCallback(async (q: string) => {
    setLoading(true); setErro(null)
    try {
      const r = await fetch(`/api/admin/acessos?q=${encodeURIComponent(q)}`)
      if (r.status === 401) { window.location.href = "/login"; return }
      if (!r.ok) { setErro("Não foi possível carregar a trilha de acesso."); return }
      setT(await r.json())
    } catch {
      setErro("Erro de conexão ao carregar a trilha de acesso.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const id = setTimeout(() => carregar(busca), 300)
    return () => clearTimeout(id)
  }, [busca, carregar])

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Eye className="h-5 w-5 text-accent" />
            <p className="font-mono text-xs uppercase tracking-widest text-accent">LGPD · art. 37</p>
          </div>
          <h1 className="text-2xl font-semibold text-foreground">Trilha de acesso</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Quem acessou qual paciente · trilha append-only · só metadados</p>
        </div>
        <Button variant="glass" size="sm" onClick={() => carregar(busca)} disabled={loading} className="gap-1.5">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-noir-line bg-noir-surface p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Acessos (30d)</p>
            <Eye className="h-4 w-4 text-primary" />
          </div>
          <p className="text-2xl font-bold text-foreground">{t?.total30d ?? "—"}</p>
        </div>
        <div className="rounded-2xl border border-noir-line bg-noir-surface p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Acessos cruzados (30d)</p>
            {(t?.cruzados30d ?? 0) > 0 ? <AlertTriangle className="h-4 w-4 text-destructive" /> : <ShieldCheck className="h-4 w-4 text-success" />}
          </div>
          <p className={`text-2xl font-bold ${(t?.cruzados30d ?? 0) > 0 ? "text-destructive" : "text-foreground"}`}>{t?.cruzados30d ?? "—"}</p>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por médico ou paciente" className="pl-9" />
      </div>

      {loading && !t ? (
        <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : erro ? (
        <ErroCarregar mensagem={erro} onRetry={() => carregar(busca)} />
      ) : !t || t.itens.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-noir-line bg-noir-surface p-16 text-center text-sm text-muted-foreground">
          Nenhum acesso registrado {busca ? "para o filtro" : "ainda"}.
        </div>
      ) : (
        <div className="rounded-2xl border border-noir-line bg-noir-surface overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-noir-line bg-noir-surface-raised">
                {["Quando", "Médico", "Paciente", "Recurso", "Acesso"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-noir-line">
              {t.itens.map((a) => (
                <tr key={a.id} className={`transition-colors ${a.acessoCruzado ? "bg-destructive/5 hover:bg-destructive/10" : "hover:bg-noir-surface-raised/40"}`}>
                  <td className="px-5 py-2.5 text-xs text-muted-foreground">{quando(a.criadoEm)}</td>
                  <td className="px-5 py-2.5 text-foreground">{a.medicoNome ?? "—"}</td>
                  <td className="px-5 py-2.5 text-foreground">{a.pacienteNome ?? "—"}</td>
                  <td className="px-5 py-2.5">
                    <Badge className="border border-noir-line bg-noir-surface-raised font-mono text-[10px] text-muted-foreground">
                      {RECURSO_LABEL[a.recurso] ?? a.recurso}
                    </Badge>
                  </td>
                  <td className="px-5 py-2.5">
                    {a.acessoCruzado
                      ? <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive"><AlertTriangle className="h-3.5 w-3.5" /> cruzado</span>
                      : <span className="text-xs text-success">próprio</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
        <Eye className="h-3 w-3" /> Registro append-only das operações de tratamento (LGPD art. 37). "Cruzado" = acesso a paciente que não é do médico — sinal de bypass/anomalia (hoje detectado sobretudo via Exames; os demais reads são bloqueados antes do acesso).
      </p>
    </div>
  )
}
