"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Activity, Loader2, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react"
import { ErroCarregar } from "@/components/admin/erro-carregar"

interface AgenteSaude {
  agente: string
  total: number
  sucessos: number
  falhas: number
  emAberto: number
  latenciaMediaMs: number | null
  latenciaP95Ms: number | null
  custoUsdTotal: number
  ultimoRun: string | null
}
interface AgenteErro {
  agente: string
  erro: string | null
  iniciadoEm: string
}
interface Resposta {
  agentes: AgenteSaude[]
  errosRecentes: AgenteErro[]
}

function ms(n: number | null) {
  if (n == null) return "—"
  return n >= 1000 ? `${(n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s` : `${Math.round(n)} ms`
}
function taxa(a: AgenteSaude) {
  return a.total ? Math.round((a.sucessos / a.total) * 100) : 0
}
function quando(iso: string | null) {
  return iso ? new Date(iso).toLocaleString("pt-BR") : "—"
}
// LGPD categoria especial: a string crua de `agente_execucoes.erro` pode arrastar
// conteúdo clínico/PII de uma exceção Python. Não exibimos o erro cru na tela —
// só uma mensagem genérica. O detalhe real permanece no log interno / na trilha.
const ERRO_REDIGIDO = "Falha técnica no agente (detalhe redigido por segurança — consulte o log interno)."

export default function AgentesPage() {
  const [data, setData] = useState<Resposta>({ agentes: [], errosRecentes: [] })
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null)
    try {
      const r = await fetch("/api/admin/agentes-saude")
      if (r.status === 401) { window.location.href = "/login"; return }
      if (!r.ok) { setErro("Não foi possível carregar a saúde dos agentes."); return }
      setData(await r.json())
    } catch {
      setErro("Erro de conexão ao carregar a saúde dos agentes.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    carregar()
  }, [carregar])

  const totalExec = data.agentes.reduce((s, a) => s + a.total, 0)
  const totalFalhas = data.agentes.reduce((s, a) => s + a.falhas, 0)

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Activity className="h-5 w-5 text-primary" />
            <p className="font-mono text-xs uppercase tracking-widest text-primary">IA</p>
          </div>
          <h1 className="text-2xl font-semibold text-foreground">Saúde dos agentes</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Execuções dos últimos 30 dias · `agente_execucoes`</p>
        </div>
        <Button variant="glass" size="sm" onClick={carregar} disabled={loading} className="gap-1.5">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Execuções (30d)", value: totalExec.toLocaleString("pt-BR"), icon: Activity, cls: "text-primary" },
          { label: "Agentes ativos", value: String(data.agentes.length), icon: CheckCircle2, cls: "text-accent-on-dark" },
          { label: "Falhas (30d)", value: totalFalhas.toLocaleString("pt-BR"), icon: AlertTriangle, cls: totalFalhas ? "text-destructive" : "text-muted-foreground" },
        ].map((k) => (
          <div key={k.label} className="rounded-2xl border border-noir-line bg-noir-surface p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{k.label}</p>
              <k.icon className={`h-4 w-4 ${k.cls}`} />
            </div>
            <p className="text-2xl font-bold text-foreground">{k.value}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : erro ? (
        <ErroCarregar mensagem={erro} onRetry={carregar} />
      ) : data.agentes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-noir-line bg-noir-surface p-16 text-center text-sm text-muted-foreground">
          Sem execuções de agentes registradas nos últimos 30 dias.
        </div>
      ) : (
        <div className="rounded-2xl border border-noir-line bg-noir-surface overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-noir-line">
                {["Agente", "Execuções", "Sucesso", "Falhas", "Em aberto", "Latência média", "p95", "Custo USD", "Último run"].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-noir-line">
              {data.agentes.map((a) => {
                const t = taxa(a)
                return (
                  <tr key={a.agente} className="hover:bg-noir-surface-raised/40 transition-colors">
                    <td className="px-4 py-2.5 font-mono text-xs text-foreground">{a.agente}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{a.total.toLocaleString("pt-BR")}</td>
                    <td className="px-4 py-2.5">
                      <span className={t >= 95 ? "text-accent-on-dark" : t >= 80 ? "text-warning" : "text-destructive"}>{t}%</span>
                    </td>
                    <td className={`px-4 py-2.5 ${a.falhas ? "text-destructive" : "text-muted-foreground"}`}>{a.falhas}</td>
                    <td className={`px-4 py-2.5 ${a.emAberto ? "text-warning" : "text-muted-foreground"}`}>{a.emAberto}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{ms(a.latenciaMediaMs)}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{ms(a.latenciaP95Ms)}</td>
                    <td className="px-4 py-2.5 font-semibold text-warning">$ {a.custoUsdTotal.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{quando(a.ultimoRun)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Erros recentes */}
      {!loading && data.errosRecentes.length > 0 && (
        <div className="rounded-2xl border border-noir-line bg-noir-surface overflow-hidden">
          <div className="flex items-center gap-2 border-b border-noir-line bg-noir-surface-raised px-5 py-3">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <p className="font-mono text-sm font-medium text-foreground">Erros recentes (técnicos)</p>
          </div>
          <div className="divide-y divide-noir-line">
            {data.errosRecentes.map((e, i) => (
              <div key={i} className="px-5 py-3">
                <div className="flex items-center justify-between gap-4">
                  <span className="font-mono text-xs text-foreground">{e.agente}</span>
                  <span className="text-[11px] text-muted-foreground">{quando(e.iniciadoEm)}</span>
                </div>
                <p className="mt-1 line-clamp-2 font-mono text-xs text-destructive/80">{e.erro ? ERRO_REDIGIDO : "—"}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
