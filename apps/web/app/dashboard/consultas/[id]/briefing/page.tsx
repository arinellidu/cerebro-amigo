"use client"

import { use, useEffect, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Minus,
  ShieldCheck,
  Clock,
  Zap,
  Loader2,
  Sparkles,
  Check,
  Video,
  Link2,
  Mic,
} from "lucide-react"
import { useMe } from "@/lib/use-me"
import { iniciais } from "@/lib/iniciais"
import { FEATURE, temFeature, readFeatureGate } from "@/lib/feature-gate"
import { UpsellFeature } from "@/components/assinatura/upsell-feature"
import { useFeatureUpsell } from "@/components/assinatura/feature-upsell"

interface Consulta {
  id: string
  pacienteId: string
  pacienteNome: string | null
  iniciaEm: string
  modalidade: string
  status: string
  notas: string | null
}
interface PontoHumor {
  data: string
  humor: number | null
  ansiedade: number | null
}
interface Adesao {
  medicamento: string
  tomadas: number
  faltas: number
  total: number
  percentualAdesao: number | null
}
interface Resumo {
  id: string
  titulo: string
  conteudo: string
  severidade: string
  criadoEm: string
}

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
}
const STATUS_ROTULO: Record<string, string> = {
  agendada: "Agendada",
  confirmada: "Confirmada",
  realizada: "Realizada",
  cancelada: "Cancelada",
}

function Sparkline({ values }: { values: number[] }) {
  const w = 200, h = 48, pad = 4, min = 1, max = 10
  const pts = values
    .map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (w - pad * 2)
      const y = h - pad - ((v - min) / (max - min)) * (h - pad * 2)
      return `${x},${y}`
    })
    .join(" ")
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-12">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" className="text-primary" />
      {values.map((v, i) => {
        const x = pad + (i / (values.length - 1)) * (w - pad * 2)
        const y = h - pad - ((v - min) / (max - min)) * (h - pad * 2)
        return <circle key={i} cx={x} cy={y} r="2.5" className="fill-primary" />
      })}
    </svg>
  )
}

