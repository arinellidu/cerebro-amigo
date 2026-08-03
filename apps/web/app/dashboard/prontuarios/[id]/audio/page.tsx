"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { Mic, Play, Loader2, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

interface MensagemAudio {
  id: string
  duracaoS: number | null
  ouvidoEm: string | null
  criadaEm: string
  expiraEm: string
}

function fmtDuracao(s: number | null) {
  if (!s) return "--"
  const m = Math.floor(s / 60)
  const r = s % 60
  return m > 0 ? `${m}min ${r}s` : `${r}s`
}

function fmtData(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}

export default function AudioPage() {
  const { id: pacienteId } = useParams<{ id: string }>()
  const [mensagens, setMensagens] = useState<MensagemAudio[]>([])
  const [loading, setLoading] = useState(true)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [audioEl] = useState(() => typeof Audio !== "undefined" ? new Audio() : null)

  useEffect(() => {
    if (!pacienteId) return
    fetch(`/api/prontuario/${pacienteId}/audio`)
      .then((r) => r.json())
      .then(setMensagens)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [pacienteId])

  async function play(msg: MensagemAudio) {
    if (!audioEl) return
    setPlayingId(msg.id)

    // Marcar como ouvido (fire-and-forget)
    if (!msg.ouvidoEm) {
      fetch(`/api/prontuario/${pacienteId}/audio/${msg.id}/ouvido`, { method: "PATCH" })
        .then(() => setMensagens((prev) =>
          prev.map((m) => m.id === msg.id ? { ...m, ouvidoEm: new Date().toISOString() } : m)
        ))
    }

    // Obter presigned URL
    const res = await fetch(`/api/prontuario/${pacienteId}/audio/${msg.id}/play-url`)
    if (!res.ok) { setPlayingId(null); return }
    const { playUrl } = await res.json()

    audioEl.src = playUrl
    audioEl.onended = () => setPlayingId(null)
    audioEl.play().catch(() => setPlayingId(null))
  }

  if (loading) return (
    <div className="flex justify-center py-10">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  )

  if (mensagens.length === 0) return (
    <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
      <Mic className="h-8 w-8 opacity-40" />
      <p className="text-sm">Nenhuma mensagem de áudio ainda.</p>
    </div>
  )

  return (
    <div className="space-y-3">
      {mensagens.map((m) => (
        <div key={m.id}
          className="flex items-center gap-4 rounded-xl border border-border/60 bg-card px-4 py-3">
          <Button
            size="icon"
            variant={playingId === m.id ? "default" : "outline"}
            className="h-9 w-9 shrink-0"
            onClick={() => play(m)}
            disabled={playingId === m.id}
          >
            {playingId === m.id
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Play className="h-4 w-4" />}
          </Button>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-foreground">{fmtData(m.criadaEm)}</p>
            <p className="text-xs text-muted-foreground">
              {fmtDuracao(m.duracaoS)} · expira {new Date(m.expiraEm).toLocaleDateString("pt-BR")}
            </p>
          </div>
          {!m.ouvidoEm && (
            <Badge className="bg-primary/10 text-primary hover:bg-primary/10 text-xs shrink-0">
              Novo
            </Badge>
          )}
        </div>
      ))}
    </div>
  )
}
