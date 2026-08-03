"use client"

import { useEffect, useState } from "react"
import { Header } from "@/components/header"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Search, Loader2, ShieldCheck, MessageSquare, Bot, User, Stethoscope, type LucideIcon } from "lucide-react"
import { tempoRelativo } from "@/lib/tempo"
import { iniciais } from "@/lib/iniciais"
import { EscalacaoInbox } from "@/components/escalacao/escalacao-inbox"
import { RascunhoAdmin } from "@/components/comunicacao/rascunho-admin"

interface ConversaInbox {
  pacienteId: string
  pacienteNome: string | null
  ultimaMensagem: string
  ultimaEm: string
  ultimoPapel: string
  total: number
}
interface Mensagem {
  id: string
  papel: string
  conteudo: string
  criadaEm: string
}

function horaMin(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
}

// ── Subcomponentes ──────────────────────────────────────────────────────────
// Extraídos p/ manter a profundidade de cada árvore JSX ≤ 4 (regra do DeepSource);
// a página é um layout de 2 painéis naturalmente profundo.

function Spinner() {
  return (
    <div className="flex justify-center py-10 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  )
}

function InboxSearch({ busca, onBusca }: { busca: string; onBusca: (v: string) => void }) {
  return (
    <div className="border-b border-border/60 p-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar paciente"
          value={busca}
          onChange={(e) => onBusca(e.target.value)}
          className="pl-9"
        />
      </div>
    </div>
  )
}

function InboxItem({ c, ativo, onClick }: { c: ConversaInbox; ativo: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-start gap-3 border-b border-border/40 px-4 py-3 text-left transition-colors hover:bg-primary/[0.04] ${
        ativo ? "bg-primary/[0.06]" : ""
      }`}
    >
      <Avatar className="h-10 w-10 border-2 border-primary/15">
        <AvatarFallback className="bg-secondary text-xs font-semibold text-primary">
          {iniciais(c.pacienteNome, "?")}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-foreground">{c.pacienteNome ?? "Paciente"}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">{tempoRelativo(c.ultimaEm)}</span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {c.ultimoPapel === "assistant" ? "Assistente: " : ""}
          {c.ultimaMensagem}
        </p>
      </div>
    </button>
  )
}

function InboxList({
  carregando, itens, selId, onAbrir,
}: {
  carregando: boolean
  itens: ConversaInbox[]
  selId: string | undefined
  onAbrir: (c: ConversaInbox) => void
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {carregando ? (
        <Spinner />
      ) : itens.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">Nenhuma conversa ainda.</p>
      ) : (
        itens.map((c) => (
          <InboxItem key={c.pacienteId} c={c} ativo={selId === c.pacienteId} onClick={() => onAbrir(c)} />
        ))
      )}
    </div>
  )
}

function MensagensInbox(props: {
  busca: string
  onBusca: (v: string) => void
  carregando: boolean
  itens: ConversaInbox[]
  selId: string | undefined
  onAbrir: (c: ConversaInbox) => void
}) {
  return (
    <aside className="flex min-h-0 flex-col border-r border-border/60">
      <InboxSearch busca={props.busca} onBusca={props.onBusca} />
      <InboxList carregando={props.carregando} itens={props.itens} selId={props.selId} onAbrir={props.onAbrir} />
    </aside>
  )
}

function ThreadVazio() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
      <MessageSquare className="h-8 w-8 opacity-40" />
      <p className="text-sm">Selecione uma conversa para revisar.</p>
    </div>
  )
}

function ThreadHeader({ sel }: { sel: ConversaInbox }) {
  return (
    <div className="flex items-center gap-3 border-b border-border/60 bg-background px-5 py-3">
      <Avatar className="h-9 w-9 border-2 border-primary/15">
        <AvatarFallback className="bg-secondary text-xs font-semibold text-primary">
          {iniciais(sel.pacienteNome, "?")}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1">
        <p className="text-sm font-semibold text-foreground">{sel.pacienteNome ?? "Paciente"}</p>
        <p className="text-xs text-muted-foreground">{sel.total} mensagens</p>
      </div>
      <Badge variant="outline" className="gap-1 text-xs">
        <ShieldCheck className="h-3 w-3" /> Revisão
      </Badge>
    </div>
  )
}

// Config por papel da mensagem. Paciente à esquerda; automação/médico à direita.
// Backward-compatible: papéis desconhecidos caem em "assistente".
type PapelCfg = { lado: "dir" | "esq"; nome: string; Icon: LucideIcon; bolha: string; meta: string }

function papelCfg(papel: string): PapelCfg {
  const p = papel.toLowerCase()
  if (p === "user" || p === "paciente") {
    return {
      lado: "esq",
      nome: "Paciente",
      Icon: User,
      bolha: "border border-border/60 bg-background text-foreground",
      meta: "text-muted-foreground",
    }
  }
  if (p === "medico" || p === "profissional" || p === "human" || p === "doctor") {
    return {
      lado: "dir",
      nome: "Médico",
      Icon: Stethoscope,
      bolha: "border border-success/30 bg-success/10 text-foreground",
      meta: "text-success",
    }
  }
  return {
    lado: "dir",
    nome: "Assistente",
    Icon: Bot,
    bolha: "bg-primary text-primary-foreground",
    meta: "text-primary-foreground/70",
  }
}

function MessageBubble({ m }: { m: Mensagem }) {
  const cfg = papelCfg(m.papel)
  return (
    <div className={`flex ${cfg.lado === "dir" ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[78%] rounded-2xl px-4 py-2.5 ${cfg.bolha}`}>
        <div className={`mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide ${cfg.meta}`}>
          <cfg.Icon className="h-3 w-3" />
          {cfg.nome}
          <span className="font-normal normal-case opacity-70">· {horaMin(m.criadaEm)}</span>
        </div>
        <p className="whitespace-pre-line text-sm leading-relaxed normal-case">{m.conteudo}</p>
      </div>
    </div>
  )
}

function ThreadMessages({ carregando, thread }: { carregando: boolean; thread: Mensagem[] }) {
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
      {carregando ? (
        <Spinner />
      ) : thread.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Sem mensagens.</p>
      ) : (
        thread.map((m) => <MessageBubble key={m.id} m={m} />)
      )}
    </div>
  )
}

function AvisoRevisao() {
  return (
    <div className="flex items-start gap-2 border-t border-border/60 bg-background px-5 py-3 text-xs text-muted-foreground">
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <p>
        Console de revisão. As respostas ao paciente são conduzidas pela automação e pelo portal, com
        auditoria — a decisão clínica é sempre sua.
      </p>
    </div>
  )
}

function MensagensThread({
  sel, thread, carregandoThread,
}: {
  sel: ConversaInbox | null
  thread: Mensagem[]
  carregandoThread: boolean
}) {
  return (
    <section className="flex min-h-0 flex-col bg-muted/20">
      {!sel ? (
        <ThreadVazio />
      ) : (
        <>
          <ThreadHeader sel={sel} />
          <ThreadMessages carregando={carregandoThread} thread={thread} />
          <RascunhoAdmin pacienteId={sel.pacienteId} pacienteNome={sel.pacienteNome} />
          <AvisoRevisao />
        </>
      )}
    </section>
  )
}

// ── Página ──────────────────────────────────────────────────────────────────

export default function MensagensPage() {
  const [inbox, setInbox] = useState<ConversaInbox[]>([])
  const [carregandoInbox, setCarregandoInbox] = useState(true)
  const [busca, setBusca] = useState("")

  const [sel, setSel] = useState<ConversaInbox | null>(null)
  const [thread, setThread] = useState<Mensagem[]>([])
  const [carregandoThread, setCarregandoThread] = useState(false)

  useEffect(() => {
    fetch("/api/mensagens")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        const lista = Array.isArray(rows) ? rows : []
        setInbox(lista)
        // Deep-link ?paciente=<id> → abre a conversa dele (se houver).
        const alvo = typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("paciente")
          : null
        const c = alvo ? lista.find((x: ConversaInbox) => x.pacienteId === alvo) : null
        if (c) abrir(c)
      })
      .catch(() => setInbox([]))
      .finally(() => setCarregandoInbox(false))
  }, [])

  function abrir(c: ConversaInbox) {
    setSel(c)
    setCarregandoThread(true)
    setThread([])
    fetch(`/api/mensagens/${c.pacienteId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setThread(Array.isArray(rows) ? rows : []))
      .catch(() => setThread([]))
      .finally(() => setCarregandoThread(false))
  }

  const filtrado = inbox.filter((c) =>
    (c.pacienteNome ?? "").toLowerCase().includes(busca.toLowerCase()),
  )

  // h-screen + flex-col (em vez de min-h-screen + grid de altura fixa 100vh-4rem): o
  // número mágico não batia com o Header (72px) e quebrava com o banner sticky do
  // PaywallGate, expondo o fundo claro do <body>. bg-background pinta o token escuro.
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <Header title="Mensagens" />
      <EscalacaoInbox />
      <div className="grid min-h-0 flex-1 grid-rows-1 grid-cols-1 md:grid-cols-[320px_1fr]">
        <MensagensInbox
          busca={busca}
          onBusca={setBusca}
          carregando={carregandoInbox}
          itens={filtrado}
          selId={sel?.pacienteId}
          onAbrir={abrir}
        />
        <MensagensThread sel={sel} thread={thread} carregandoThread={carregandoThread} />
      </div>
    </div>
  )
}