export default function BriefingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const me = useMe()
  const { showUpsell } = useFeatureUpsell()
  // Feature gate (ADR-059): briefing IA está em todos os planos pagos; só plano nulo/
  // legado é bloqueado. Trava proativa (me.features) + reativa (402 ao gerar).
  const [briefingBloqueado, setBriefingBloqueado] = useState(false)
  const semBriefing = (me?.features != null && !temFeature(me.features, FEATURE.briefingIa)) || briefingBloqueado
  const [consulta, setConsulta] = useState<Consulta | null>(null)
  const [humor, setHumor] = useState<PontoHumor[]>([])
  const [adesao, setAdesao] = useState<Adesao[]>([])
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(false)
  const [gerando, setGerando] = useState(false)
  const [erroResumo, setErroResumo] = useState<string | null>(null)
  const [notas, setNotas] = useState("")
  const [salvandoDesfecho, setSalvandoDesfecho] = useState(false)
  const [desfechoSalvo, setDesfechoSalvo] = useState(false)
  const [erroDesfecho, setErroDesfecho] = useState<string | null>(null)
  const [linkCopiado, setLinkCopiado] = useState(false)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const c = await fetch(`/api/consultas/${id}`).then((r) => (r.ok ? r.json() : Promise.reject()))
        if (!vivo) return
        setConsulta(c)
        setNotas(c.notas ?? "")
        const pid = c.pacienteId
        const [h, a, res] = await Promise.all([
          fetch(`/api/pacientes/${pid}/humor?dias=14`).then((r) => (r.ok ? r.json() : [])),
          fetch(`/api/pacientes/${pid}/adesao`).then((r) => (r.ok ? r.json() : [])),
          fetch(`/api/pacientes/${pid}/resumo-pre-consulta`).then((r) => (r.ok ? r.json() : { ultimo: null })),
        ])
        if (!vivo) return
        setHumor(Array.isArray(h) ? h : [])
        setAdesao(Array.isArray(a) ? a : [])
        setResumo(res?.ultimo ?? null)
      } catch {
        if (vivo) setErro(true)
      } finally {
        if (vivo) setLoading(false)
      }
    })()
    return () => {
      vivo = false
    }
  }, [id])

  async function gerarResumo() {
    if (!consulta) return
    setGerando(true)
    setErroResumo(null)
    try {
      const r = await fetch(`/api/pacientes/${consulta.pacienteId}/resumo-pre-consulta`, { method: "POST" })
      const gate = await readFeatureGate(r)
      if (gate) { setBriefingBloqueado(true); showUpsell(gate.feature); return }
      if (!r.ok) {
        setErroResumo("Não foi possível gerar a síntese pré-consulta agora. Tente novamente em instantes.")
        return
      }
      const data = await r.json().catch(() => null)
      setResumo(data?.resumo ?? data?.ultimo ?? null)
    } catch {
      setErroResumo("Não foi possível gerar a síntese pré-consulta agora. Tente novamente em instantes.")
    } finally {
      setGerando(false)
    }
  }

  async function salvarDesfecho() {
    setSalvandoDesfecho(true)
    setDesfechoSalvo(false)
    setErroDesfecho(null)
    try {
      const r = await fetch(`/api/consultas/${id}/desfecho`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notas }),
      })
      if (r.ok) {
        setDesfechoSalvo(true)
        setConsulta((c) => (c ? { ...c, status: "realizada" } : c))
        setTimeout(() => setDesfechoSalvo(false), 2500)
      } else {
        setErroDesfecho("Não foi possível registrar o desfecho da consulta. Tente novamente.")
      }
    } catch {
      setErroDesfecho("Não foi possível registrar o desfecho da consulta. Tente novamente.")
    } finally {
      setSalvandoDesfecho(false)
    }
  }

  async function copiarLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/p/consulta/${id}`)
      setLinkCopiado(true)
      setTimeout(() => setLinkCopiado(false), 2000)
    } catch {
      /* navegador sem clipboard — ignora */
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  if (erro || !consulta) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-sm text-muted-foreground">Consulta não encontrada.</p>
        <Button variant="outline" asChild>
          <Link href="/dashboard/agenda">Voltar à agenda</Link>
        </Button>
      </div>
    )
  }

  const serie = humor.map((p) => Math.round(p.humor ?? 0)).filter((v) => v > 0)
  const atual = serie.length ? serie[serie.length - 1] : null
  const anterior = serie.length > 1 ? serie[0] : null
  const delta = atual !== null && anterior !== null ? atual - anterior : 0
  const TrendIcon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus
  const trendColor = delta > 0 ? "text-success" : delta < 0 ? "text-destructive" : "text-muted-foreground"
  const adesaoPrincipal = adesao.length ? [...adesao].sort((a, b) => b.total - a.total)[0] : null
  const semHistorico = serie.length === 0 && adesao.length === 0

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border/50 bg-background/95 px-6 py-3 backdrop-blur">
        <Button variant="ghost" size="sm" asChild className="gap-2 text-muted-foreground">
          <Link href="/dashboard/agenda">
            <ArrowLeft className="h-4 w-4" /> Agenda
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-primary">Consulta: {hora(consulta.iniciaEm)}</span>
          <Badge className="border-0 bg-primary/10 text-xs text-primary capitalize">{consulta.modalidade}</Badge>
          <Badge variant="outline" className="text-xs">{STATUS_ROTULO[consulta.status] ?? consulta.status}</Badge>
        </div>
      </div>

      <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
        <div className="flex items-center gap-4">
          <Avatar className="h-16 w-16 border-2 border-primary/20">
            <AvatarFallback className="bg-secondary text-xl font-semibold text-primary">
              {iniciais(consulta.pacienteNome, "?")}
            </AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{consulta.pacienteNome ?? "Paciente"}</h1>
            <p className="text-sm text-muted-foreground">
              {new Date(consulta.iniciaEm).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
            </p>
          </div>
        </div>

        {consulta.modalidade === "teleconsulta" && consulta.status !== "cancelada" && (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-primary/20 bg-primary/5 p-4">
            <Video className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-primary">Teleconsulta por vídeo</span>
            <div className="ml-auto flex gap-2">
              <Button size="sm" asChild className="gap-1.5">
                <Link href={`/dashboard/consultas/${id}/teleconsulta`}>
                  <Video className="h-4 w-4" /> Iniciar teleconsulta
                </Link>
              </Button>
              <Button size="sm" variant="outline" onClick={copiarLink} className="gap-1.5">
                {linkCopiado ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
                {linkCopiado ? "Link copiado" : "Copiar link do paciente"}
              </Button>
            </div>
          </div>
        )}

        {/* Escriba presencial (ADR-075): grava o áudio da consulta na sala. Só Master. */}
        {consulta.modalidade === "presencial" && consulta.status !== "cancelada"
          && temFeature(me?.features, FEATURE.escriba) && (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-primary/20 bg-primary/5 p-4">
            <Mic className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-primary">Escriba — nota assistida por IA</span>
            <div className="ml-auto">
              <Button size="sm" asChild className="gap-1.5">
                <Link href={`/dashboard/consultas/${id}/escriba/gravar`}>
                  <Mic className="h-4 w-4" /> Gravar nota
                </Link>
              </Button>
            </div>
          </div>
        )}

        {semHistorico ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center">
            <p className="text-sm text-muted-foreground">
              Sem histórico de humor ou adesão para este paciente ainda.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {/* Humor */}
            <div className="space-y-1 rounded-2xl border border-border/50 bg-card p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Humor</p>
              <div className="flex items-end gap-1.5">
                <span className="text-3xl font-bold text-foreground">{atual ?? "—"}</span>
                {atual !== null && <span className="mb-0.5 text-sm text-muted-foreground">/10</span>}
              </div>
              {anterior !== null && (
                <div className="flex items-center gap-1">
                  <TrendIcon className={`h-3.5 w-3.5 ${trendColor}`} />
                  <span className={`text-xs font-medium ${trendColor}`}>
                    {delta > 0 ? `+${delta}` : delta} no período
                  </span>
                </div>
              )}
            </div>

            {/* Adesão */}
            <div className="space-y-1 rounded-2xl border border-border/50 bg-card p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Adesão</p>
              <span className={`text-3xl font-bold ${(adesaoPrincipal?.percentualAdesao ?? 0) >= 80 ? "text-success" : "text-warning"}`}>
                {adesaoPrincipal?.percentualAdesao ?? "—"}
                {adesaoPrincipal?.percentualAdesao != null && <span className="text-lg">%</span>}
              </span>
              <p className="text-xs leading-snug text-muted-foreground">
                {adesaoPrincipal?.medicamento ?? "sem prescrição"}
              </p>
              {adesaoPrincipal && adesaoPrincipal.faltas > 0 && (
                <p className="text-xs text-warning">{adesaoPrincipal.faltas} falta(s) em 30d</p>
              )}
            </div>

            {/* Registros */}
            <div className="space-y-1 rounded-2xl border border-border/50 bg-card p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Registros</p>
              <span className="text-3xl font-bold text-foreground">{serie.length}</span>
              <p className="text-xs text-muted-foreground">de humor (14d)</p>
              {serie.length > 0 && atual !== null && atual >= 7 && (
                <span className="flex items-center gap-1 text-xs font-medium text-success">
                  <ShieldCheck className="h-3 w-3" /> estável
                </span>
              )}
            </div>
          </div>
        )}

        {serie.length > 1 && (
          <div className="rounded-2xl border border-border/50 bg-card p-5">
            <p className="mb-3 text-sm font-semibold text-foreground">Evolução do humor — últimos registros</p>
            <Sparkline values={serie} />
            <div className="mt-1 flex justify-between text-xs text-muted-foreground">
              <span>{anterior} (início)</span>
              <span>{atual} (atual)</span>
            </div>
          </div>
        )}

        {/* Síntese IA */}
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              <p className="text-sm font-semibold text-primary">Síntese pré-consulta</p>
            </div>
            {!semBriefing && (
              <Button size="sm" variant="outline" onClick={gerarResumo} disabled={gerando} className="gap-1.5 text-xs">
                {gerando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {resumo ? "Atualizar" : "Gerar"}
              </Button>
            )}
          </div>
          {semBriefing ? (
            <UpsellFeature feature={FEATURE.briefingIa} variant="inline" />
          ) : resumo ? (
            <>
              {resumo.titulo && <p className="mb-1 text-sm font-medium text-foreground">{resumo.titulo}</p>}
              <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">{resumo.conteudo}</p>
              <p className="mt-3 text-xs text-muted-foreground">
                Gerado em {new Date(resumo.criadoEm).toLocaleString("pt-BR")} · revisão do médico obrigatória
              </p>
            </>
          ) : erroResumo && !gerando ? (
            <p className="text-sm text-destructive">{erroResumo}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {gerando ? "Gerando resumo do período…" : "Nenhum resumo gerado ainda. Clique em Gerar."}
            </p>
          )}
        </div>

        {/* Desfecho pós-consulta */}
        <div className="rounded-2xl border border-border/50 bg-card p-5">
          <p className="mb-2 text-sm font-semibold text-foreground">Desfecho da consulta</p>
          <textarea
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            rows={4}
            placeholder="Notas da consulta, conduta combinada, próximos passos…"
            className="w-full resize-none rounded-xl border border-border/60 bg-background p-3 text-sm outline-none focus:border-primary"
          />
          <div className="mt-3 flex items-center gap-3">
            <Button size="sm" onClick={salvarDesfecho} disabled={salvandoDesfecho}>
              {salvandoDesfecho ? <Loader2 className="h-4 w-4 animate-spin" /> : "Registrar desfecho"}
            </Button>
            {desfechoSalvo && (
              <span className="flex items-center gap-1 text-xs text-success">
                <Check className="h-3.5 w-3.5" /> Registrado
              </span>
            )}
            {erroDesfecho && <span className="text-xs text-destructive">{erroDesfecho}</span>}
            <span className="text-xs text-muted-foreground">
              Marca a consulta como realizada. As condutas vão na aba Conduta do prontuário.
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border/50 pt-2">
          <p className="text-xs text-muted-foreground">Cérebro Amigo · organiza fatos; a decisão clínica é sua</p>
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard/agenda">Voltar à agenda</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
