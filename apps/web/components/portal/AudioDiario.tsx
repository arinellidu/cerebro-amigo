"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Mic, Square, Loader2, RotateCcw, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// ─── Tipos públicos ──────────────────────────────────────────────────────────

export interface TranscricaoResult {
  transcricao: string
  humor_estimado: number | null
  emocao_predominante: string
  tags_sugeridas: string[]
  sintomas_detectados: string[]
  // Triagem de crise (ADR-010): se crise=true, a UI mostra o acolhimento fixo.
  crise?: boolean
  crise_texto?: string | null
}

export interface AudioDiarioProps {
  /** Chamado quando transcrição + análise estão prontas. */
  onTranscricao: (data: TranscricaoResult) => void
  /** Chamado quando o usuário cancela ou descarta. */
  onCancelar?: () => void
  className?: string
}

// ─── Constantes ──────────────────────────────────────────────────────────────

const DURACAO_MAX_S = 60

// Ordem de preferência: opus/webm (Chrome/FF), ogg/opus, mp4/aac (Safari).
// Detecção feita em runtime (dentro de iniciar) — MediaRecorder não existe no SSR.
const MIMES_CANDIDATOS = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4;codecs=aac",
  "audio/mp4",
]

// ─── Componente principal ────────────────────────────────────────────────────

type Fase = "idle" | "gravando" | "processando" | "erro"

