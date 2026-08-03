"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Pill, Loader2, RefreshCw, Download, ShieldAlert } from "lucide-react"
import { ErroCarregar } from "@/components/admin/erro-carregar"
import { baixarCsv } from "@/lib/csv"

interface MedNaoReconhecido {
  medicamento: string
  ocorrencias: number
}

interface Cobertura {
  distintosTotal: number
  reconhecidos: number
  naoReconhecidos: number
  dicionarioTamanho: number
  catalogoVersao: string | null
  ativasApenas: boolean
  itens: MedNaoReconhecido[]
}

export default function CoberturaA5Page() {
  const [data, setData] = useState<Cobertura | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [ativasApenas, setAtivasApenas] = useState(false)
  // Guarda de sequência: descarta resposta obsoleta (toggle rápido do checkbox)
  // que chegue fora de ordem e sobrescreva o recorte vigente.
  const reqIdRef = useRef(0)

  const carregar = useCallback(async (apenasAtivas: boolean) => {
    const myId = ++reqIdRef.current
    setLoading(true); setErro(null)
    try {
      const qs = apenasAtivas ? "?ativasApenas=true" : ""
      const r = await fetch(`/api/admin/interacoes-cobertura${qs}`)
      if (myId !== reqIdRef.current) return // resposta obsoleta
      if (r.status === 401) { window.location.href = "/login"; return }
      if (!r.ok) { setErro("Não foi possível carregar a cobertura do A5."); return }
      setData(await r.json())
    } catch {
      if (myId !== reqIdRef.current) return
      setErro("Erro de conexão ao carregar a cobertura do A5.")
    } finally {
      if (myId === reqIdRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => { carregar(ativasApenas) }, [carregar, ativasApenas])

  function exportarCsv() {
    if (!data) return
    baixarCsv(
      `a5-pontos-cegos-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Medicamento", "Ocorrências"],
      data.itens.map((i) => [i.medicamento, i.ocorrencias]),
    )
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Pill className="h-5 w-5 text-primary" />
            <p className="font-mono text-xs uppercase tracking-widest text-primary">A5 · 2ª barreira</p>
          </div>
          <h1 className="text-2xl font-semibold text-foreground">Cobertura do catálogo de interações</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Medicamentos prescritos que o dicionário <strong>não reconhece</strong> — hoje passam sem
            checagem de interação. Worklist para a revisão clínica (Dr. Adonai), por frequência de uso.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="glass" size="sm" onClick={() => carregar(ativasApenas)} disabled={loading} className="gap-1.5">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </Button>
          <Button variant="glass" size="sm" onClick={exportarCsv} disabled={loading || !data?.itens.length} className="gap-1.5">
            <Download className="h-4 w-4" /> CSV
          </Button>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={ativasApenas}
          onChange={(e) => setAtivasApenas(e.target.checked)}
          className="h-4 w-4 accent-primary"
        />
        Considerar apenas prescrições ativas (default: todo o vocabulário já prescrito)
      </label>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : erro ? (
        <ErroCarregar mensagem={erro} onRetry={() => carregar(ativasApenas)} />
      ) : data ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi rotulo="No dicionário" valor={data.dicionarioTamanho} />
            <Kpi rotulo="Distintos prescritos" valor={data.distintosTotal} />
            <Kpi rotulo="Reconhecidos" valor={data.reconhecidos} />
            <Kpi rotulo="Sem reconhecimento" valor={data.naoReconhecidos} alerta={data.naoReconhecidos > 0} />
          </div>

          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
            <p className="flex items-start gap-2 text-foreground">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span>
                Estes medicamentos <strong>não disparam alerta de interação</strong> hoje — a ausência de alerta
                neles não significa ausência de interação. Adicioná-los ao <code className="font-mono text-xs">medicamento_dicionario</code>{" "}
                (genérico + classe + sinônimos) é decisão clínica do Dr. Adonai.{" "}
                {data.catalogoVersao && <>Catálogo atual: <code className="font-mono text-xs">{data.catalogoVersao}</code>.</>}
              </span>
            </p>
          </div>

          {data.itens.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Todos os medicamentos prescritos são reconhecidos pelo dicionário.
            </p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-noir-line">
              <table className="w-full text-sm">
                <thead className="bg-noir-surface-raised text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Medicamento (texto da prescrição)</th>
                    <th className="px-4 py-2.5 text-right font-medium">Ocorrências</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-noir-line">
                  {data.itens.map((i, idx) => (
                    <tr key={idx} className="hover:bg-noir-surface-raised/50">
                      <td className="px-4 py-2.5 text-foreground">{i.medicamento}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">{i.ocorrencias}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}

function Kpi({ rotulo, valor, alerta }: { rotulo: string; valor: number; alerta?: boolean }) {
  return (
    <div className="rounded-xl border border-noir-line bg-noir-surface p-4">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className={`mt-1 text-2xl font-semibold ${alerta ? "text-amber-500" : "text-foreground"}`}>
        {valor.toLocaleString("pt-BR")}
      </p>
    </div>
  )
}
