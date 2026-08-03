"use client"

import { useEffect, useRef, useState } from "react"
import { Mic, Square, Send, Loader2, CheckCircle, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"

type Fase = "verificando" | "consent" | "idle" | "gravando" | "enviando" | "ok" | "erro"

function fmtSegundos(s: number) {
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, "0")}`
}

export function AudioRecorder() {
  const [fase, setFase] = useState<Fase>("verificando")
  const [segundos, setSegundos] = useState(0)
  const mediaRef  = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    fetch("/api/paciente/audio/consent")
      .then((r) => r.json())
      .then((d) => setFase(d.consentimento ? "idle" : "consent"))
      .catch(() => setFase("idle"))
  }, [])

  async function darConsent() {
    await fetch("/api/paciente/audio/consent", { method: "POST" })
    setFase("idle")
  }

  async function iniciarGravacao() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mr = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" })
    chunksRef.current = []
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    mr.start(250)
    mediaRef.current = mr
    setSegundos(0)
    setFase("gravando")
    timerRef.current = setInterval(() => setSegundos((s) => s + 1), 1000)
  }

  async function pararEEnviar() {
    if (timerRef.current) clearInterval(timerRef.current)
    const mr = mediaRef.current
    if (!mr) return
    setFase("enviando")

    await new Promise<void>((res) => { mr.onstop = () => res(); mr.stop() })
    mr.stream.getTracks().forEach((t) => t.stop())

    const blob = new Blob(chunksRef.current, { type: "audio/webm" })
    const duracaoS = segundos

    try {
      // 1. Presigned URL
      const urlRes = await fetch("/api/paciente/audio/upload-url", { method: "POST" })
      if (!urlRes.ok) throw new Error("upload-url falhou")
      const { uploadUrl, s3Key } = await urlRes.json()

      // 2. PUT direto no Azure Blob via SAS (x-ms-blob-type é obrigatório)
      const put = await fetch(uploadUrl, {
        method: "PUT",
        body: blob,
        headers: { "Content-Type": "audio/webm", "x-ms-blob-type": "BlockBlob" },
      })
      if (!put.ok) throw new Error("PUT no Blob falhou")

      // 3. Registrar no DB
      const reg = await fetch("/api/paciente/audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ s3Key, duracaoS }),
      })
      if (!reg.ok) throw new Error("registro falhou")

      setFase("ok")
      setTimeout(() => setFase("idle"), 3000)
    } catch {
      setFase("erro")
      setTimeout(() => setFase("idle"), 3000)
    }
  }

  if (fase === "verificando") return null

  if (fase === "consent") {
    return (
      <div className="portal-card portal-hairline space-y-3 p-4">
        <p className="text-sm font-medium text-foreground">Mensagens de áudio para sua psiquiatra</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Grave e envie áudios curtos entre as consultas. Os áudios ficam disponíveis por 60 dias e
          só sua psiquiatra pode ouvir.
        </p>
        <Button
          size="sm"
          className="portal-tap w-full rounded-lg bg-primary hover:bg-purple-dark"
          onClick={darConsent}
        >
          Entendi e quero usar
        </Button>
      </div>
    )
  }

  if (fase === "ok") {
    return (
      <div className="portal-card flex items-center gap-3 border-success/30 p-4">
        <CheckCircle className="h-5 w-5 shrink-0 text-success" />
        <p className="text-sm text-foreground">Áudio enviado para sua psiquiatra.</p>
      </div>
    )
  }

  if (fase === "erro") {
    return (
      <div className="portal-card flex items-center gap-3 border-destructive/30 p-4">
        <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
        <p className="text-sm text-foreground">Não consegui enviar. Tente de novo.</p>
      </div>
    )
  }

  return (
    <div className="portal-card portal-hairline flex items-center justify-between p-4">
      <div className="flex items-center gap-3">
        <div
          className={`grid h-11 w-11 place-items-center rounded-xl ring-1 ${
            fase === "gravando"
              ? "animate-pulse bg-destructive/12 text-destructive ring-destructive/20"
              : "bg-primary/12 text-primary ring-primary/15"
          }`}
        >
          <Mic className="h-5 w-5" />
        </div>
        <div>
          <p className="nums text-sm font-medium text-foreground">
            {fase === "gravando" ? `Gravando… ${fmtSegundos(segundos)}` : "Mensagem de áudio"}
          </p>
          <p className="text-xs text-muted-foreground">
            {fase === "gravando"
              ? "Toque em enviar quando terminar"
              : "Grave um recado para sua psiquiatra"}
          </p>
        </div>
      </div>

      {fase === "enviando" ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : fase === "gravando" ? (
        <Button
          size="sm"
          onClick={pararEEnviar}
          className="portal-tap gap-1 rounded-lg bg-primary hover:bg-purple-dark"
        >
          <Send className="h-4 w-4" /> Enviar
        </Button>
      ) : (
        <Button
          size="icon"
          variant="ghost"
          onClick={iniciarGravacao}
          aria-label="Gravar"
          className="portal-tap"
        >
          <Mic className="h-5 w-5 text-primary" />
        </Button>
      )}
    </div>
  )
}
