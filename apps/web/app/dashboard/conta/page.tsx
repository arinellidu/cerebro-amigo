"use client"

// ADR-066 — Portal do Psiquiatra: hub "Minha conta". NÃO duplica auth nem o
// self-checkout pesado (mora em /dashboard/financeiro); aqui consolida em abas o
// que já existe (plano, pagamentos+2ª via, dados pessoais, métricas) e abre espaço
// para os greenfields (documentos = Fase 3; segurança/LGPD/foto = Fase 4).

import { useEffect, useState } from "react"
import Link from "next/link"
import { Header } from "@/components/header"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { cpfMask } from "@/lib/cpf"
import { DocumentosTab } from "@/components/conta/documentos-tab"
import { SegurancaTab } from "@/components/conta/seguranca-tab"
import { PrivacidadeTab } from "@/components/conta/privacidade-tab"
import { FotoPerfil } from "@/components/conta/foto-perfil"
import { planoNome } from "@/lib/feature-gate"
import {
  Loader2, CreditCard, ExternalLink, CheckCircle2, FolderLock, ShieldCheck,
  ScrollText, BarChart3, IdCard, Sparkles, ArrowRight,
} from "lucide-react"

// Rótulos das features de IA por camada de plano (espelha PlanCatalog/feature-gate).
const FEATURE_LABEL: Record<string, string> = {
  briefing_ia: "Briefing pré-consulta com IA",
  ia_insights: "Insights dos 5 agentes",
  rag: "Busca semântica (RAG)",
  escriba: "Escriba (transcrição + rascunho)",
}

const STATUS: Record<string, { label: string; cls: string }> = {
  pendente: { label: "Pendente", cls: "bg-warning/15 text-warning border-warning/30" },
  trial: { label: "Em teste", cls: "bg-warning/15 text-warning border-warning/30" },
  ativa: { label: "Ativa", cls: "bg-success/15 text-success border-success/30" },
  suspensa: { label: "Suspensa", cls: "bg-destructive/15 text-destructive border-destructive/30" },
  cancelada: { label: "Cancelada", cls: "bg-muted text-muted-foreground border-border" },
}

const brl = (n: number) => `R$ ${(n ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`

interface Me {
  nome: string; email: string; especialidade: string | null; crm: string | null
  plano?: string | null; features?: string[]; assinaturaStatus?: string | null
  diasRestantes?: number | null; readOnly?: boolean
}
interface Pagamento { valor: number; referencia: string | null; metodo: string | null; pagoEm: string | null }
interface Assinatura {
  plano: string; valorMensal: number; status: string
  cobrancaAtiva: boolean; invoiceUrl: string | null; pagamentos: Pagamento[]
}
interface Config { crm?: string | null; crmUf?: string | null; cpf?: string | null }
interface Roi {
  pacientesAtivos?: number; pacientesInativos?: number
  consultasRealizadas30d?: number; consultasAgendadas?: number; crises30d?: number
}

