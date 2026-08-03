"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Mic, MicOff, Video as VideoIcon, VideoOff, PhoneOff,
  Loader2, AlertCircle, ShieldCheck, UserRound, CircleDot, Copy, Check,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// ─── Tipos ─────────────────────────────────────────────────────────────────

type Papel = "medico" | "paciente"
type Fase = "consentimento" | "conectando" | "aguardando" | "em_chamada" | "encerrada" | "erro"

/** Mensagens de sinalização (offer/answer/ICE) + presença (gerada pelo gateway). */
interface Sinal {
  tipo: "offer" | "answer" | "candidate" | "bye" | "presenca"
  sdp?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
  online?: boolean
}

interface IceServer {
  urls: string[]
  username?: string
  credential?: string
}

export interface SalaVideoProps {
  papel: Papel
  /**
   * Base do BFF para esta consulta:
   *   médico   → /api/consultas/{id}/video
   *   paciente → /api/paciente/agenda/{id}/video
   * Daqui saem {base}/entrar, {base}/sinal e (médico) {base}/encerrar.
   */
  baseUrl: string
  /** Nome do outro participante (exibição). */
  nomePeer?: string
  /** Para onde voltar ao sair. */
  voltarHref: string
}

// ─── Componente ──────────────────────────────────────────────────────────────

/**
 * Sala de teleconsulta WebRTC P2P. A mídia é E2E (DTLS-SRTP) entre os dois
 * navegadores — nunca passa pelo servidor. O gateway só intermedia a
 * sinalização (via SSE+POST do BFF) e nunca grava (ADR-026).
 *
 * Papéis: o médico é o "offerer" (cria a oferta quando vê o paciente online,
 * inclusive em reconexão); o paciente é o "answerer".
 */
function blobParaBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onloadend = () => { const s = String(r.result); resolve(s.slice(s.indexOf(",") + 1)) }
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}

