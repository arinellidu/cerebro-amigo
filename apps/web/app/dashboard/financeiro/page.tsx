"use client"

// Portal do cliente (Fluxo A, ADR-034): o médico vê o próprio plano, status,
// link p/ pagar (invoiceUrl do Asaas) e o histórico. (Fluxo B médico→paciente
// segue estacionado — esta página agora é a assinatura DO médico na plataforma.)

import { useEffect, useState } from "react"
import { Header } from "@/components/header"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Loader2, CreditCard, ExternalLink, CheckCircle2 } from "lucide-react"
import { PagueViaPix, MANUAL_PIX_ATIVO } from "@/components/assinatura/pague-via-pix"
import { planoNome } from "@/lib/feature-gate"

interface Pagamento { valor: number; referencia: string | null; metodo: string | null; pagoEm: string | null }
interface Assinatura {
  plano: string
  valorMensal: number
  moeda: string
  status: string
  trialAte: string | null
  cobrancaAtiva: boolean
  invoiceUrl: string | null
  pagamentos: Pagamento[]
}

const STATUS: Record<string, { label: string; cls: string }> = {
  pendente: { label: "Pendente", cls: "bg-warning/15 text-warning border-warning/30" },
  trial: { label: "Em teste", cls: "bg-warning/15 text-warning border-warning/30" },
  ativa: { label: "Ativa", cls: "bg-success/15 text-success border-success/30" },
  suspensa: { label: "Suspensa", cls: "bg-destructive/15 text-destructive border-destructive/30" },
  cancelada: { label: "Cancelada", cls: "bg-muted text-muted-foreground border-border" },
}

const brl = (n: number) => `R$ ${(n ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`