export default function MinhaContaPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [a, setA] = useState<Assinatura | null>(null)
  const [cfg, setCfg] = useState<Config | null>(null)
  const [roi, setRoi] = useState<Roi | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const j = (r: Response) => (r.ok ? r.json() : null)
    Promise.all([
      fetch("/api/me").then(j).catch(() => null),
      fetch("/api/minha-assinatura").then(j).catch(() => null),
      fetch("/api/configuracoes").then(j).catch(() => null),
      fetch("/api/roi/resumo").then(j).catch(() => null),
    ]).then(([m, ass, c, r]) => {
      setMe(m); setA(ass); setCfg(c); setRoi(r)
    }).finally(() => setLoading(false))
  }, [])

  const st = a ? (STATUS[a.status] ?? { label: a.status, cls: "bg-muted text-muted-foreground border-border" }) : null

  return (
    <div className="p-8 space-y-6">
      <Header title="Minha conta" subtitle="Plano, pagamentos, documentos e dados pessoais" />

      {loading ? (
        <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <Tabs defaultValue="plano" className="space-y-6">
          <TabsList className="flex flex-wrap h-auto justify-start gap-1">
            <TabsTrigger value="plano" className="gap-1.5"><Sparkles className="h-3.5 w-3.5" /> Plano ativo</TabsTrigger>
            <TabsTrigger value="pagamentos" className="gap-1.5"><CreditCard className="h-3.5 w-3.5" /> Pagamentos & 2ª via</TabsTrigger>
            <TabsTrigger value="documentos" className="gap-1.5"><FolderLock className="h-3.5 w-3.5" /> Documentos</TabsTrigger>
            <TabsTrigger value="dados" className="gap-1.5"><IdCard className="h-3.5 w-3.5" /> Dados pessoais</TabsTrigger>
            <TabsTrigger value="metricas" className="gap-1.5"><BarChart3 className="h-3.5 w-3.5" /> Métricas</TabsTrigger>
            <TabsTrigger value="seguranca" className="gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Segurança</TabsTrigger>
            <TabsTrigger value="privacidade" className="gap-1.5"><ScrollText className="h-3.5 w-3.5" /> Privacidade</TabsTrigger>
          </TabsList>

          {/* ── PLANO ATIVO ─────────────────────────────────────────────── */}
          <TabsContent value="plano" className="space-y-4">
            <Card>
              <CardContent className="p-6 space-y-5">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">Plano</p>
                    <p className="text-lg font-semibold text-foreground">{planoNome(a?.plano ?? me?.plano)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">Valor mensal</p>
                    <p className="text-lg font-semibold text-foreground">{a ? brl(a.valorMensal) : "—"}</p>
                  </div>
                  {typeof me?.diasRestantes === "number" && (
                    <div>
                      <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">Dias restantes</p>
                      <p className="text-lg font-semibold text-foreground">{me.diasRestantes}</p>
                    </div>
                  )}
                  {st && <Badge className={`border font-mono text-[10px] uppercase ${st.cls}`}>{st.label}</Badge>}
                </div>

                <div>
                  <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">Recursos de IA incluídos</p>
                  {me?.features && me.features.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {me.features.map((f) => (
                        <span key={f} className="inline-flex items-center gap-1.5 rounded-lg border border-success/30 bg-success/10 px-2.5 py-1 text-xs text-success">
                          <CheckCircle2 className="h-3.5 w-3.5" /> {FEATURE_LABEL[f] ?? f}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Nenhum recurso de IA no plano atual. Faça upgrade para liberar.</p>
                  )}
                </div>

                <Link href="/dashboard/financeiro" className="inline-block">
                  <Button variant="coral" className="gap-2">
                    Gerenciar plano / fazer upgrade <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── PAGAMENTOS & 2ª VIA ─────────────────────────────────────── */}
          <TabsContent value="pagamentos" className="space-y-4">
            <Card>
              <CardContent className="p-6 space-y-4">
                {a?.invoiceUrl ? (
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <p className="text-sm text-muted-foreground">Fatura em aberto. Pague ou baixe a segunda via:</p>
                    <a href={a.invoiceUrl} target="_blank" rel="noreferrer">
                      <Button variant="coral" className="gap-2">
                        <CreditCard className="h-4 w-4" /> Pagar / 2ª via <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                    </a>
                  </div>
                ) : a?.cobrancaAtiva ? (
                  <p className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="h-4 w-4" /> Cobrança em dia — sem fatura em aberto.</p>
                ) : (
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <p className="text-sm text-muted-foreground">Nenhuma cobrança ativa.</p>
                    <Link href="/dashboard/financeiro"><Button variant="coral" className="gap-2">Ativar assinatura <ArrowRight className="h-3.5 w-3.5" /></Button></Link>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">O link de pagamento já é a 2ª via — atualizado direto no Asaas a cada visita. NFS-e e recibos ficam na aba Documentos.</p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-0">
                <div className="px-6 py-4 border-b border-border"><h2 className="text-sm font-semibold text-foreground">Histórico de pagamentos</h2></div>
                {!a || a.pagamentos.length === 0 ? (
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
          </TabsContent>

          {/* ── DOCUMENTOS ──────────────────────────────────────────────── */}
          <TabsContent value="documentos">
            <DocumentosTab />
          </TabsContent>

          {/* ── DADOS PESSOAIS ──────────────────────────────────────────── */}
          <TabsContent value="dados" className="space-y-4">
            <Card>
              <CardContent className="p-6 space-y-5">
                <FotoPerfil />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Nome" value={me?.nome} />
                  <Field label="E-mail" value={me?.email} />
                  <Field label="Especialidade" value={me?.especialidade ?? "Psiquiatria"} />
                  <Field label="CRM" value={cfg?.crm || me?.crm ? `${cfg?.crm || me?.crm}${cfg?.crmUf ? " / " + cfg.crmUf : ""}` : "—"} />
                  <Field label="CPF" value={cfg?.cpf ? cpfMask(cfg.cpf) : "—"} />
                </div>
                <div className="flex items-center gap-3">
                  <Link href="/dashboard/configuracoes"><Button variant="outline" className="gap-2">Editar dados profissionais <ArrowRight className="h-3.5 w-3.5" /></Button></Link>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── MÉTRICAS ────────────────────────────────────────────────── */}
          <TabsContent value="metricas" className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Pacientes ativos" value={roi?.pacientesAtivos} />
              <Metric label="Consultas (30d)" value={roi?.consultasRealizadas30d} />
              <Metric label="Agendadas" value={roi?.consultasAgendadas} />
              <Metric label="Crises (30d)" value={roi?.crises30d} />
            </div>
            <Link href="/dashboard/roi" className="inline-block">
              <Button variant="outline" className="gap-2">Ver ROI completo + blindagem <ArrowRight className="h-3.5 w-3.5" /></Button>
            </Link>
          </TabsContent>

          {/* ── SEGURANÇA ───────────────────────────────────────────────── */}
          <TabsContent value="seguranca">
            <SegurancaTab />
          </TabsContent>

          {/* ── PRIVACIDADE / LGPD ──────────────────────────────────────── */}
          <TabsContent value="privacidade">
            <PrivacidadeTab />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
      <p className="text-sm font-medium text-foreground break-words">{value || "—"}</p>
    </div>
  )
}

function Metric({ label, value }: { label: string; value?: number }) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
        <p className="text-2xl font-semibold text-foreground">{typeof value === "number" ? value : "—"}</p>
      </CardContent>
    </Card>
  )
}