export function AudioDiario({ onTranscricao, onCancelar, className }: AudioDiarioProps) {
  const [fase, setFase] = useState<Fase>("idle")
  const [segundos, setSegundos] = useState(DURACAO_MAX_S)
  const [mensagemErro, setMensagemErro] = useState<string | null>(null)
  const [nivelAudio, setNivelAudio] = useState(0) // 0-100, para visualização

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number | null>(null)

  // ─── Limpeza ao desmontar ─────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      timerRef.current && clearInterval(timerRef.current)
      rafRef.current && cancelAnimationFrame(rafRef.current)
      recorderRef.current?.stream?.getTracks().forEach(t => t.stop())
      audioCtxRef.current?.close()
      audioCtxRef.current = null
    }
  }, [])

  // ─── Visualização de nível (waveform simplificado) ────────────────────────

  const iniciarVisualizacao = useCallback((stream: MediaStream) => {
    const ctx = new AudioContext()
    audioCtxRef.current = ctx
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    analyserRef.current = analyser
    ctx.createMediaStreamSource(stream).connect(analyser)

    const buf = new Uint8Array(analyser.frequencyBinCount)
    const tick = () => {
      analyser.getByteFrequencyData(buf)
      const avg = buf.reduce((a, b) => a + b, 0) / buf.length
      setNivelAudio(Math.min(100, Math.round((avg / 128) * 100)))
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [])

  // ─── Iniciar gravação ─────────────────────────────────────────────────────

  const iniciar = async () => {
    setMensagemErro(null)
    let stream: MediaStream

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    } catch {
      setMensagemErro("Microfone não permitido. Verifique as permissões do navegador.")
      setFase("erro")
      return
    }

    const mimeType =
      MIMES_CANDIDATOS.find(m => {
        try { return MediaRecorder.isTypeSupported(m) } catch { return false }
      }) ?? ""

    const recorder = new MediaRecorder(stream, { mimeType })
    recorderRef.current = recorder
    chunksRef.current = []

    recorder.ondataavailable = e => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }

    recorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop())
      rafRef.current && cancelAnimationFrame(rafRef.current)
      audioCtxRef.current?.close()
      audioCtxRef.current = null
      setNivelAudio(0)
      const blob = new Blob(chunksRef.current, { type: mimeType })
      enviar(blob, mimeType)
    }

    recorder.start(200) // chunks a cada 200ms
    setFase("gravando")
    setSegundos(DURACAO_MAX_S)
    iniciarVisualizacao(stream)

    // Countdown + auto-stop
    let restantes = DURACAO_MAX_S
    timerRef.current = setInterval(() => {
      restantes -= 1
      setSegundos(restantes)
      if (restantes <= 0) parar()
    }, 1000)
  }

  // ─── Parar gravação ───────────────────────────────────────────────────────

  const parar = () => {
    timerRef.current && clearInterval(timerRef.current)
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop()
    }
    setFase("processando")
  }

  // ─── Enviar para BFF → gateway → agents-py ───────────────────────────────

  const enviar = async (blob: Blob, mimeType: string) => {
    const ext = mimeType.includes("webm") ? "webm" : mimeType.includes("ogg") ? "ogg" : "mp4"
    const form = new FormData()
    form.append("audio", blob, `gravacao.${ext}`)

    try {
      const res = await fetch("/api/paciente/diario/audio", {
        method: "POST",
        body: form,
      })
      if (!res.ok) {
        // Não propagamos o corpo cru do backend (pode trazer texto técnico/
        // upstream); só o status, que vira telemetria — nunca tela do paciente.
        throw new Error(`HTTP ${res.status}`)
      }
      const data: TranscricaoResult = await res.json()
      onTranscricao(data)
    } catch (e) {
      // Telemetria: registra o erro técnico real para ops (sem o conteúdo
      // transcrito do áudio, que é clínico/PII). Nunca exibir isto na tela.
      console.error("[AudioDiario] falha ao transcrever áudio:", e)
      // Mensagem fixa, acolhedora e segura — nunca o erro cru do backend.
      setMensagemErro(
        "Não consegui transcrever seu áudio agora. Tente gravar de novo em instantes — se preferir, você pode escrever sua entrada no diário pelo teclado.",
      )
      setFase("erro")
    }
  }

  // ─── Resetar ──────────────────────────────────────────────────────────────

  const resetar = () => {
    setFase("idle")
    setSegundos(DURACAO_MAX_S)
    setMensagemErro(null)
    setNivelAudio(0)
  }

  // ─── Renderização ─────────────────────────────────────────────────────────

  return (
    <div className={cn("flex flex-col items-center gap-4 py-6", className)}>
      {/* Indicador visual central */}
      <div className="relative flex items-center justify-center">
        {/* Anel de progresso */}
        {fase === "gravando" && (
          <svg className="absolute -inset-3 w-[88px] h-[88px] -rotate-90" viewBox="0 0 88 88">
            <circle cx="44" cy="44" r="40" fill="none" stroke="currentColor"
              className="text-muted/20" strokeWidth="4" />
            <circle cx="44" cy="44" r="40" fill="none" stroke="currentColor"
              className="text-primary transition-all duration-1000"
              strokeWidth="4"
              strokeDasharray={251.2}
              strokeDashoffset={251.2 * (1 - segundos / DURACAO_MAX_S)}
              strokeLinecap="round" />
          </svg>
        )}

        {/* Botão central */}
        <button
          type="button"
          onClick={fase === "idle" ? iniciar : fase === "gravando" ? parar : undefined}
          disabled={fase === "processando"}
          aria-label={fase === "idle" ? "Iniciar gravação" : "Parar gravação"}
          className={cn(
            "relative w-16 h-16 rounded-full flex items-center justify-center transition-all",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            fase === "idle" && "bg-primary text-primary-foreground hover:bg-primary/90 shadow-md",
            fase === "gravando" && "bg-destructive text-destructive-foreground hover:bg-destructive/90",
            fase === "processando" && "bg-muted text-muted-foreground cursor-not-allowed",
            fase === "erro" && "bg-muted text-muted-foreground cursor-not-allowed",
          )}
        >
          {fase === "idle" && <Mic className="w-7 h-7" />}
          {fase === "gravando" && <Square className="w-6 h-6" />}
          {fase === "processando" && <Loader2 className="w-6 h-6 animate-spin" />}
          {fase === "erro" && <AlertCircle className="w-6 h-6" />}

          {/* Pulso de nível de áudio */}
          {fase === "gravando" && (
            <span
              className="absolute inset-0 rounded-full bg-destructive/30 animate-ping"
              style={{ animationDuration: `${Math.max(0.4, 1 - nivelAudio / 150)}s` }}
            />
          )}
        </button>
      </div>

      {/* Texto de estado */}
      <div className="text-center space-y-1">
        {fase === "idle" && (
          <p className="text-sm text-muted-foreground">
            Toque para gravar. Máximo {DURACAO_MAX_S} segundos.
          </p>
        )}
        {fase === "gravando" && (
          <>
            <p className="text-sm font-medium text-foreground">Gravando…</p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {segundos}s restantes
            </p>
            <p className="text-xs text-muted-foreground">Toque novamente para parar</p>
          </>
        )}
        {fase === "processando" && (
          <>
            <p className="text-sm font-medium">Transcrevendo…</p>
            <p className="text-xs text-muted-foreground">
              Isso pode levar até 30 segundos
            </p>
          </>
        )}
        {fase === "erro" && mensagemErro && (
          <p className="text-sm text-destructive">{mensagemErro}</p>
        )}
      </div>

      {/* Ações secundárias */}
      <div className="flex gap-2">
        {(fase === "erro") && (
          <Button variant="outline" size="sm" onClick={resetar}>
            <RotateCcw className="w-4 h-4 mr-1" />
            Tentar novamente
          </Button>
        )}
        {onCancelar && fase !== "processando" && (
          <Button variant="ghost" size="sm" onClick={onCancelar}>
            Cancelar
          </Button>
        )}
      </div>
    </div>
  )
}
