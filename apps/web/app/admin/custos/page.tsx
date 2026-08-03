"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Cpu, Loader2, RefreshCw, DollarSign, Download } from "lucide-react"
import { ErroCarregar } from "@/components/admin/erro-carregar"
import { baixarCsv } from "@/lib/csv"

interface CustoMes {
  mes: string
  agente: string
  execucoes: number
  tokensInTotal: number | null
  tokensOutTotal: number | null
  custoTotalUsd: number
}

function fmt4(n: number) {
  return `$ ${n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`
}
function fmtNum(n: number | null) {
  return n ? n.toLocaleString("en-US") : "—"
}

export default function CustosPage() {
  const [rows, setRows] = useState<CustoMes[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null)
    try {
      const r = await fetch("/api/admin/custos-llm")
      if (r.status === 401) { window.location.href = "/login"; return }
      if (!r.ok) { setErro("Não foi possível carregar os custos de IA."); return }
      setRows(await r.json())
    } catch {
      setErro("Erro de conexão ao carregar os custos de IA.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  // Agrupa por mês
  const porMes = rows.reduce<Record<string, { total: number; agentes: CustoMes[] }>>((acc, r) => {
    acc[r.mes] ??= { total: 0, agentes: [] }
    acc[r.mes].total += r.custoTotalUsd
    acc[r.mes].agentes.push(r)
    return acc
  }, {})

  const totalGeral = rows.reduce((s, r) => s + r.custoTotalUsd, 0)
  const execucoesGeral = rows.reduce((s, r) => s + r.execucoes, 0)

  function exportarCsv() {
    baixarCsv(
      `custos-ia-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Mês", "Agente", "Execuções", "Tokens entrada", "Tokens saída", "Custo USD"],
      rows.map((r) => [r.mes?.slice(0, 7), r.agente, r.execucoes, r.tokensInTotal, r.tokensOutTotal, r.custoTotalUsd]),
    )
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1"><Cpu className="h-5 w-5 text-primary" /><p className="font-mono text-xs uppercase tracking-widest text-primary">IA</p></div>
          <h1 className="text-2xl font-semibold text-foreground">Custos de IA</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Últimos 12 meses · Agentes Python (Anthropic)</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="glass" size="sm" onClick={carregar} disabled={loading} className="gap-1.5">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </Button>
          <Button variant="glass" size="sm" onClick={exportarCsv} disabled={!rows.length} className="gap-1.5">
            <Download className="h-4 w-4" /> CSV
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Total 12 meses", value: fmt4(totalGeral), icon: DollarSign, cls: "text-warning" },
          { label: "Execuções", value: execucoesGeral.toLocaleString("pt-BR"), icon: Cpu, cls: "text-primary" },
          { label: "Agentes distintos", value: String(new Set(rows.map((r) => r.agente)).size), icon: Cpu, cls: "text-accent-on-dark" },
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
        <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : erro ? (
        <ErroCarregar mensagem={erro} onRetry={carregar} />
      ) : Object.keys(porMes).length === 0 ? (
        <div className="rounded-2xl border border-dashed border-noir-line bg-noir-surface p-16 text-center text-sm text-muted-foreground">
          Sem execuções de agentes registradas ainda.
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(porMes).map(([mes, { total, agentes }]) => (
            <div key={mes} className="rounded-2xl border border-noir-line bg-noir-surface overflow-hidden">
              <div className="flex items-center justify-between border-b border-noir-line bg-noir-surface-raised px-5 py-3">
                <p className="font-mono text-sm font-medium text-foreground">{mes.slice(0, 7)}</p>
                <p className="font-mono text-sm font-semibold text-warning">{fmt4(total)}</p>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-noir-line">
                    {["Agente", "Execuções", "Tokens entrada", "Tokens saída", "Custo USD"].map((h) => (
                      <th key={h} className="px-5 py-2.5 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-noir-line">
                  {agentes.map((a) => (
                    <tr key={a.agente} className="hover:bg-noir-surface-raised/40 transition-colors">
                      <td className="px-5 py-2.5 font-mono text-xs text-foreground">{a.agente}</td>
                      <td className="px-5 py-2.5 text-muted-foreground">{a.execucoes.toLocaleString("pt-BR")}</td>
                      <td className="px-5 py-2.5 text-muted-foreground">{fmtNum(a.tokensInTotal)}</td>
                      <td className="px-5 py-2.5 text-muted-foreground">{fmtNum(a.tokensOutTotal)}</td>
                      <td className="px-5 py-2.5 font-semibold text-warning">{fmt4(a.custoTotalUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
