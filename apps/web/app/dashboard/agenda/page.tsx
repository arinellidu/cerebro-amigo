"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isSameWeek,
  startOfMonth,
  startOfWeek,
} from "date-fns"
import { ptBR } from "date-fns/locale"
import { Header } from "@/components/header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  ChevronLeft,
  ChevronRight,
  Video,
  MapPin,
  FileText,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  X,
  XCircle,
  ClipboardCheck,
  UserX,
  UserCheck,
  ExternalLink,
  Save,
  VideoOff,
} from "lucide-react"
import { NovaConsultaDialog } from "@/components/agenda/nova-consulta-dialog"
import { SemanaView } from "@/components/agenda/semana-view"
import { MesView } from "@/components/agenda/mes-view"
import { DiaView } from "@/components/agenda/dia-view"

interface Consulta {
  id: string
  pacienteId: string
  pacienteNome: string | null
  iniciaEm: string
  duracaoMin: number
  modalidade: string
  status: string
  notas: string | null
}

type Vista = "dia" | "semana" | "mes"

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function intervalo(vista: Vista, anchor: Date): [Date, Date] {
  if (vista === "dia") return [anchor, anchor]
  if (vista === "semana")
    return [startOfWeek(anchor, { weekStartsOn: 1 }), endOfWeek(anchor, { weekStartsOn: 1 })]
  return [
    startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 }),
    endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 }),
  ]
}

const STATUS_BADGE: Record<string, string> = {
  agendada:  "bg-muted text-muted-foreground",
  confirmada:"bg-success/10 text-success",
  realizada: "bg-primary/10 text-primary",
  cancelada: "bg-destructive/10 text-destructive",
}

const STATUS_ROTULO: Record<string, string> = {
  agendada: "Agendada", confirmada: "Confirmada",
  realizada: "Realizada", cancelada: "Cancelada",
}

function ehNoShow(c: Consulta) {
  return c.status === "cancelada" && (c.notas?.startsWith("[no-show]") ?? false)
}