export default function MinhaAssinaturaPage() {
  const [a, setA] = useState<Assinatura | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/minha-assinatura")
      .then(async (r) => {
        if (r.status === 404) { setErro("Você ainda não tem uma assinatura cadastrada. Fale com a administração."); return null }
        if (!r.ok) { setErro("Não foi possível carregar sua assinatura."); return null }
        return r.json()
      })
      .then((d) => { if (d) setA(d) })
      .catch(() => setErro("Erro de conexão."))
      .finally(() => setLoading(false))
  }, [])

  const [planoSel, setPlanoSel] = useState("pro")
  const [criando, setCriando] = useState(false)
  const [erroCheckout, setErroCheckout] = useState<string | null>(null)

  // 3 planos self-checkout mensais (ADR-059), fatiados pela camada de IA. Os valores
  // são só exibição — o gateway (PlanCatalog) é a fonte da verdade do preço cobrado.
  const PLANOS = [
    { key: "starter", nome: "Essencial", valor: 397, desc: "Núcleo clínico + briefing pré-consulta com IA" },
    { key: "pro", nome: "Pro", valor: 597, desc: "+ Insights dos agentes + busca semântica (RAG)" },
    { key: "master", nome: "Master", valor: 997, desc: "Tudo da IA + escriba (transcrição + rascunho)" },
  ]

  // Self-checkout (ADR-055 Fase C): cria a cobrança da própria assinatura e abre o
  // link de pagamento do Asaas. Funciona com Asaas configurado (sandbox/prod).
  async function ativarCobranca() {
    setCriando(true)
    setErroCheckout(null)
    try {
      const r = await fetch("/api/minha-assinatura/cobranca", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plano: planoSel }),
      })
      const d = await r.json().catch(() => null)
      if (r.ok && d?.subscriptionId) {
        // Assinatura criada. Em geral vem invoiceUrl; em casos raros o link demora
        // (a 1ª fatura ainda não existe no Asaas) — marca ativa e orienta a atualizar.
        setA((prev) => (prev ? { ...prev, invoiceUrl: d.invoiceUrl ?? prev.invoiceUrl, cobrancaAtiva: true } : prev))
        if (d.invoiceUrl) window.open(d.invoiceUrl, "_blank", "noreferrer")
        else setErroCheckout("Assinatura criada. O link de pagamento aparece em instantes — atualize a página.")
      } else if (d?.error === "cpf_obrigatorio") {
        setErroCheckout("Preencha seu CPF no perfil antes de ativar a cobrança.")
      } else if (d?.error === "asaas_nao_configurado") {
        setErroCheckout("Pagamento indisponível no momento. Tente novamente em instantes.")
      } else {
        setErroCheckout(d?.detalhe ?? "Não foi possível ativar a cobrança agora. Tente novamente.")
      }
    } catch {
      setErroCheckout("Erro de conexão. Tente novamente.")
    } finally {
      setCriando(false)
    }
  }

  const st = a ? (STATUS[a.status] ?? { label: a.status, cls: "bg-muted text-muted-foreground border-border" }) : null

  return (
    <div className="p-8 space-y-6">
      <Header title="Minha assinatura" subtitle="Seu plano na plataforma e pagamentos" />

      {loading ? (
        <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : erro ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">{erro}</CardContent></Card>
      ) : a ? (
        <>
          <Card>
            <CardContent className="p-6 space-y-5">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">Plano</p>
                  <p className="text-lg font-semibold text-foreground">{planoNome(a.plano)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">Valor mensal</p>
                  <p className="text-lg font-semibold text-foreground">{brl(a.valorMensal)}</p>
                </div>
                {st && <Badge className={`border font-mono text-[10px] uppercase ${st.cls}`}>{st.label}</Badge>}
              </div>

              {a.invoiceUrl ? (
                <a href={a.invoiceUrl} target="_blank" rel="noreferrer" className="inline-block">
                  <Button variant="coral" className="gap-2">
                    <CreditCard className="h-4 w-4" /> Pagar agora <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                </a>
              ) : a.cobrancaAtiva ? (
                // erroCheckout aqui = "link aparece em instantes" (invoiceUrl null após checkout).
                erroCheckout
                  ? <p role="alert" className="text-sm text-warning">{erroCheckout}</p>
                  : <p className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="h-4 w-4" /> Cobrança em dia — sem fatura em aberto.</p>
              ) : (
                <div className="space-y-4">
                  {/* Modo bootstrap (sem Asaas): Pix manual. Senão, self-checkout Asaas. */}
                  <PagueViaPix valor={a.valorMensal} />
                  {!MANUAL_PIX_ATIVO && (
                  <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">Escolha um plano e ative sua assinatura:</p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {PLANOS.map((pl) => (
                      <button
                        key={pl.key}
                        type="button"
                        onClick={() => setPlanoSel(pl.key)}
                        className={`rounded-xl border p-3 text-left transition ${planoSel === pl.key ? "border-primary bg-primary/5" : "border-border/60 hover:border-border"}`}
                      >
                        <p className="text-sm font-semibold text-foreground">{pl.nome}</p>
                        <p className="text-xs text-muted-foreground">{pl.desc}</p>
                        <p className="mt-1 text-sm font-semibold text-foreground">
                          {brl(pl.valor)}<span className="text-xs font-normal text-muted-foreground">/mês</span>
                        </p>
                      </button>
                    ))}
                  </div>
                  <Button variant="coral" className="gap-2" disabled={criando} onClick={ativarCobranca}>
                    {criando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                    Ativar e pagar <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                  {erroCheckout && <p role="alert" className="text-xs text-coral">{erroCheckout}</p>}
                  <p className="text-xs text-muted-foreground">
                    Clínicas e redes com vários médicos:{" "}
                    <a href="/sobre#contato" className="underline underline-offset-2 hover:text-foreground">fale com a equipe</a>.
                  </p>
                  </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <div className="px-6 py-4 border-b border-border">
                <h2 className="text-sm font-semibold text-foreground">Histórico de pagamentos</h2>
              </div>
              {a.pagamentos.length === 0 ? (
                <p className="px-6 py-8 text-center text-sm text-muted-foreground">Nenhum pagamento ainda.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                      <th className="px-6 py-2.5 font-medium">Referência</th>
                      <th className="px-6 py-2.5 font-medium">Valor</th>
                      <th className="px-6 py-2.5 font-medium">Método</th>
                      <th className="px-6 py-2.5 font-medium">Pago em</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {a.pagamentos.map((p, i) => (
                      <tr key={i}>
                        <td className="px-6 py-2.5 text-foreground">{p.referencia ?? "—"}</td>
                        <td className="px-6 py-2.5 text-foreground">{brl(p.valor)}</td>
                        <td className="px-6 py-2.5 text-muted-foreground capitalize">{p.metodo ?? "—"}</td>
                        <td className="px-6 py-2.5 text-muted-foreground">{p.pagoEm ? new Date(p.pagoEm).toLocaleDateString("pt-BR") : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  )
}
