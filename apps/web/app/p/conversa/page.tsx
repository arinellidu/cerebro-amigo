"use client"

import { useRef, useState, useEffect } from "react"
import { Send, Loader2 } from "lucide-react"
import {
  IndicadorCuidado,
  avancarEtapa,
  etapaDeNode,
  type EtapaCuidado,
} from "@/components/portal/indicador-cuidado"
import { CrisisSupportPanel } from "@/components/portal/crisis-support-panel"

type Papel = "user" | "assistant" | "crise" | "sistema"
interface Msg {
  papel: Papel
  texto: string
}

interface NodePayload {
  name?: string
  status?: string
}

interface CompletePayload {
  conversa_status?: string
  resposta_final?: string | null
  enviado?: boolean
  crise?: { detectada?: boolean; nivel?: string } | null
}

interface MsgHistorico {
  id: string
  papel: string
  conteudo: string
  criadaEm: string
}

const SAUDACAO =
  "Oi! Pode me contar como você está se sentindo. Vou organizar e, se precisar, sua psiquiatra é avisada."

function mapPapel(p: string): Papel {
  const x = p.toLowerCase()
  if (x === "user" || x === "paciente") return "user"
  if (x === "assistant" || x === "assistente") return "assistant"
  return "sistema"
}

export default function ConversaPage() {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [carregandoHist, setCarregandoHist] = useState(true)
  const [input, setInput] = useState("")
  const [etapa, setEtapa] = useState<EtapaCuidado | null>(null)
  const [pausado, setPausado] = useState(false)
  const fimRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let vivo = true
    fetch("/api/paciente/conversation")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: MsgHistorico[]) => {
        if (!vivo) return
        if (Array.isArray(rows) && rows.length > 0) {
          setMsgs(rows.map((m) => ({ papel: mapPapel(m.papel), texto: m.conteudo })))
        } else {
          setMsgs([{ papel: "assistant", texto: SAUDACAO }])
        }
      })
      .catch(() => {
        if (vivo) setMsgs([{ papel: "assistant", texto: SAUDACAO }])
      })
      .finally(() => {
        if (vivo) setCarregandoHist(false)
      })
    return () => {
      vivo = false
    }
  }, [])

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [msgs, etapa, carregandoHist])

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    const texto = input.trim()
    if (!texto || etapa !== null || pausado) return

    setMsgs((m) => [...m, { papel: "user", texto }])
    setInput("")
    setEtapa("lendo")

    try {
      const res = await fetch("/api/paciente/conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mensagem: texto, idempotencyKey: crypto.randomUUID() }),
      })

      if (!res.ok || !res.body) {
        finalizarSistema("Não consegui processar agora. Tente de novo em instantes.")
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ""
      let concluido = false

      while (!concluido) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let idx: number
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const bloco = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          concluido = tratarEvento(bloco) || concluido
        }
      }
      if (!concluido) finalizarSistema("Conexão interrompida. Tente novamente.")
    } catch {
      finalizarSistema("Erro de conexão. Tente novamente.")
    } finally {
      setEtapa(null)
    }
  }

  function tratarEvento(bloco: string): boolean {
    let evento = ""
    let data = ""
    for (const linha of bloco.split("\n")) {
      if (linha.startsWith("event:")) evento = linha.slice(6).trim()
      else if (linha.startsWith("data:")) data += linha.slice(5).trim()
    }

    if (evento === "node") {
      try {
        const payload = JSON.parse(data) as NodePayload
        if (payload.name && payload.status) {
          const nova = etapaDeNode(payload.name, payload.status)
          if (nova) setEtapa((atual) => avancarEtapa(atual, nova))
        }
      } catch {
        /* ignora */
      }
      return false
    }

    if (evento === "token") {
      setEtapa((atual) => avancarEtapa(atual, "organizando"))
      return false
    }

    if (evento === "error") {
      finalizarSistema("Tive um problema para responder. Sua psiquiatra pode ser acionada se necessário.")
      return true
    }

    if (evento === "complete") {
      let payload: CompletePayload = {}
      try {
        payload = JSON.parse(data)
      } catch {
        /* ignora */
      }
      revelarFinal(payload)
      return true
    }

    return false
  }

  function revelarFinal(p: CompletePayload) {
    if (p.crise?.detectada && p.resposta_final) {
      setMsgs((m) => [...m, { papel: "crise", texto: p.resposta_final as string }])
      setPausado(true)
      return
    }
    if (p.resposta_final) {
      setMsgs((m) => [...m, { papel: "assistant", texto: p.resposta_final as string }])
      return
    }
    setMsgs((m) => [
      ...m,
      { papel: "sistema", texto: "Sua mensagem foi encaminhada à sua psiquiatra. Ela vai te responder." },
    ])
    if (p.conversa_status === "humano") setPausado(true)
  }

  function finalizarSistema(texto: string) {
    setMsgs((m) => [...m, { papel: "sistema", texto }])
  }

  return (
    <div className="flex h-[calc(100dvh-7rem)] flex-col">
      <header className="space-y-2.5 border-b border-noir-line/60 px-5 pb-3.5 pt-7">
        <div>
          <p className="portal-eyebrow">Entre consultas</p>
          <h1 className="portal-display mt-1.5 text-[1.4rem] font-medium leading-tight text-foreground">
            Conversa
          </h1>
        </div>
        <p className="rounded-xl border border-noir-line/60 bg-noir-surface-raised/50 px-3.5 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
          Organizo e acolho entre consultas.{" "}
          <span className="text-foreground/80">
            Não substituo sua psiquiatra — não dou diagnóstico nem oriento dose de medicamento.
          </span>{" "}
          Sua psiquiatra é avisada em caso de risco.
        </p>
      </header>

      <div className="flex-1 space-y-3.5 overflow-y-auto px-4 py-5">
        {carregandoHist ? (
          <div className="flex justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          msgs.map((m, i) => <Bolha key={i} msg={m} />)
        )}
        {etapa !== null && <IndicadorCuidado etapa={etapa} />}
        <div ref={fimRef} />
      </div>

      {pausado ? (
        <div className="border-t border-noir-line/60 bg-secondary/40 px-4 py-3.5 text-center text-sm text-muted-foreground">
          Conversa pausada — sua psiquiatra foi avisada e vai te acompanhar a partir daqui.
        </div>
      ) : (
        <form
          onSubmit={enviar}
          className="flex items-end gap-2 border-t border-noir-line/60 bg-background/40 p-3 backdrop-blur-sm"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                enviar(e)
              }
            }}
            rows={1}
            placeholder="Escreva como você está…"
            disabled={etapa !== null || carregandoHist}
            className="max-h-32 flex-1 resize-none rounded-2xl border border-noir-line bg-noir-surface-raised/70 px-4 py-2.5 text-sm leading-relaxed focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={etapa !== null || !input.trim() || carregandoHist}
            className="portal-tap portal-fab grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary to-purple-dark text-primary-foreground disabled:opacity-40 disabled:shadow-none"
            aria-label="Enviar"
          >
            <Send className="h-[1.15rem] w-[1.15rem]" />
          </button>
        </form>
      )}
    </div>
  )
}

function Bolha({ msg }: { msg: Msg }) {
  if (msg.papel === "crise") {
    return <CrisisSupportPanel texto={msg.texto} compacto />
  }
  if (msg.papel === "sistema") {
    return (
      <p className="mx-auto max-w-[85%] rounded-full border border-noir-line/50 bg-noir-surface-raised/60 px-3.5 py-1.5 text-center text-xs text-muted-foreground">
        {msg.texto}
      </p>
    )
  }
  const eUser = msg.papel === "user"
  return (
    <div className={`flex ${eUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[82%] whitespace-pre-line px-4 py-2.5 text-sm leading-relaxed ${
          eUser
            ? "rounded-[1.25rem] rounded-br-md bg-gradient-to-br from-primary to-purple-dark text-primary-foreground shadow-[0_8px_24px_-12px_var(--noir-glow-purple)]"
            : "glass-noir rounded-[1.25rem] rounded-bl-md text-foreground"
        }`}
      >
        {msg.texto}
      </div>
    </div>
  )
}