// ─── Mini calendário lateral ────────────────────────────────────────────────
const CAB = ["S", "T", "Q", "Q", "S", "S", "D"]
function MiniCal({
  mes, onDiaClick, anchor,
}: { mes: Date; onDiaClick: (d: Date) => void; anchor: Date }) {
  const ini = startOfWeek(startOfMonth(mes), { weekStartsOn: 1 })
  const fim = endOfWeek(endOfMonth(mes), { weekStartsOn: 1 })
  const dias = eachDayOfInterval({ start: ini, end: fim })
  const hoje = new Date()
  return (
    <div>
      <div className="mb-1 grid grid-cols-7">
        {CAB.map((c, i) => (
          <div key={i} className="text-center text-[10px] font-medium text-muted-foreground py-0.5">{c}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {dias.map((d) => {
          const noMes = isSameMonth(d, mes)
          const isHoje = isSameDay(d, hoje)
          const selected = isSameDay(d, anchor)
          return (
            <button
              key={d.toISOString()}
              onClick={() => onDiaClick(d)}
              className={`rounded text-[11px] py-0.5 transition-colors font-medium
                ${!noMes ? "opacity-30 text-muted-foreground" : ""}
                ${selected ? "bg-primary text-primary-foreground" : isHoje ? "text-primary font-bold" : "hover:bg-secondary text-foreground"}
              `}
            >
              {format(d, "d")}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Painel de detalhe da consulta ──────────────────────────────────────────
function PainelDetalhe({
  consulta,
  onClose,
  onUpdate,
}: {
  consulta: Consulta
  onClose: () => void
  onUpdate: (updated: Partial<Consulta>) => void
}) {
  const [acao, setAcao] = useState<string | null>(null)
  const [notas, setNotas] = useState(
    ehNoShow(consulta)
      ? (consulta.notas?.replace(/^\[no-show\]\s*/, "") ?? "")
      : (consulta.notas ?? "")
  )
  const [salvando, setSalvando] = useState(false)
  const [erroAcao, setErroAcao] = useState<string | null>(null)
  const [finalizando, setFinalizando] = useState(false)
  const [videoAviso, setVideoAviso] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  async function patchConsulta(body: Record<string, string>) {
    const r = await fetch(`/api/consultas/${consulta.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!r.ok) throw new Error("falha")
  }

  async function mudarStatus(novoStatus: string, prefixNotas?: string) {
    setAcao(novoStatus)
    setErroAcao(null)
    try {
      const body: Record<string, string> = { status: novoStatus }
      if (prefixNotas !== undefined) body.notas = prefixNotas
      await patchConsulta(body)
      onUpdate({ status: novoStatus, notas: prefixNotas ?? consulta.notas })
    } catch {
      setErroAcao("Não foi possível atualizar. Tente novamente.")
    } finally {
      setAcao(null)
    }
  }

  async function salvarNotas() {
    setSalvando(true)
    setErroAcao(null)
    try {
      await patchConsulta({ notas: notas.trim() })
      onUpdate({ notas: notas.trim() })
    } catch {
      setErroAcao("Não foi possível salvar as observações.")
    } finally {
      setSalvando(false)
    }
  }

  // Finaliza a teleconsulta: agenda a expiração do link (vale +15min de graça,
  // cap de 120min após o fim previsto). Não derruba quem está na sala.
  async function finalizarVideo() {
    setFinalizando(true)
    setErroAcao(null)
    setVideoAviso(null)
    try {
      const r = await fetch(`/api/consultas/${consulta.id}/video/finalizar`, { method: "POST" })
      if (!r.ok) throw new Error("falha")
      setVideoAviso("Teleconsulta finalizada. O link expira em ~15 min — a reentrada é bloqueada depois disso.")
    } catch {
      setErroAcao("Não foi possível finalizar a teleconsulta. Tente novamente.")
    } finally {
      setFinalizando(false)
    }
  }

  const dataHora = new Date(consulta.iniciaEm)
  const noShow = ehNoShow(consulta)
  const cancelada = consulta.status === "cancelada"
  const realizada = consulta.status === "realizada"
  // Só após o horário de início — finalizar uma consulta futura expiraria o link
  // antes da hora ("sempre o menor"). O gateway reforça (inicia_em <= NOW).
  const teleconsultaIniciada =
    consulta.modalidade === "teleconsulta" && !cancelada && dataHora.getTime() <= Date.now()

  return (
    <div className="flex flex-col h-full">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between p-5 border-b border-border/60">
        <div>
          <p className="font-semibold text-foreground">{consulta.pacienteNome ?? "Paciente"}</p>
          <p className="text-sm text-muted-foreground mt-0.5">
            {dataHora.toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short" })}
            {" · "}
            {dataHora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            {consulta.duracaoMin > 0 && ` · ${consulta.duracaoMin}min`}
          </p>
          <div className="flex items-center gap-2 mt-2">
            <Badge className={`border-0 text-[10px] ${STATUS_BADGE[consulta.status] ?? ""}`}>
              {noShow ? "No-show" : STATUS_ROTULO[consulta.status] ?? consulta.status}
            </Badge>
            <span className="text-xs text-muted-foreground flex items-center gap-1 capitalize">
              {consulta.modalidade === "teleconsulta"
                ? <><Video className="h-3 w-3" /> Teleconsulta</>
                : <><MapPin className="h-3 w-3" /> Presencial</>}
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1 hover:bg-secondary text-muted-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Ações de status */}
        {!realizada && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Status</p>
            <div className="flex flex-wrap gap-2">
              {consulta.status === "agendada" && (
                <Button
                  size="sm" variant="outline"
                  className="gap-1.5 text-xs text-success border-success/30 hover:bg-success/10"
                  disabled={acao !== null}
                  onClick={() => mudarStatus("confirmada")}
                >
                  {acao === "confirmada" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserCheck className="h-3.5 w-3.5" />}
                  Confirmar
                </Button>
              )}
              {!cancelada && (
                <Button
                  size="sm" variant="outline"
                  className="gap-1.5 text-xs text-primary border-primary/30 hover:bg-primary/10"
                  disabled={acao !== null}
                  onClick={() => mudarStatus("realizada")}
                >
                  {acao === "realizada" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  Realizada
                </Button>
              )}
              {!cancelada && (
                <Button
                  size="sm" variant="outline"
                  className="gap-1.5 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                  disabled={acao !== null}
                  onClick={() => mudarStatus("cancelada")}
                >
                  {acao === "cancelada" && !noShow ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                  Cancelar
                </Button>
              )}
              {!cancelada && (
                <Button
                  size="sm" variant="outline"
                  className="gap-1.5 text-xs text-warning border-warning/30 hover:bg-warning/10"
                  disabled={acao !== null}
                  onClick={() => mudarStatus("cancelada", `[no-show] ${notas}`.trim())}
                >
                  {acao === "no-show" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserX className="h-3.5 w-3.5" />}
                  No-show
                </Button>
              )}
              {cancelada && (
                <Button
                  size="sm" variant="outline"
                  className="gap-1.5 text-xs"
                  disabled={acao !== null}
                  onClick={() => mudarStatus("agendada")}
                >
                  {acao === "agendada" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardCheck className="h-3.5 w-3.5" />}
                  Reagendar
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Observações */}
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Observações</p>
          <Textarea
            ref={textareaRef}
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Notas sobre esta consulta…"
            className="min-h-[120px] text-sm resize-none"
          />
          <Button
            size="sm" variant="ghost"
            className="mt-2 gap-1.5 text-xs"
            disabled={salvando || notas === (consulta.notas ?? "")}
            onClick={salvarNotas}
          >
            {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Salvar observações
          </Button>
        </div>

        {/* Erro */}
        {erroAcao && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {erroAcao}
          </div>
        )}

        {/* Aviso de teleconsulta finalizada */}
        {videoAviso && (
          <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/10 p-3 text-xs text-primary">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {videoAviso}
          </div>
        )}

        {/* Links */}
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Ações</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" asChild className="gap-1.5 text-xs">
              <Link href={`/dashboard/consultas/${consulta.id}/briefing`}>
                <FileText className="h-3.5 w-3.5" /> Briefing
              </Link>
            </Button>
            <Button size="sm" variant="outline" asChild className="gap-1.5 text-xs">
              <Link href={`/dashboard/prontuarios/${consulta.pacienteId}`}>
                <ExternalLink className="h-3.5 w-3.5" /> Prontuário
              </Link>
            </Button>
            {consulta.modalidade === "teleconsulta" && (
              <Button size="sm" asChild className="gap-1.5 text-xs">
                <Link href={`/dashboard/consultas/${consulta.id}/teleconsulta`}>
                  <Video className="h-3.5 w-3.5" /> Iniciar vídeo
                </Link>
              </Button>
            )}
            {teleconsultaIniciada && (
              <Button
                size="sm" variant="outline"
                className="gap-1.5 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                disabled={finalizando}
                onClick={finalizarVideo}
              >
                {finalizando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <VideoOff className="h-3.5 w-3.5" />}
                Finalizar teleconsulta
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Estatísticas ────────────────────────────────────────────────────────────
function Stats({ consultas, anchor }: { consultas: Consulta[]; anchor: Date }) {
  const hoje = new Date()
  const deDia = consultas.filter((c) => isSameDay(new Date(c.iniciaEm), anchor) && c.status !== "cancelada")
  const deSemana = consultas.filter(
    (c) => isSameWeek(new Date(c.iniciaEm), hoje, { weekStartsOn: 1 }) && c.status !== "cancelada"
  )
  const noShows = consultas.filter(ehNoShow)

  return (
    <div className="grid grid-cols-3 gap-3 sm:max-w-lg">
      {[
        { label: "Hoje", val: deDia.length, cor: "text-foreground", dot: "bg-primary", title: "Consultas de hoje (exceto canceladas)" },
        { label: "Esta semana", val: deSemana.length, cor: "text-foreground", dot: "bg-primary/50", title: "Consultas desta semana (exceto canceladas)" },
        { label: "No-shows", val: noShows.length, cor: noShows.length > 0 ? "text-warning" : "text-muted-foreground", dot: noShows.length > 0 ? "bg-warning" : "bg-muted-foreground/40", title: "No-shows na janela carregada" },
      ].map(({ label, val, cor, dot, title }) => (
        <div key={label} title={title} className="rounded-xl border border-border/60 bg-card px-4 py-3">
          <div className="flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
            <p className="text-[11px] text-muted-foreground">{label}</p>
          </div>
          <p className={`mt-1 text-2xl font-bold tabular-nums ${cor}`}>{val}</p>
        </div>
      ))}
    </div>
  )
}

// ─── Página principal ────────────────────────────────────────────────────────
export default function AgendaPage() {
  const [vista, setVista] = useState<Vista>("dia")
  const [anchor, setAnchor] = useState<Date>(() => new Date())
  const [miniMes, setMiniMes] = useState<Date>(() => new Date())
  const [consultas, setConsultas] = useState<Consulta[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Consulta | null>(null)
  const [pacienteInicial] = useState<string | undefined>(() =>
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("paciente") ?? undefined
      : undefined,
  )

  const carregar = useCallback(async (v: Vista, a: Date) => {
    setLoading(true)
    const [de, ate] = intervalo(v, a)
    try {
      const r = await fetch(`/api/consultas?de=${ymd(de)}&ate=${ymd(ate)}`)
      const rows = r.ok ? await r.json() : []
      setConsultas(Array.isArray(rows) ? rows : [])
    } catch {
      setConsultas([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar(vista, anchor) }, [vista, anchor, carregar])

  function navega(delta: number) {
    setAnchor((d) => {
      if (vista === "dia") return addDays(d, delta)
      if (vista === "semana") return addDays(d, delta * 7)
      return addMonths(d, delta)
    })
  }

  function abrirDia(d: Date) {
    setAnchor(d)
    setMiniMes(d)
    setVista("dia")
  }

  function handleMiniDiaClick(d: Date) {
    setAnchor(d)
    setVista("dia")
  }

  function handleUpdate(updated: Partial<Consulta>) {
    if (!selected) return
    const novaConsulta = { ...selected, ...updated }
    setSelected(novaConsulta)
    setConsultas((cs) => cs.map((c) => (c.id === selected.id ? novaConsulta : c)))
  }

  const rotulo = (() => {
    if (vista === "dia")
      return anchor.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })
    if (vista === "semana") {
      const ini = startOfWeek(anchor, { weekStartsOn: 1 })
      const fim = endOfWeek(anchor, { weekStartsOn: 1 })
      return `${format(ini, "d MMM", { locale: ptBR })} – ${format(fim, "d MMM", { locale: ptBR })}`
    }
    return format(anchor, "MMMM 'de' yyyy", { locale: ptBR })
  })()

  const consultasDoDia = consultas.filter((c) => isSameDay(new Date(c.iniciaEm), anchor))

  return (
    <div className="min-h-screen flex flex-col">
      <Header title="Agenda" />

      <div className="flex flex-1 overflow-hidden">
        {/* ── Sidebar ── */}
        <aside className="hidden xl:flex flex-col w-64 shrink-0 border-r border-border/60 bg-card/50 p-4 gap-6 overflow-y-auto">
          {/* Mini calendário */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-foreground capitalize">
                {format(miniMes, "MMMM yyyy", { locale: ptBR })}
              </p>
              <div className="flex gap-0.5">
                <button
                  onClick={() => setMiniMes((m) => addMonths(m, -1))}
                  className="rounded p-0.5 hover:bg-secondary text-muted-foreground"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setMiniMes((m) => addMonths(m, 1))}
                  className="rounded p-0.5 hover:bg-secondary text-muted-foreground"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <MiniCal mes={miniMes} onDiaClick={handleMiniDiaClick} anchor={anchor} />
          </div>

          {/* Próximas consultas */}
          {consultas.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Na janela atual
              </p>
              <div className="space-y-1.5">
                {[...consultas]
                  .filter((c) => c.status !== "cancelada")
                  .sort((a, b) => a.iniciaEm.localeCompare(b.iniciaEm))
                  .slice(0, 8)
                  .map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setSelected(c)}
                      className={`w-full text-left rounded-md px-2.5 py-2 hover:bg-secondary/80 transition-colors ${selected?.id === c.id ? "bg-secondary" : ""}`}
                    >
                      <p className="text-[11px] font-semibold text-foreground truncate">
                        {new Date(c.iniciaEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                        {" · "}{c.pacienteNome ?? "Paciente"}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {format(new Date(c.iniciaEm), "d/MM", { locale: ptBR })} · {c.modalidade}
                      </p>
                    </button>
                  ))}
              </div>
            </div>
          )}
        </aside>

        {/* ── Área principal ── */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <div className="p-6 space-y-4 flex-1 overflow-y-auto">
            {/* Controles */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" onClick={() => navega(-1)} aria-label="Anterior">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="min-w-[200px] text-center">
                  <p className="text-base font-semibold capitalize text-foreground">{rotulo}</p>
                </div>
                <Button variant="outline" size="icon" onClick={() => navega(1)} aria-label="Próximo">
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost" size="sm" className="text-primary text-xs"
                  onClick={() => { setAnchor(new Date()); setMiniMes(new Date()) }}
                >
                  Hoje
                </Button>
              </div>

              <div className="flex items-center gap-3">
                <ToggleGroup
                  type="single" variant="outline" value={vista}
                  onValueChange={(v) => v && setVista(v as Vista)}
                >
                  <ToggleGroupItem value="dia" className="text-xs">Dia</ToggleGroupItem>
                  <ToggleGroupItem value="semana" className="text-xs">Semana</ToggleGroupItem>
                  <ToggleGroupItem value="mes" className="text-xs">Mês</ToggleGroupItem>
                </ToggleGroup>
                <NovaConsultaDialog
                  diaInicial={ymd(anchor)}
                  // Navega pra o dia agendado (muda anchor → useEffect recarrega):
                  // sem isto, agendar p/ outro dia parecia "nada acontece" (consulta
                  // criada mas fora da vista atual).
                  onCriada={(iniciaEm) => {
                    const d = new Date(iniciaEm)
                    d.setHours(0, 0, 0, 0)
                    setMiniMes(d)
                    setAnchor(d)
                  }}
                  pacienteInicial={pacienteInicial}
                />
              </div>
            </div>

            {/* Stats */}
            <Stats consultas={consultas} anchor={anchor} />

            {/* Vista */}
            {loading ? (
              <div className="flex justify-center py-16 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : vista === "semana" ? (
              <SemanaView
                consultas={consultas}
                semanaInicio={startOfWeek(anchor, { weekStartsOn: 1 })}
                onDiaClick={abrirDia}
              />
            ) : vista === "mes" ? (
              <MesView consultas={consultas} mesAnchor={anchor} onDiaClick={abrirDia} />
            ) : (
              <DiaView
                dia={anchor}
                consultas={consultasDoDia}
                onSelect={(c) => setSelected(c)}
              />
            )}
          </div>
        </div>

        {/* ── Painel detalhe ── */}
        {selected && (
          <aside className="w-80 shrink-0 border-l border-border/60 bg-card overflow-hidden flex flex-col shadow-lg">
            <PainelDetalhe
              consulta={selected}
              onClose={() => setSelected(null)}
              onUpdate={handleUpdate}
            />
          </aside>
        )}
      </div>
    </div>
  )
}
