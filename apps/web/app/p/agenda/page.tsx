"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Loader2, AlertTriangle, Check, X, Video } from "lucide-react"
import { PortalErroCarregar } from "@/components/portal/portal-erro-carregar"
import { PortalPageHeader } from "@/components/portal/page-header"

interface Consulta {
  id: string
  iniciaEm: string
  duracaoMin: number
  modalidade: string
  status: string
}

const STATUS: Record<string, { rotulo: string; cls: string }> = {
  agendada: { rotulo: "Aguardando confirmação", cls: "bg-warning/15 text-warning" },
  confirmada: { rotulo: "Confirmada", cls: "bg-success/15 text-success" },
  realizada: { rotulo: "Realizada", cls: "bg-primary/15 text-primary" },
  cancelada: { rotulo: "Cancelada", cls: "bg-destructive/15 text-destructive" },
}

function hojeYmd() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
function quando(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  })
}
function horaLocal(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
}
// Janela de entrada na teleconsulta: de 10 min antes até o fim previsto + 30 min.
function podeEntrarVideo(c: Consulta): boolean {
  if (c.modalidade !== "teleconsulta" || c.status === "cancelada") return false
  const ini = new Date(c.iniciaEm).getTime()
  const fim = ini + (c.duracaoMin || 30) * 60000 + 30 * 60000
  const agora = Date.now()
  return agora >= ini - 10 * 60000 && agora <= fim
}