export function SalaVideo({ papel, baseUrl, nomePeer, voltarHref }: SalaVideoProps) {
  const [fase, setFase] = useState<Fase>("consentimento")
  const [erro, setErro] = useState<string | null>(null)
  const [peerOnline, setPeerOnline] = useState(false)
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(true)
  const [linkCopiado, setLinkCopiado] = useState(false)

  // Escriba (ADR-040): paciente consente a gravação; médico grava o áudio (mix
  // local+remoto) e, ao encerrar, envia para transcrição → rascunho factual.
  const [gravacaoConsent, setGravacaoConsent] = useState(false) // paciente (checkbox)
  const [consentido, setConsentido] = useState(false)           // médico (status do paciente)
  const [gravando, setGravando] = useState(false)
  const [enviandoNota, setEnviandoNota] = useState(false)
  const router = useRouter()
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const audioCtxRef = useRef<AudioContext | null>(null)
  const gravandoRef = useRef(false)
  const escribaBase = baseUrl.replace(/\/video$/, "/escriba")
  const consultaId = baseUrl.split("/").filter(Boolean).slice(-2)[0] ?? ""

  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const previewVideoRef = useRef<HTMLVideoElement>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const remoteStreamRef = useRef<MediaStream | null>(null)
  const esRef = useRef<EventSource | null>(null)
  const iceServersRef = useRef<IceServer[]>([])
  const pendentesRef = useRef<RTCIceCandidateInit[]>([]) // ICE chegando antes do remoteDescription
  const ultimaOfertaRef = useRef(0)
  const encerrandoRef = useRef(false)

  const ehOfferer = papel === "medico"
  const outro = papel === "medico" ? "paciente" : "médico"

  // ─── Sinalização (POST opaco; perdas são toleradas, o ICE re-tenta) ────────
  const enviarSinal = useCallback(async (sinal: Sinal) => {
    try {
      await fetch(`${baseUrl}/sinal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sinal),
      })
    } catch {
      /* tolera falha de sinalização */
    }
  }, [baseUrl])

  // ─── Encerrar (limpa tudo) ─────────────────────────────────────────────────
  const encerrar = useCallback((peerDesligou = false) => {
    if (encerrandoRef.current) return
    encerrandoRef.current = true

    if (!peerDesligou) enviarSinal({ tipo: "bye" })
    esRef.current?.close()
    pcRef.current?.close()
    localStreamRef.current?.getTracks().forEach((t) => t.stop())

    // Só o médico fecha a sala no servidor (o desfecho é registrado à parte).
    if (papel === "medico" && !peerDesligou) {
      fetch(`${baseUrl}/encerrar`, { method: "POST" }).catch(() => {})
    }
    setFase("encerrada")
  }, [baseUrl, papel, enviarSinal])

  // ─── (Re)cria o RTCPeerConnection ──────────────────────────────────────────
  const criarPc = useCallback(() => {
    pcRef.current?.close()
    pendentesRef.current = []

    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current })
    pcRef.current = pc

    localStreamRef.current?.getTracks().forEach((t) =>
      pc.addTrack(t, localStreamRef.current!),
    )

    pc.onicecandidate = (e) => {
      if (e.candidate) enviarSinal({ tipo: "candidate", candidate: e.candidate.toJSON() })
    }
    pc.ontrack = (e) => {
      const [stream] = e.streams
      if (!stream) return
      remoteStreamRef.current = stream
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = stream
    }
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState
      if (st === "connected") { setErro(null); setFase("em_chamada") }
      else if (st === "failed") setErro(`A conexão de vídeo com o ${outro} falhou. Verifique a rede.`)
    }
    return pc
  }, [enviarSinal, outro])

  const escoarCandidatos = useCallback(async (pc: RTCPeerConnection) => {
    for (const c of pendentesRef.current) {
      try { await pc.addIceCandidate(new RTCIceCandidate(c)) } catch { /* ignora */ }
    }
    pendentesRef.current = []
  }, [])

  const fazerOferta = useCallback(async () => {
    const agora = Date.now()
    if (agora - ultimaOfertaRef.current < 1500) return // debounce de reconexões
    ultimaOfertaRef.current = agora

    const pc = criarPc()
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    enviarSinal({ tipo: "offer", sdp: offer })
  }, [criarPc, enviarSinal])

  // ─── Trata um sinal recebido ───────────────────────────────────────────────
  const tratarSinal = useCallback(async (s: Sinal) => {
    if (s.tipo === "presenca") {
      setPeerOnline(!!s.online)
      if (s.online && ehOfferer) await fazerOferta() // paciente entrou → (re)oferta
      return
    }
    if (s.tipo === "bye") { encerrar(true); return }

    if (s.tipo === "candidate" && s.candidate) {
      const pc = pcRef.current
      if (pc?.remoteDescription) {
        try { await pc.addIceCandidate(new RTCIceCandidate(s.candidate)) } catch { /* ignora */ }
      } else {
        pendentesRef.current.push(s.candidate) // ainda sem remoteDescription
      }
      return
    }

    if (ehOfferer) {
      // Offerer (médico) só recebe answer.
      if (s.tipo === "answer" && s.sdp && pcRef.current) {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(s.sdp))
        await escoarCandidatos(pcRef.current)
      }
    } else {
      // Answerer (paciente) recebe offer e responde.
      if (s.tipo === "offer" && s.sdp) {
        setFase((f) => (f === "em_chamada" ? f : "conectando"))
        const pc = criarPc()
        await pc.setRemoteDescription(new RTCSessionDescription(s.sdp))
        await escoarCandidatos(pc)
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        enviarSinal({ tipo: "answer", sdp: answer })
      }
    }
  }, [ehOfferer, fazerOferta, criarPc, escoarCandidatos, enviarSinal, encerrar])

  // ─── Bootstrap: mídia local → abre sala (iceServers) → SSE ─────────────────
  const iniciar = useCallback(async () => {
    setErro(null)
    setFase("conectando")
    encerrandoRef.current = false

    // Paciente: registra consentimento de gravação p/ o Escriba (se marcado).
    if (papel === "paciente" && gravacaoConsent) {
      try { await fetch(`${escribaBase}/consentir`, { method: "POST" }) } catch { /* opcional */ }
    }

    // Reaproveita o stream do lobby (preview) se já houver — sem 2º prompt.
    let stream = localStreamRef.current
    if (!stream) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      } catch {
        setErro("Câmera/microfone não permitidos. Verifique as permissões do navegador.")
        setFase("erro")
        return
      }
      localStreamRef.current = stream
    }
    if (localVideoRef.current) localVideoRef.current.srcObject = stream

    try {
      const r = await fetch(`${baseUrl}/entrar`, { method: "POST" })
      if (!r.ok) throw new Error()
      const data = await r.json()
      iceServersRef.current = Array.isArray(data?.iceServers) ? data.iceServers : []
    } catch {
      setErro("Não foi possível abrir a sala da teleconsulta. Tente novamente.")
      setFase("erro")
      return
    }

    // EventSource envia o cookie httpOnly automaticamente (same-origin) → o BFF
    // autentica e faz proxy do SSE do gateway.
    const es = new EventSource(`${baseUrl}/sinal`)
    esRef.current = es
    es.onmessage = (ev) => {
      try { void tratarSinal(JSON.parse(ev.data) as Sinal) } catch { /* ignora linha inválida */ }
    }
    es.onerror = () => { /* EventSource reconecta sozinho */ }

    setFase("aguardando")
  }, [baseUrl, tratarSinal, papel, gravacaoConsent, escribaBase])

  // Médico: acompanha o consentimento do paciente p/ habilitar a gravação.
  useEffect(() => {
    if (papel !== "medico") return
    let cancel = false
    fetch(`${escribaBase}/status`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancel && d) setConsentido(!!d.consentido) })
      .catch(() => {})
    return () => { cancel = true }
  }, [papel, escribaBase, peerOnline, fase])

  // Médico: inicia gravação do áudio (mix do mic local + áudio remoto do paciente).
  const iniciarGravacao = useCallback(() => {
    if (papel !== "medico" || gravandoRef.current) return
    try {
      const local = localStreamRef.current
      if (!local) return
      const AC = window.AudioContext
        || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ac = new AC()
      audioCtxRef.current = ac
      const dest = ac.createMediaStreamDestination()
      if (local.getAudioTracks().length) ac.createMediaStreamSource(local).connect(dest)
      const remote = remoteStreamRef.current
      if (remote && remote.getAudioTracks().length) ac.createMediaStreamSource(remote).connect(dest)
      const mime = typeof MediaRecorder !== "undefined"
        && MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : ""
      const rec = new MediaRecorder(dest.stream, mime ? { mimeType: mime } : undefined)
      audioChunksRef.current = []
      rec.ondataavailable = (e) => { if (e.data.size) audioChunksRef.current.push(e.data) }
      rec.start(1000)
      mediaRecorderRef.current = rec
      gravandoRef.current = true
      setGravando(true)
    } catch { /* gravação é opcional — nunca quebra a call */ }
  }, [papel])

  // Médico: para a gravação, encerra a call e envia o áudio p/ gerar a nota.
  const pararEEnviarNota = useCallback(async () => {
    if (encerrandoRef.current) return
    encerrandoRef.current = true
    setEnviandoNota(true)
    enviarSinal({ tipo: "bye" })
    esRef.current?.close()
    if (papel === "medico") fetch(`${baseUrl}/encerrar`, { method: "POST" }).catch(() => {})

    const rec = mediaRecorderRef.current
    const blob: Blob = await new Promise((resolve) => {
      if (!rec) return resolve(new Blob())
      rec.onstop = () => resolve(new Blob(audioChunksRef.current, { type: rec.mimeType || "audio/webm" }))
      try { rec.stop() } catch { resolve(new Blob(audioChunksRef.current)) }
    })
    gravandoRef.current = false
    try { audioCtxRef.current?.close() } catch { /* ignore */ }
    pcRef.current?.close()
    localStreamRef.current?.getTracks().forEach((t) => t.stop())

    try {
      const b64 = await blobParaBase64(blob)
      const res = await fetch(escribaBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64: b64, contentType: blob.type || "audio/webm" }),
      })
      if (res.ok) { router.push(`/dashboard/consultas/${consultaId}/escriba`); return }
    } catch { /* cai pro encerramento normal */ }
    setEnviandoNota(false)
    setFase("encerrada")
  }, [baseUrl, papel, enviarSinal, escribaBase, consultaId, router])

  // ─── Controles ─────────────────────────────────────────────────────────────
  const toggleMic = () => {
    const t = localStreamRef.current?.getAudioTracks()[0]
    if (t) { t.enabled = !t.enabled; setMicOn(t.enabled) }
  }
  const toggleCam = () => {
    const t = localStreamRef.current?.getVideoTracks()[0]
    if (t) { t.enabled = !t.enabled; setCamOn(t.enabled) }
  }

  // Médico: copia o link do paciente (mesma consulta) p/ compartilhar no lobby.
  const copiarLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/p/consulta/${consultaId}`)
      setLinkCopiado(true)
      setTimeout(() => setLinkCopiado(false), 2000)
    } catch { /* clipboard pode falhar sem https/permissão */ }
  }, [consultaId])

  // Lobby: liga câmera/mic p/ preview assim que a tela abre (antes de entrar);
  // iniciar() reaproveita esse stream → sem segundo prompt de permissão.
  useEffect(() => {
    if (fase !== "consentimento" || localStreamRef.current) return
    let cancelado = false
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then((stream) => {
        if (cancelado) { stream.getTracks().forEach((t) => t.stop()); return }
        localStreamRef.current = stream
        if (previewVideoRef.current) previewVideoRef.current.srcObject = stream
      })
      .catch(() => { /* preview é opcional; iniciar() pede a permissão de novo */ })
    return () => { cancelado = true }
  }, [fase])

  // ─── Limpeza ao desmontar ──────────────────────────────────────────────────
  useEffect(() => () => {
    esRef.current?.close()
    pcRef.current?.close()
    localStreamRef.current?.getTracks().forEach((t) => t.stop())
  }, [])

  // Reata os streams aos <video> quando o palco monta — na tela de
  // consentimento esses elementos ainda não existem, então a atribuição
  // feita no getUserMedia/ontrack não encontra o ref.
  useEffect(() => {
    if (previewVideoRef.current && localStreamRef.current && !previewVideoRef.current.srcObject)
      previewVideoRef.current.srcObject = localStreamRef.current
    if (localVideoRef.current && localStreamRef.current && !localVideoRef.current.srcObject)
      localVideoRef.current.srcObject = localStreamRef.current
    if (remoteVideoRef.current && remoteStreamRef.current && !remoteVideoRef.current.srcObject)
      remoteVideoRef.current.srcObject = remoteStreamRef.current
  }, [fase])

  // ─── Render ────────────────────────────────────────────────────────────────

  if (fase === "consentimento") {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-5 px-4 py-12 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <ShieldCheck className="h-7 w-7 text-primary" />
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-semibold text-foreground">Teleconsulta por vídeo</h1>
          <p className="text-sm text-muted-foreground">
            A conversa é privada e <strong>criptografada de ponta a ponta</strong> entre você
            e o {outro}. Confira sua câmera e microfone antes de entrar.
          </p>
        </div>

        {/* Preview da câmera + controles de mic/câmera (lobby) */}
        <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-navy">
          <video
            ref={previewVideoRef}
            autoPlay
            playsInline
            muted
            className={cn("h-full w-full object-cover", !camOn && "opacity-0")}
          />
          {!camOn && (
            <div className="absolute inset-0 flex items-center justify-center text-white/50">
              <VideoOff className="h-8 w-8" />
            </div>
          )}
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2">
            <Button
              type="button"
              size="icon"
              variant={micOn ? "secondary" : "destructive"}
              onClick={toggleMic}
              aria-label={micOn ? "Desligar microfone" : "Ligar microfone"}
            >
              {micOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
            </Button>
            <Button
              type="button"
              size="icon"
              variant={camOn ? "secondary" : "destructive"}
              onClick={toggleCam}
              aria-label={camOn ? "Desligar câmera" : "Ligar câmera"}
            >
              {camOn ? <VideoIcon className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* Médico: link do paciente p/ compartilhar ANTES de entrar na sala. */}
        {papel === "medico" && (
          <div className="w-full rounded-lg border border-primary/20 bg-primary/5 p-3 text-left">
            <p className="mb-2 text-xs text-muted-foreground">
              Envie este link ao paciente para ele entrar na mesma sala:
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={copiarLink}
              className="w-full gap-1.5"
            >
              {linkCopiado ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
              {linkCopiado ? "Link copiado" : "Copiar link do paciente"}
            </Button>
          </div>
        )}

        {papel === "paciente" && (
          <label className="flex items-start gap-2 rounded-lg border border-border/70 bg-secondary/20 p-3 text-left text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={gravacaoConsent}
              onChange={(e) => setGravacaoConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-primary"
            />
            <span>
              Autorizo a gravação do áudio desta consulta para meu médico gerar a nota clínica.
              O áudio é apagado após a transcrição e posso revogar depois. (Opcional)
            </span>
          </label>
        )}
        <div className="flex w-full flex-col gap-2 pt-2">
          <Button onClick={iniciar} size="lg" className="gap-2">
            <VideoIcon className="h-4 w-4" /> Entrar na consulta
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href={voltarHref}>Cancelar</Link>
          </Button>
        </div>
      </div>
    )
  }

  if (enviandoNota) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-5 px-4 py-16 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <h1 className="text-lg font-semibold text-foreground">Gerando nota clínica…</h1>
        <p className="text-sm text-muted-foreground">Transcrevendo o áudio da consulta. Não feche esta janela.</p>
      </div>
    )
  }

  if (fase === "encerrada") {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-5 px-4 py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
          <PhoneOff className="h-7 w-7 text-muted-foreground" />
        </div>
        <h1 className="text-xl font-semibold text-foreground">Chamada encerrada</h1>
        <Button asChild>
          <Link href={voltarHref}>Voltar</Link>
        </Button>
      </div>
    )
  }

  if (fase === "erro") {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-5 px-4 py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
          <AlertCircle className="h-7 w-7 text-destructive" />
        </div>
        <h1 className="text-lg font-semibold text-foreground">Não foi possível conectar</h1>
        <p className="text-sm text-muted-foreground">{erro}</p>
        <div className="flex gap-2">
          <Button onClick={iniciar}>Tentar novamente</Button>
          <Button asChild variant="ghost">
            <Link href={voltarHref}>Sair</Link>
          </Button>
        </div>
      </div>
    )
  }

  // conectando | aguardando | em_chamada → palco de vídeo
  const aguardando = fase !== "em_chamada"
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-navy">
      {/* Vídeo remoto (palco) */}
      <div className="relative flex-1 overflow-hidden">
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          // object-contain: mostra o frame inteiro do outro (sem zoom/crop) quando
          // os aspect-ratios diferem (celular retrato × notebook paisagem). As barras
          // ficam na cor do fundo (bg-navy).
          className={cn("h-full w-full object-contain", aguardando && "opacity-0")}
        />

        {/* Estado enquanto o outro não conecta */}
        {aguardando && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center text-white/80">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10">
              <UserRound className="h-8 w-8" />
            </div>
            <p className="text-sm font-medium">
              {nomePeer ? nomePeer : `Aguardando o ${outro}`}
            </p>
            <p className="flex items-center gap-2 text-xs text-white/60">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {peerOnline ? "Conectando vídeo…" : `Aguardando o ${outro} entrar…`}
            </p>
          </div>
        )}

        {/* Vídeo local (PiP) */}
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="absolute bottom-4 right-4 h-32 w-24 rounded-lg border border-white/20 object-cover shadow-lg sm:h-40 sm:w-28"
        />

        {/* Selo de estado (E2E / gravando p/ nota) */}
        <div className="absolute left-4 top-4 flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1 text-[11px] text-white/80 backdrop-blur">
          {gravando ? (
            <><CircleDot className="h-3.5 w-3.5 text-coral" /> gravando p/ nota</>
          ) : (
            <><ShieldCheck className="h-3.5 w-3.5" /> E2E</>
          )}
        </div>
      </div>

      {/* Barra de controles */}
      <div className="flex items-center justify-center gap-3 bg-black/60 py-4 backdrop-blur">
        <button
          type="button"
          onClick={toggleMic}
          aria-label={micOn ? "Desligar microfone" : "Ligar microfone"}
          className={cn(
            "flex h-12 w-12 items-center justify-center rounded-full transition-colors",
            micOn ? "bg-white/15 text-white hover:bg-white/25" : "bg-white text-navy",
          )}
        >
          {micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
        </button>
        <button
          type="button"
          onClick={toggleCam}
          aria-label={camOn ? "Desligar câmera" : "Ligar câmera"}
          className={cn(
            "flex h-12 w-12 items-center justify-center rounded-full transition-colors",
            camOn ? "bg-white/15 text-white hover:bg-white/25" : "bg-white text-navy",
          )}
        >
          {camOn ? <VideoIcon className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
        </button>
        {papel === "medico" && (
          gravando ? (
            <button
              type="button"
              onClick={pararEEnviarNota}
              disabled={enviandoNota}
              className="flex h-12 items-center gap-2 rounded-full bg-coral px-4 text-sm font-medium text-white transition-colors hover:bg-coral/90 disabled:opacity-60"
            >
              <CircleDot className="h-4 w-4" /> Encerrar e gerar nota
            </button>
          ) : (
            <button
              type="button"
              onClick={iniciarGravacao}
              disabled={!consentido}
              title={consentido ? "Gravar áudio para a nota clínica" : "Aguardando consentimento do paciente"}
              className="flex h-12 items-center gap-2 rounded-full bg-white/15 px-4 text-sm font-medium text-white transition-colors hover:bg-white/25 disabled:opacity-40"
            >
              <CircleDot className="h-4 w-4" /> {consentido ? "Gravar p/ nota" : "Sem consentimento"}
            </button>
          )
        )}
        <button
          type="button"
          onClick={() => encerrar(false)}
          aria-label="Encerrar chamada"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive text-destructive-foreground transition-colors hover:bg-destructive/90"
        >
          <PhoneOff className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}
