"use client"

import { type ReactNode, useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import {
  LineChart, RefreshCw, Loader2, DollarSign, TrendingUp, AlertTriangle, Clock, CreditCard, UserPlus,
} from "lucide-react"
import { ErroCarregar } from "@/components/admin/erro-carregar"

interface MrrPlano { plano: string; quantidade: number; valor: number }
interface ReceitaMes { mes: string; valor: number; pagamentos: number }
interface Inadimplente { assinaturaId: string; medicoId: string; medicoNome: string | null; medicoEmail: string | null; valorMensal: number; desde: string }
interface TrialItem { assinaturaId: string; medicoId: string; medicoNome: string | null; trialAte: string | null }
interface Cobravel { assinaturaId: string; medicoId: string; medicoNome: string | null; valorMensal: number; cpf: string | null }
interface Cockpit {
  mrr: number
  mrrPorPlano: MrrPlano[]
  receitaMensal: ReceitaMes[]
  inadimplencia: { mrrEmRisco: number; itens: Inadimplente[] }
  trials: { ativos: number; expirando: TrialItem[] }
  funil: { convidados: number; ativaram: number; emTrial: number; convertidos: number }
  cobraveisSemAsaas: Cobravel[]
}

const brl = (n: number) => `R$ ${(n ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
const dataCurta = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—")

export default function ReceitaPage() {
  const [c, setC] = useState<Cockpit | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null)
    try {
      const r = await fetch("/api/admin/cockpit")
      if (r.status === 401) { window.location.href = "/login"; return }
      if (!r.ok) { setErro("Não foi possível carregar o cockpit de receita."); return }
      setC(await r.json())
    } catch {
      setErro("Erro de conexão ao carregar o cockpit.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const mesAtual = new Date().toISOString().slice(0, 7)
  const receitaMes = c?.receitaMensal.find((m) => m.mes === mesAtual)?.valor ?? 0
  const maxReceita = Math.max(1, ...(c?.receitaMensal ?? []).map((m) => m.valor))

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <LineChart className="h-5 w-5 text-accent" />
            <p className="font-mono text-xs uppercase tracking-widest text-accent">Receita</p>
          </div>
          <h1 className="text-2xl font-semibold text-foreground">Cockpit de receita</h1>
          <p className="text-sm text-muted-foreground mt-0.5">MRR, inadimplência e conversão (cobrança plataforma → médico)</p>
        </div>
        <Button variant="glass" size="sm" onClick={carregar} disabled={loading} className="gap-1.5">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : erro || !c ? (
        <ErroCarregar mensagem={erro ?? "Não foi possível carregar o cockpit."} onRetry={carregar} />
      ) : (
        <>
          {/* KPIs */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "MRR", value: brl(c.mrr), icon: TrendingUp, cls: "text-accent" },
              { label: "Receita (mês atual)", value: brl(receitaMes), icon: DollarSign, cls: "text-success" },
              { label: "MRR em risco", value: brl(c.inadimplencia.mrrEmRisco), icon: AlertTriangle, cls: c.inadimplencia.mrrEmRisco > 0 ? "text-destructive" : "text-muted-foreground" },
              { label: "Trials ativos", value: String(c.trials.ativos), icon: Clock, cls: "text-warning" },
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

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Receita por mês */}
            <div className="rounded-2xl border border-noir-line bg-noir-surface p-5">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-4">Receita realizada (12 meses)</p>
              {c.receitaMensal.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Sem pagamentos confirmados ainda.</p>
              ) : (
                <div className="space-y-2.5">
                  {c.receitaMensal.map((m) => (
                    <div key={m.mes} className="flex items-center gap-3">
                      <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">{m.mes}</span>
                      <div className="h-5 flex-1 overflow-hidden rounded bg-noir-surface-raised">
                        <div className="h-full rounded bg-accent/70" style={{ width: `${Math.max(2, (m.valor / maxReceita) * 100)}%` }} />
                      </div>
                      <span className="w-28 shrink-0 text-right text-xs font-medium text-foreground">{brl(m.valor)}</span>
                    </div>
                  ))}
                </div>
              )}
              {c.mrrPorPlano.length > 0 && (
                <div className="mt-5 border-t border-noir-line pt-4">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-2">MRR por plano (ativas)</p>
                  <div className="space-y-1.5 text-sm">
                    {c.mrrPorPlano.map((p) => (
                      <div key={p.plano} className="flex items-center justify-between">
                        <span className="capitalize text-foreground">{p.plano} <span className="text-xs text-muted-foreground">({p.quantidade})</span></span>
                        <span className="font-medium text-foreground">{brl(p.valor)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Funil */}
            <div className="rounded-2xl border border-noir-line bg-noir-surface p-5">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-4">Funil — convite → pago</p>
              <div className="space-y-3">
                {[
                  { label: "Convidados", value: c.funil.convidados, icon: UserPlus },
                  { label: "Ativaram conta", value: c.funil.ativaram, icon: UserPlus },
                  { label: "Em trial", value: c.funil.emTrial, icon: Clock },
                  { label: "Converteram (pagantes)", value: c.funil.convertidos, icon: DollarSign },
                ].map((etapa, i, arr) => {
                  const base = Math.max(1, arr[0].value)
                  return (
                    <div key={etapa.label} className="flex items-center gap-3">
                      <etapa.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="w-40 shrink-0 text-sm text-foreground">{etapa.label}</span>
                      <div className="h-5 flex-1 overflow-hidden rounded bg-noir-surface-raised">
                        <div className="h-full rounded bg-primary/60" style={{ width: `${Math.max(2, (etapa.value / base) * 100)}%` }} />
                      </div>
                      <span className="w-8 shrink-0 text-right text-sm font-semibold text-foreground">{etapa.value}</span>
                    </div>
                  )
                })}
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground/70">Funil aproximado: convidados/ativaram vêm dos convites; conversão = assinatura ativa com ≥1 pagamento confirmado.</p>
            </div>
          </div>

          {/* Filas acionáveis */}
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Inadimplência */}
            <FilaCard
              titulo="MRR em risco (inadimplentes)"
              icon={AlertTriangle}
              iconCls="text-destructive"
              vazio="Nenhuma assinatura suspensa."
              itens={c.inadimplencia.itens}
              render={(it: Inadimplente) => (
                <Link key={it.assinaturaId} href="/admin/financeiro" className="block rounded-lg px-3 py-2 hover:bg-noir-surface-raised">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm text-foreground">{it.medicoNome ?? "—"}</span>
                    <span className="shrink-0 text-xs font-medium text-destructive">{brl(it.valorMensal)}</span>
                  </div>
                  <span className="text-[11px] text-muted-foreground">suspensa desde {dataCurta(it.desde)}</span>
                </Link>
              )}
            />

            {/* Trials expirando */}
            <FilaCard
              titulo="Trials vencendo (≤7 dias)"
              icon={Clock}
              iconCls="text-warning"
              vazio="Nenhum trial vencendo."
              itens={c.trials.expirando}
              render={(it: TrialItem) => (
                <Link key={it.assinaturaId} href="/admin/financeiro" className="block rounded-lg px-3 py-2 hover:bg-noir-surface-raised">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm text-foreground">{it.medicoNome ?? "—"}</span>
                    <span className="shrink-0 text-xs text-warning">{dataCurta(it.trialAte)}</span>
                  </div>
                </Link>
              )}
            />

            {/* Cobráveis sem Asaas */}
            <FilaCard
              titulo="Cobráveis sem Asaas"
              icon={CreditCard}
              iconCls="text-primary"
              vazio="Todos os cobráveis já têm cobrança."
              itens={c.cobraveisSemAsaas}
              render={(it: Cobravel) => (
                <Link key={it.assinaturaId} href="/admin/financeiro" className="block rounded-lg px-3 py-2 hover:bg-noir-surface-raised">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm text-foreground">{it.medicoNome ?? "—"}</span>
                    <span className="shrink-0 text-xs font-medium text-foreground">{brl(it.valorMensal)}</span>
                  </div>
                  <span className="text-[11px] text-muted-foreground">ativar cobrança no Financeiro →</span>
                </Link>
              )}
            />
          </div>
        </>
      )}
    </div>
  )
}

function FilaCard<T>({
  titulo, icon: Icon, iconCls, vazio, itens, render,
}: {
  titulo: string
  icon: typeof AlertTriangle
  iconCls: string
  vazio: string
  itens: T[]
  render: (it: T) => ReactNode
}) {
  return (
    <div className="rounded-2xl border border-noir-line bg-noir-surface p-4">
      <div className="mb-2 flex items-center gap-2 px-1">
        <Icon className={`h-4 w-4 ${iconCls}`} />
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{titulo}</p>
        <span className="ml-auto rounded-md bg-noir-surface-raised px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{itens.length}</span>
      </div>
      {itens.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">{vazio}</p>
      ) : (
        <div className="divide-y divide-noir-line/60">{itens.map(render)}</div>
      )}
    </div>
  )
}
