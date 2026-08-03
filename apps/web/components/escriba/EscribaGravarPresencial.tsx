"use client"

// Escriba PRESENCIAL (ADR-075): captura o áudio ambiente de uma consulta presencial
// (médico + paciente na sala, sem videochamada). Fluxo:
//   1. médico atesta consentimento verbal do paciente (LGPD)
//   2. grava o mic da sala (MediaRecorder standalone, com pausa, sem cap de tempo)
//   3. sobe o áudio direto no Azure Blob (SAS) → registra → transcrição assíncrona
//   4. redireciona p/ a revisão, que faz polling até o rascunho ficar pronto
// Guardrail: o rascunho é factual; a nota clínica é do médico (revisão/aprovação).

import { useState, useRef, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Mic, Square, Pause, Play, Loader2, ShieldCheck, RotateCcw } from "lucide-react"
import { Header } from "@/components/header"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { readFeatureGate, FEATURE } from "@/lib/feature-gate"
import { UpsellFeature } from "@/components/assinatura/upsell-feature"
import { useFeatureUpsell } from "@/components/assinatura/feature-upsell"
import { cn } from "@/lib/utils"

const MIMES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4;codecs=aac",
  "audio/mp4",
]

type Fase = "carregando" | "bloqueado" | "consentir" | "pronto" | "gravando" | "enviando" | "erro"

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`

export function EscribaGravarPresencial({
  consultaId,
  pacienteNome,
}: {
  consultaId: string
  pacienteNome: string
}) {
  const router = useRouter()
  const { showUpsell } = useFeatureUpsell()

  const [fase, setFase] = useState<Fase>("carregando")
  const [atestado, setAtestado] = useState(false)
  const [pausado, setPausado] = useState(false)
  const [segundos, setSegundos] = useState(0)
  const [nivel, setNivel] = useState(0)
  const [msgErro, setMsgErro] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number | null>(null)
  const mimeRef = useRef<string>("")

  const pararTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null } }
  const rodarTimer = () => { pararTimer(); timerRef.current = setInterval(() => setSegundos((s) => s + 1), 1000) }

  // ─── Status inicial: feature (Master) + já consentido? ──────────────────────
  useEffect(() => {
    let cancelled = false
    fetch(`/api/consultas/${consultaId}/escriba/status`)
      .then(async (r) => {
        const gate = await readFeatureGate(r)
        if (gate) { if (!cancelled) { setFase("bloqueado"); showUpsell(gate.feature) } return null }
        if (!r.ok) { if (!cancelled) { setFase("erro"); setMsgErro("Não foi possível carregar o status desta consulta.") } return null }
        return r.json()
      })
      .then((d) => {
        if (cancelled || !d) return
        // Já há trabalho do escriba → vai direto pra revisão (que faz polling).
        if (d.status === "processando" || d.status === "rascunho" || d.status === "aprovado") {
          router.replace(`/dashboard/consultas/${consultaId}/escriba`)
          return
        }
        setFase(d.consentido ? "pronto" : "consentir")
      })
      .catch(() => { if (!cancelled) { setFase("erro"); setMsgErro("Não foi possível carregar o status desta consulta.") } })
    return () => { cancelled = true }
  }, [consultaId, router, showUpsell])

  // ─── Limpeza ────────────────────────────────────────────────────────────────
  useEffect(() => () => {
    pararTimer()
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    recorderRef.current?.stream?.getTracks().forEach((t) => t.stop())
    audioCtxRef.current?.close().catch(() => {})
  }, [])

  // ─── Consentimento presencial (médico atesta) ───────────────────────────────
  async function confirmarConsentimento() {
    setMsgErro(null)
    try {
      const r = await fetch(`/api/consultas/${consultaId}/escriba/consentir-presencial`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ atestado: true }),
      })
      const gate = await readFeatureGate(r)
      if (gate) { setFase("bloqueado"); showUpsell(gate.feature); return }
      if (!r.ok) { setMsgErro("Não foi possível registrar o consentimento. Tente novamente."); return }
      setFase("pronto")
    } catch {
      setMsgErro("Não foi possível registrar o consentimento. Tente novamente.")
    }
  }

  // ─── Visualização de nível ──────────────────────────────────────────────────
  const iniciarVisualizacao = useCallback((stream: MediaStream) => {
    const ctx = new AudioContext()
    audioCtxRef.current = ctx
    const an = ctx.createAnalyser()
    an.fftSize = 256
    ctx.createMediaStreamSource(stream).connect(an)
    const buf = new Uint8Array(an.frequencyBinCount)
    const tick = () => {
      an.getByteFrequencyData(buf)
      const avg = buf.reduce((a, b) => a + b, 0) / buf.length
      setNivel(Math.min(100, Math.round((avg / 128) * 100)))
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [])

  // ─── Gravação ─────────────────────────────────────────────────────────────
  async function iniciarGravacao() {
    setMsgErro(null)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    } catch {
      setMsgErro("Microfone não permitido. Verifique as permissões do navegador.")
      return
    }
    const mime = MIMES.find((m) => { try { return MediaRecorder.isTypeSupported(m) } catch { return false } }) ?? ""
    mimeRef.current = mime
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    recorderRef.current = rec
    chunksRef.current = []

    rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      audioCtxRef.current?.close().catch(() => {})
      audioCtxRef.current = null
      setNivel(0)
      const blob = new Blob(chunksRef.current, { type: (mimeRef.current || "audio/webm").split(";")[0] })
      enviar(blob)
    }

    rec.start(1000) // chunk a cada 1s (consulta longa)
    setFase("gravando")
    setPausado(false)
    setSegundos(0)
    iniciarVisualizacao(stream)
    rodarTimer()
  }

  function alternarPausa() {
    const rec = recorderRef.current
    if (!rec) return
    if (rec.state === "recording") {
      rec.pause(); setPausado(true); pararTimer()
    } else if (rec.state === "paused") {
      rec.resume(); setPausado(false); rodarTimer()
    }
  }

  function pararGravacao() {
    pararTimer()
    const rec = recorderRef.current
    if (rec && (rec.state === "recording" || rec.state === "paused")) rec.stop()
    setFase("enviando")
  }

  // ─── Upload presigned → registro → transcrição assíncrona ───────────────────
  async function enviar(blob: Blob) {
    const contentType = (mimeRef.current || "audio/webm").split(";")[0]
    try {
      // 1) URL presigned
      const ru = await fetch(`/api/consultas/${consultaId}/escriba/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType }),
      })
      const gate = await readFeatureGate(ru)
      if (gate) { setFase("bloqueado"); showUpsell(gate.feature); return }
      if (!ru.ok) throw new Error("upload-url")
      const { uploadUrl, s3Key } = await ru.json()

      // 2) PUT direto no Azure Blob via SAS (x-ms-blob-type é obrigatório no upload)
      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType, "x-ms-blob-type": "BlockBlob" },
        body: blob,
      })
      if (!put.ok) throw new Error("blob")

      // 3) registra → enfileira transcrição assíncrona
      const reg = await fetch(`/api/consultas/${consultaId}/escriba`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ s3Key, contentType }),
      })
      if (!reg.ok) throw new Error("registro")

      // 4) revisão faz polling do 'processando'
      router.replace(`/dashboard/consultas/${consultaId}/escriba`)
    } catch (e) {
      // Telemetria só do erro técnico — nunca o áudio/conteúdo clínico.
      console.error("[EscribaGravar] falha no envio:", e)
      setMsgErro("Não consegui enviar a gravação agora. Tente gravar de novo em instantes.")
      setFase("erro")
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-8 space-y-6 max-w-2xl">
      <Header
        title="Escriba — gravar consulta presencial"
        subtitle={`Paciente: ${pacienteNome} · o áudio é apagado após a transcrição`}
      />

      {fase === "carregando" && (
        <div className="flex justify-center py-20 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
      )}

      {fase === "bloqueado" && <UpsellFeature feature={FEATURE.escriba} />}

      {fase === "consentir" && (
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">Consentimento do paciente (LGPD)</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              A gravação só pode começar com o consentimento do paciente. Confirme abaixo que o paciente
              foi informado e <strong>consentiu verbalmente</strong> com a gravação do áudio desta consulta
              para geração da nota clínica. O áudio é apagado após a transcrição e o paciente pode revogar.
            </p>
            <label className="flex items-start gap-3 rounded-lg border border-border p-3 cursor-pointer">
              <input
                type="checkbox"
                checked={atestado}
                onChange={(e) => setAtestado(e.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <span className="text-sm text-foreground">
                O paciente consentiu verbalmente com a gravação desta consulta.
              </span>
            </label>
            {msgErro && <p className="text-xs text-coral">{msgErro}</p>}
            <Button onClick={confirmarConsentimento} disabled={!atestado} className="gap-2">
              <ShieldCheck className="h-4 w-4" /> Registrar consentimento
            </Button>
          </CardContent>
        </Card>
      )}

      {(fase === "pronto" || fase === "gravando") && (
        <Card>
          <CardContent className="p-8 flex flex-col items-center gap-6">
            <div className="relative flex items-center justify-center">
              <button
                type="button"
                onClick={fase === "pronto" ? iniciarGravacao : pararGravacao}
                aria-label={fase === "pronto" ? "Iniciar gravação" : "Parar e gerar nota"}
                className={cn(
                  "relative w-20 h-20 rounded-full flex items-center justify-center transition-all shadow-md",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  fase === "pronto" ? "bg-primary text-primary-foreground hover:bg-primary/90"
                                    : "bg-destructive text-destructive-foreground hover:bg-destructive/90",
                )}
              >
                {fase === "pronto" ? <Mic className="h-8 w-8" /> : <Square className="h-7 w-7" />}
                {fase === "gravando" && !pausado && (
                  <span
                    className="absolute inset-0 rounded-full bg-destructive/30 animate-ping"
                    style={{ animationDuration: `${Math.max(0.4, 1 - nivel / 150)}s` }}
                  />
                )}
              </button>
            </div>

            {fase === "pronto" ? (
              <p className="text-sm text-muted-foreground text-center">
                Toque para iniciar a gravação da consulta. Pode pausar quando precisar.
              </p>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <p className="text-lg font-semibold tabular-nums text-foreground">{mmss(segundos)}</p>
                <p className="text-xs text-muted-foreground">{pausado ? "Pausado" : "Gravando…"}</p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={alternarPausa} className="gap-1">
                    {pausado ? <><Play className="h-4 w-4" /> Retomar</> : <><Pause className="h-4 w-4" /> Pausar</>}
                  </Button>
                  <Button size="sm" onClick={pararGravacao} className="gap-1">
                    <Square className="h-4 w-4" /> Encerrar e gerar nota
                  </Button>
                </div>
              </div>
            )}
            {msgErro && <p className="text-xs text-coral">{msgErro}</p>}
          </CardContent>
        </Card>
      )}

      {fase === "enviando" && (
        <Card>
          <CardContent className="py-16 flex flex-col items-center gap-3 text-center">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
            <p className="text-sm font-medium text-foreground">Enviando e gerando a nota clínica…</p>
            <p className="text-xs text-muted-foreground">Você será levado para a revisão. Consultas longas podem levar alguns minutos.</p>
          </CardContent>
        </Card>
      )}

      {fase === "erro" && (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <p className="text-sm text-muted-foreground">{msgErro ?? "Algo deu errado. Tente novamente."}</p>
            <Button variant="outline" onClick={() => { setMsgErro(null); setFase("pronto") }} className="gap-1">
              <RotateCcw className="h-4 w-4" /> Tentar novamente
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
