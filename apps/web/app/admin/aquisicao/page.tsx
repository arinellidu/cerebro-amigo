"use client"

import { type ReactNode, useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import {
  Magnet, RefreshCw, Loader2, Stethoscope, FileDown, QrCode, UserPlus, CheckCircle2,
  TrendingUp, AlertTriangle, ClipboardList, ScanLine,
} from "lucide-react"
import { ErroCarregar } from "@/components/admin/erro-carregar"

interface EscalaFunil { scale: string; testStarted: number; testCompleted: number; reportGenerated: number }
interface FunnelMetrics {
  eventos: Record<string, number>
  escalas: EscalaFunil[]
  testCompletedPorMes: { mes: string; n: number }[]
  geradoEm: string
}
interface MedicoCheckup { medicoNome: string | null; status: string; rid: string | null; criadoEm: string }
interface Clinico {
  porOrigem: { origem: string; n: number }[]
  checkup: {
    total: number; ativos: number; emTrial: number; ridsAtribuidos: number
    porStatus: { status: string; n: number }[]
    cadastrosPorMes: { mes: string; n: number }[]
    recentes: MedicoCheckup[]
  }
}
interface Aquisicao {
  clinico: Clinico
  checkup: FunnelMetrics | null
  checkupErro: string | null
  metricaNorte: { medicosCheckup: number; medicosAtivos: number; testCompleted: number; medicosPor1000: number | null }
  site: string
}

const SITE = "https://www.cerebroamigo.com.br"

// Rótulos das escalas (landing → instrumento). Itens validados; ver apps/checkup.
const ESCALA_LABEL: Record<string, string> = {
  phq9: "Depressão (PHQ-9)",
  gad7: "Ansiedade (GAD-7)",
  asrs18: "TDAH (ASRS-18)",
  audit: "Álcool (AUDIT)",
  mdq: "Bipolaridade (MDQ)",
  fagerstrom: "Tabagismo (Fagerström)",
  msi_bpd: "Borderline (MSI-BPD)",
  assist: "Drogas (ASSIST)",
}
const ORIGEM_LABEL: Record<string, string> = {
  checkup: "Check-up Mental", self: "Auto-cadastro", admin: "Onboarding admin", legado: "Legado",
}
const STATUS_LABEL: Record<string, string> = {
  ativa: "Ativa", trial: "Trial", suspensa: "Suspensa", cancelada: "Cancelada", sem_assinatura: "Sem assinatura",
}
const num = (n: number) => (n ?? 0).toLocaleString("pt-BR")
const dataCurta = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—")

// Diagnóstico do erro do Check-up (`checkupErro` vem do BFF /api/admin/aquisicao).
// Cada status aponta para a causa REAL — token/url só é a pista quando é config/401/503.
// Um 500 é erro interno do Check-up (ex.: falha de auth no Postgres do checkup_app) e
// NÃO se resolve mexendo em CHECKUP_METRICS_TOKEN — o log está no CloudWatch.
function dicaCheckupErro(erro: string): ReactNode {
  if (/não configurado/i.test(erro))
    return <>Defina <code className="font-mono text-xs">CHECKUP_METRICS_TOKEN</code> no BFF (web).</>
  if (/\b401\b/.test(erro))
    return <>Token não confere — <code className="font-mono text-xs">CHECKUP_METRICS_TOKEN</code> do BFF ≠ do Check-up.</>
  if (/\b503\b/.test(erro))
    return <>Check-up fail-closed: sem token ou banco indisponível no próprio Check-up.</>
  if (/\b500\b/.test(erro))
    return <>Erro interno do Check-up (não é token/URL). Ver o motivo no CloudWatch <code className="font-mono text-xs">/cerebro-amigo/checkup</code> (filtro <code className="font-mono text-xs">funnel-metrics falhou</code>).</>
  if (/inacess/i.test(erro))
    return <>Check-up inacessível — confira <code className="font-mono text-xs">CHECKUP_METRICS_URL</code> / rede / timeout.</>
  return <>Confira <code className="font-mono text-xs">CHECKUP_METRICS_TOKEN</code> / <code className="font-mono text-xs">CHECKUP_METRICS_URL</code> e o CloudWatch do Check-up.</>
}

export default function AquisicaoPage() {
  const [d, setD] = useState<Aquisicao | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null)
    try {
      const r = await fetch("/api/admin/aquisicao")
      if (r.status === 401) { window.location.href = "/login"; return }
      if (!r.ok) { setErro("Não foi possível carregar o cockpit de aquisição."); return }
      setD(await r.json())
    } catch {
      setErro("Erro de conexão ao carregar o cockpit.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const ev = d?.checkup?.eventos
  // Funil de ponta a ponta: tráfego anônimo (paciente) → médico pagante.
  const funil = [
    { label: "Testes iniciados", value: ev?.test_started ?? 0, icon: ClipboardList, lado: "checkup" },
    { label: "Testes concluídos", value: ev?.test_completed ?? 0, icon: CheckCircle2, lado: "checkup" },
    { label: "Relatórios PDF gerados", value: ev?.report_generated ?? 0, icon: FileDown, lado: "checkup" },
    { label: "QR escaneados", value: ev?.qr_scanned ?? 0, icon: ScanLine, lado: "checkup" },
    { label: "Cadastros iniciados", value: ev?.doctor_signup_started ?? 0, icon: QrCode, lado: "checkup" },
    { label: "Médicos cadastrados", value: d?.clinico.checkup.total ?? 0, icon: UserPlus, lado: "clinico" },
    { label: "Médicos ativos", value: d?.clinico.checkup.ativos ?? 0, icon: CheckCircle2, lado: "clinico" },
  ]
  const funilBase = Math.max(1, funil[0].value)
  const maxEscala = Math.max(1, ...(d?.checkup?.escalas ?? []).map((e) => e.testCompleted))
  const norte = d?.metricaNorte.medicosPor1000

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Magnet className="h-5 w-5 text-accent" />
            <p className="font-mono text-xs uppercase tracking-widest text-accent">Aquisição</p>
          </div>
          <h1 className="text-2xl font-semibold text-foreground">Cockpit de Aquisição — Check-up Mental</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Funil do motor de aquisição: triagem pública anônima → médico cadastrado. Métrica norte: médicos por 1.000 testes concluídos.
          </p>
        </div>
        <Button variant="glass" size="sm" onClick={carregar} disabled={loading} className="gap-1.5">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : erro || !d ? (
        <ErroCarregar mensagem={erro ?? "Não foi possível carregar o cockpit."} onRetry={carregar} />
      ) : (
        <>
          {d.checkupErro && (
            <div className="flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Funil do Check-up indisponível ({d.checkupErro}). Mostrando só o lado clínico — {dicaCheckupErro(d.checkupErro)}</span>
            </div>
          )}

          {/* KPIs — métrica norte em destaque */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Médicos por 1.000 testes", value: norte != null ? norte.toFixed(1) : "—", icon: TrendingUp, cls: "text-accent" },
              { label: "Médicos do Check-up", value: num(d.metricaNorte.medicosCheckup), icon: UserPlus, cls: "text-primary" },
              { label: "Médicos ativos", value: num(d.metricaNorte.medicosAtivos), icon: CheckCircle2, cls: "text-success" },
              { label: "Testes concluídos", value: num(d.metricaNorte.testCompleted), icon: ClipboardList, cls: "text-foreground" },
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
            {/* Funil de ponta a ponta */}
            <div className="rounded-2xl border border-noir-line bg-noir-surface p-5">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-4">
                Funil — triagem anônima → médico pagante
              </p>
              <div className="space-y-3">
                {funil.map((etapa) => (
                  <div key={etapa.label} className="flex items-center gap-3">
                    <etapa.icon className={`h-4 w-4 shrink-0 ${etapa.lado === "clinico" ? "text-primary" : "text-muted-foreground"}`} />
                    <span className="w-40 shrink-0 text-sm text-foreground">{etapa.label}</span>
                    <div className="h-5 flex-1 overflow-hidden rounded bg-noir-surface-raised">
                      <div
                        className={`h-full rounded ${etapa.lado === "clinico" ? "bg-primary/60" : "bg-accent/60"}`}
                        style={{ width: `${Math.max(2, (etapa.value / funilBase) * 100)}%` }}
                      />
                    </div>
                    <span className="w-16 shrink-0 text-right text-sm font-semibold text-foreground">{num(etapa.value)}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground/70">
                Azul = lado clínico (gateway); âmbar = Check-up (anônimo). QR/cadastro são keyed por <code className="font-mono">rid</code> (8 chars), sem PII.
              </p>
            </div>

            {/* Testes concluídos por escala (qual landing converte) */}
            <div className="rounded-2xl border border-noir-line bg-noir-surface p-5">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-4">
                Testes concluídos por escala (landing SEO)
              </p>
              {!d.checkup || d.checkup.escalas.every((e) => e.testCompleted === 0) ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Sem testes concluídos no período.</p>
              ) : (
                <div className="space-y-2.5">
                  {[...d.checkup.escalas].sort((a, b) => b.testCompleted - a.testCompleted).map((e) => (
                    <div key={e.scale} className="flex items-center gap-3">
                      <span className="w-40 shrink-0 truncate text-xs text-foreground">{ESCALA_LABEL[e.scale] ?? e.scale}</span>
                      <div className="h-5 flex-1 overflow-hidden rounded bg-noir-surface-raised">
                        <div className="h-full rounded bg-accent/70" style={{ width: `${Math.max(2, (e.testCompleted / maxEscala) * 100)}%` }} />
                      </div>
                      <span className="w-12 shrink-0 text-right text-xs font-medium text-foreground">{num(e.testCompleted)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Médicos por origem */}
            <div className="rounded-2xl border border-noir-line bg-noir-surface p-5">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-4">Médicos por origem</p>
              <div className="space-y-1.5 text-sm">
                {d.clinico.porOrigem.map((o) => (
                  <div key={o.origem} className="flex items-center justify-between">
                    <span className="text-foreground">{ORIGEM_LABEL[o.origem] ?? o.origem}</span>
                    <span className="font-medium text-foreground">{num(o.n)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Médicos do Check-up por status */}
            <div className="rounded-2xl border border-noir-line bg-noir-surface p-5">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-4">Check-up por status de assinatura</p>
              {d.clinico.checkup.porStatus.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">Nenhum médico vindo do Check-up ainda.</p>
              ) : (
                <div className="space-y-1.5 text-sm">
                  {d.clinico.checkup.porStatus.map((s) => (
                    <div key={s.status} className="flex items-center justify-between">
                      <span className="text-foreground">{STATUS_LABEL[s.status] ?? s.status}</span>
                      <span className="font-medium text-foreground">{num(s.n)}</span>
                    </div>
                  ))}
                  <div className="mt-2 border-t border-noir-line pt-2 text-xs text-muted-foreground">
                    {num(d.clinico.checkup.ridsAtribuidos)} QR distintos atribuídos (<code className="font-mono">rid</code>)
                  </div>
                </div>
              )}
            </div>

            {/* Cadastros do Check-up por mês */}
            <div className="rounded-2xl border border-noir-line bg-noir-surface p-5">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-4">Cadastros do Check-up (12 meses)</p>
              {d.clinico.checkup.cadastrosPorMes.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">Sem cadastros atribuídos ainda.</p>
              ) : (
                <div className="space-y-1.5">
                  {(() => {
                    const max = Math.max(1, ...d.clinico.checkup.cadastrosPorMes.map((m) => m.n))
                    return d.clinico.checkup.cadastrosPorMes.map((m) => (
                      <div key={m.mes} className="flex items-center gap-2">
                        <span className="w-14 shrink-0 font-mono text-[11px] text-muted-foreground">{m.mes}</span>
                        <div className="h-4 flex-1 overflow-hidden rounded bg-noir-surface-raised">
                          <div className="h-full rounded bg-primary/60" style={{ width: `${Math.max(3, (m.n / max) * 100)}%` }} />
                        </div>
                        <span className="w-8 shrink-0 text-right text-xs font-medium text-foreground">{num(m.n)}</span>
                      </div>
                    ))
                  })()}
                </div>
              )}
            </div>
          </div>

          {/* Drill-down: médicos recentes do Check-up */}
          <FilaCard
            titulo="Últimos médicos vindos do Check-up"
            icon={Stethoscope}
            vazio="Nenhum médico atribuído ao Check-up ainda."
            itens={d.clinico.checkup.recentes}
            render={(m: MedicoCheckup) => (
              <div key={`${m.rid}-${m.criadoEm}`} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="truncate text-sm text-foreground">{m.medicoNome ?? "—"}</span>
                <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                  <span className="rounded bg-noir-surface-raised px-1.5 py-0.5 font-medium">{STATUS_LABEL[m.status] ?? m.status}</span>
                  <span className="font-mono">{m.rid ?? "—"}</span>
                  <span>{dataCurta(m.criadoEm)}</span>
                </span>
              </div>
            )}
          />

          {/* Assinatura: marca + site oficial */}
          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-noir-line pt-4 text-xs text-muted-foreground">
            <span>Cérebro Amigo by Arinelli · Check-up Mental — motor de aquisição</span>
            <Link href={SITE} target="_blank" rel="noopener noreferrer" className="font-medium text-accent hover:underline">
              www.cerebroamigo.com.br
            </Link>
          </footer>
        </>
      )}
    </div>
  )
}

function FilaCard<T>({
  titulo, icon: Icon, vazio, itens, render,
}: {
  titulo: string
  icon: typeof Stethoscope
  vazio: string
  itens: T[]
  render: (it: T) => ReactNode
}) {
  return (
    <div className="rounded-2xl border border-noir-line bg-noir-surface p-4">
      <div className="mb-2 flex items-center gap-2 px-1">
        <Icon className="h-4 w-4 text-primary" />
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