export default function AgendaPacientePage() {
  const [consultas, setConsultas] = useState<Consulta[]>([])
  const [loading, setLoading] = useState(true)
  const [falhou, setFalhou] = useState(false)
  const [cancelando, setCancelando] = useState<string | null>(null)

  // agendamento
  const [data, setData] = useState(hojeYmd())
  const [slots, setSlots] = useState<string[]>([])
  const [slot, setSlot] = useState("")
  const [modalidade, setModalidade] = useState("teleconsulta")
  const [carregandoSlots, setCarregandoSlots] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: "erro" | "ok"; texto: string } | null>(null)

  // silencioso: refresh em background (poll/foco) não acende o spinner da lista,
  // pra não piscar a cada atualização automática.
  const carregar = useCallback((silencioso = false) => {
    if (!silencioso) {
      setLoading(true)
      setFalhou(false)
    }
    fetch("/api/paciente/agenda", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((rows) => setConsultas(Array.isArray(rows) ? rows : []))
      .catch(() => {
        if (!silencioso) {
          setConsultas([])
          setFalhou(true)
        }
      })
      .finally(() => {
        if (!silencioso) setLoading(false)
      })
  }, [])

  // Atualiza sozinho: o médico pode confirmar/criar/remarcar/cancelar consultas do
  // lado dele e o paciente não deve precisar dar reload na mão. Poll a cada 30s
  // enquanto a aba está visível + refetch ao voltar o foco/visibilidade (volta pro PWA).
  useEffect(() => {
    carregar()
    const refrescarSeVisivel = () => {
      if (document.visibilityState === "visible") carregar(true)
    }
    const id = setInterval(refrescarSeVisivel, 30000)
    document.addEventListener("visibilitychange", refrescarSeVisivel)
    window.addEventListener("focus", refrescarSeVisivel)
    return () => {
      clearInterval(id)
      document.removeEventListener("visibilitychange", refrescarSeVisivel)
      window.removeEventListener("focus", refrescarSeVisivel)
    }
  }, [carregar])

  useEffect(() => {
    if (!data) return
    setCarregandoSlots(true)
    setSlot("")
    fetch(`/api/paciente/agenda/disponibilidade?data=${data}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setSlots(Array.isArray(d?.slots) ? d.slots : []))
      .catch(() => setSlots([]))
      .finally(() => setCarregandoSlots(false))
  }, [data])

  async function agendar() {
    setMsg(null)
    if (!slot) {
      setMsg({ tipo: "erro", texto: "Escolha um horário." })
      return
    }
    setEnviando(true)
    try {
      const r = await fetch("/api/paciente/agenda", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ iniciaEm: slot, modalidade }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => null)
        const erro = d?.erro ?? d?.error
        if (erro === "horario_ocupado" || erro === "horario_indisponivel") {
          setMsg({ tipo: "erro", texto: "Esse horário não está mais disponível. Escolha outro." })
        } else {
          setMsg({ tipo: "erro", texto: "Não foi possível agendar. Tente novamente." })
        }
        return
      }
      setMsg({ tipo: "ok", texto: "Consulta solicitada! Aguarde a confirmação do seu médico." })
      setSlot("")
      carregar()
      // recarrega slots do dia (o horário escolhido sai da lista)
      fetch(`/api/paciente/agenda/disponibilidade?data=${data}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setSlots(Array.isArray(d?.slots) ? d.slots : []))
        .catch(() => {})
    } catch {
      setMsg({ tipo: "erro", texto: "Erro de conexão. Tente novamente." })
    } finally {
      setEnviando(false)
    }
  }

  async function cancelar(id: string) {
    if (!confirm("Tem certeza que deseja cancelar esta consulta?")) return
    setCancelando(id)
    setMsg(null)
    try {
      const r = await fetch(`/api/paciente/agenda/${id}/cancelar`, { method: "PATCH" })
      if (r.ok) {
        setConsultas((cs) => cs.map((c) => (c.id === id ? { ...c, status: "cancelada" } : c)))
      } else {
        setMsg({ tipo: "erro", texto: "Não foi possível cancelar. Tente novamente." })
      }
    } catch {
      setMsg({ tipo: "erro", texto: "Erro de conexão. Tente novamente." })
    } finally {
      setCancelando(null)
    }
  }

  const agora = new Date()
  const futuras = consultas
    .filter((c) => new Date(c.iniciaEm) > agora && c.status !== "cancelada")
    .sort((a, b) => new Date(a.iniciaEm).getTime() - new Date(b.iniciaEm).getTime())
  const anteriores = consultas
    .filter((c) => new Date(c.iniciaEm) <= agora && c.status !== "cancelada")
    .sort((a, b) => new Date(b.iniciaEm).getTime() - new Date(a.iniciaEm).getTime())

  return (
    <div className="space-y-7 p-5 pt-9">
      <PortalPageHeader
        eyebrow="Consultas"
        titulo="Minha agenda"
        subtitulo="Agende uma consulta com seu médico."
      />

      {/* Agendar */}
      <section className="portal-card portal-hairline portal-rise-in portal-stagger-2 space-y-3.5 p-4">
        <h2 className="portal-eyebrow">Nova consulta</h2>

        {msg && (
          <div
            className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm ${
              msg.tipo === "ok"
                ? "border border-success/20 bg-success/10 text-success"
                : "border border-destructive/20 bg-destructive/10 text-destructive"
            }`}
          >
            {msg.tipo === "ok" ? (
              <Check className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <span>{msg.texto}</span>
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Dia</label>
          <Input
            type="date"
            value={data}
            min={hojeYmd()}
            onChange={(e) => setData(e.target.value)}
            className="h-11 rounded-xl bg-noir-surface-raised/60"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Horário</label>
          <Select value={slot} onValueChange={setSlot} disabled={carregandoSlots || slots.length === 0}>
            <SelectTrigger className="h-11 rounded-xl bg-noir-surface-raised/60">
              <SelectValue
                placeholder={
                  carregandoSlots
                    ? "Carregando…"
                    : slots.length === 0
                      ? "Sem horários neste dia"
                      : "Escolha"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {slots.map((s) => (
                <SelectItem key={s} value={s} className="nums">
                  {horaLocal(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Modalidade</label>
          <Select value={modalidade} onValueChange={setModalidade}>
            <SelectTrigger className="h-11 rounded-xl bg-noir-surface-raised/60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="teleconsulta">Teleconsulta</SelectItem>
              <SelectItem value="presencial">Presencial</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          onClick={agendar}
          disabled={enviando || !slot}
          className="portal-tap h-11 w-full rounded-xl bg-primary hover:bg-purple-dark"
        >
          {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Solicitar consulta"}
        </Button>
      </section>

      {/* Próximas */}
      <section className="space-y-3">
        <h2 className="portal-eyebrow px-0.5">Próximas consultas</h2>
        {loading ? (
          <div className="flex justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : falhou ? (
          <PortalErroCarregar
            mensagem="Não foi possível carregar sua agenda."
            onRetry={() => carregar()}
          />
        ) : futuras.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-noir-line px-4 py-10 text-center text-sm text-muted-foreground">
            Você não tem consultas futuras agendadas.
          </p>
        ) : (
          futuras.map((c) => {
            const st = STATUS[c.status] ?? STATUS.agendada
            return (
              <div key={c.id} className="portal-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium capitalize text-foreground">
                      {quando(c.iniciaEm)}
                    </p>
                    <p className="mt-0.5 text-xs capitalize text-muted-foreground">{c.modalidade}</p>
                    <span
                      className={`mt-2.5 inline-block rounded-full px-2.5 py-0.5 text-[10px] font-medium ${st.cls}`}
                    >
                      {st.rotulo}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="portal-tap gap-1 rounded-lg text-xs text-destructive hover:bg-destructive/10"
                    disabled={cancelando === c.id}
                    onClick={() => cancelar(c.id)}
                  >
                    {cancelando === c.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <X className="h-3.5 w-3.5" />
                    )}
                    Cancelar
                  </Button>
                </div>
                {podeEntrarVideo(c) && (
                  <Button
                    asChild
                    size="sm"
                    className="portal-tap portal-fab mt-3 w-full gap-1.5 rounded-xl bg-gradient-to-br from-primary to-purple-dark"
                  >
                    <Link href={`/p/consulta/${c.id}`}>
                      <Video className="h-4 w-4" /> Entrar na consulta
                    </Link>
                  </Button>
                )}
              </div>
            )
          })
        )}
      </section>

      {/* Anteriores */}
      {!loading && anteriores.length > 0 && (
        <section className="space-y-3">
          <h2 className="portal-eyebrow px-0.5">Consultas anteriores</h2>
          {anteriores.map((c) => {
            const st = STATUS[c.status] ?? STATUS.agendada
            return (
              <div key={c.id} className="portal-card p-4 opacity-70">
                <p className="text-sm font-medium capitalize text-foreground">{quando(c.iniciaEm)}</p>
                <p className="mt-0.5 text-xs capitalize text-muted-foreground">{c.modalidade}</p>
                <span
                  className={`mt-2.5 inline-block rounded-full px-2.5 py-0.5 text-[10px] font-medium ${st.cls}`}
                >
                  {st.rotulo}
                </span>
              </div>
            )
          })}
        </section>
      )}
    </div>
  )
}
