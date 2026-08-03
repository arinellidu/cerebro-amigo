import Link from "next/link"
import type { ComponentType } from "react"
import {
  CalendarClock,
  ChevronRight,
  ClipboardCheck,
  Pill,
  Smile,
  Sparkles,
} from "lucide-react"
import type { TomadaHoje } from "@/components/portal/meds-hoje"

interface ProxConsulta {
  iniciaEm: string
  modalidade: string
  status: string
}

export interface FaixaDoDiaProps {
  checkinsPendentes: number
  jaRegistrouHumorHoje: boolean
  ultimoHumor: number | null
  tomadasHoje: TomadaHoje[]
  proxConsulta: ProxConsulta | null
}

type TomadaPendente = TomadaHoje & { horarioLabel: string }

type Prioridade =
  | { kind: "checkins"; qtd: number }
  | { kind: "med"; tomada: TomadaPendente }
  | { kind: "humor" }
  | { kind: "consulta"; consulta: ProxConsulta; quando: string; relativo: string }
  | { kind: "tranquilo"; humorBaixo: boolean }

function horaCurta(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
}

function diaSemana(iso?: string) {
  const d = iso ? new Date(iso) : new Date()
  return d.toLocaleDateString("pt-BR", { weekday: "long" })
}

function resolverPrioridade(props: FaixaDoDiaProps): Prioridade {
  if (props.checkinsPendentes > 0) {
    return { kind: "checkins", qtd: props.checkinsPendentes }
  }

  const medPendente = props.tomadasHoje.find((t) => t.status === "pendente")
  if (medPendente) {
    return {
      kind: "med",
      tomada: { ...medPendente, horarioLabel: horaCurta(medPendente.horarioPrevisto) },
    }
  }

  if (!props.jaRegistrouHumorHoje) {
    return { kind: "humor" }
  }

  if (props.proxConsulta) {
    const inicia = new Date(props.proxConsulta.iniciaEm)
    const diffMs = inicia.getTime() - Date.now()
    const diffHoras = diffMs / 3_600_000
    if (diffHoras <= 48 && diffHoras > -1) {
      const hoje = new Date()
      const amanha = new Date(hoje)
      amanha.setDate(amanha.getDate() + 1)
      const mesmoDia = inicia.toDateString() === hoje.toDateString()
      const ehAmanha = inicia.toDateString() === amanha.toDateString()
      const relativo = mesmoDia ? "Hoje" : ehAmanha ? "Amanhã" : "Em breve"
      const quando = mesmoDia
        ? `às ${horaCurta(props.proxConsulta.iniciaEm)}`
        : inicia.toLocaleDateString("pt-BR", {
            weekday: "long",
            day: "numeric",
            month: "short",
          }) + ` · ${horaCurta(props.proxConsulta.iniciaEm)}`
      return { kind: "consulta", consulta: props.proxConsulta, quando, relativo }
    }
  }

  return {
    kind: "tranquilo",
    humorBaixo: props.ultimoHumor != null && props.ultimoHumor <= 4,
  }
}

type Tone = "warning" | "primary" | "accent" | "success"

const TONE_BORDER: Record<Tone, string> = {
  warning: "border-warning/35",
  primary: "border-primary/35",
  accent: "border-accent/35",
  success: "border-success/30",
}

const TONE_GLOW: Record<Tone, string> = {
  warning: "bg-[radial-gradient(80%_120%_at_85%_-10%,rgba(251,191,36,0.16),transparent_60%)]",
  primary: "bg-[radial-gradient(80%_120%_at_85%_-10%,rgba(148,134,201,0.18),transparent_60%)]",
  accent: "bg-[radial-gradient(80%_120%_at_85%_-10%,rgba(229,115,115,0.16),transparent_60%)]",
  success: "bg-[radial-gradient(80%_120%_at_85%_-10%,rgba(52,211,153,0.14),transparent_60%)]",
}

// Hero editorial — uma prioridade por vez (“Cuidado noturno”, Tier 3).
export function FaixaDoDia(props: FaixaDoDiaProps) {
  const p = resolverPrioridade(props)
  const dia = diaSemana(props.proxConsulta?.iniciaEm)

  if (p.kind === "checkins") {
    return (
      <FaixaShell tone="warning" dia={dia}>
        <FaixaIcon icon={ClipboardCheck} tone="warning" />
        <FaixaCopy
          titulo={p.qtd === 1 ? "1 check-in pendente" : `${p.qtd} check-ins pendentes`}
          subtitulo="Respostas rápidas da sua psiquiatra — leva poucos minutos."
          href="/p/checkins"
          cta="Responder agora"
          badge={String(p.qtd)}
        />
      </FaixaShell>
    )
  }

  if (p.kind === "med") {
    return (
      <FaixaShell tone="warning" dia={dia}>
        <FaixaIcon icon={Pill} tone="warning" />
        <FaixaCopy
          titulo={`Hora da ${p.tomada.medicamento}`}
          subtitulo={`${p.tomada.dose} · previsto ${p.tomada.horarioLabel}. Confirme abaixo quando tomar.`}
          href="/p/medicacoes"
          cta="Ver medicações"
        />
      </FaixaShell>
    )
  }

  if (p.kind === "humor") {
    return (
      <FaixaShell tone="primary" dia={dia}>
        <FaixaIcon icon={Smile} tone="primary" />
        <FaixaCopy
          titulo="Como você está hoje?"
          subtitulo="Um check-in de humor leva segundos e ajuda entre consultas."
          href="/p/humor"
          cta="Registrar humor"
        />
      </FaixaShell>
    )
  }

  if (p.kind === "consulta") {
    return (
      <FaixaShell tone="primary" dia={dia}>
        <FaixaIcon icon={CalendarClock} tone="primary" />
        <FaixaCopy
          titulo={`Consulta ${p.relativo.toLowerCase()}`}
          subtitulo={`${p.quando} · ${p.consulta.modalidade}${
            p.consulta.status === "agendada" ? " · aguardando confirmação" : ""
          }`}
          href="/p/agenda"
          cta="Ver agenda"
        />
      </FaixaShell>
    )
  }

  return (
    <FaixaShell tone={p.humorBaixo ? "accent" : "success"} dia={dia}>
      <FaixaIcon icon={Sparkles} tone={p.humorBaixo ? "accent" : "success"} />
      <FaixaCopy
        titulo={p.humorBaixo ? "Estamos acompanhando você" : "Seu dia está em dia"}
        subtitulo={
          p.humorBaixo
            ? "Se precisar desabafar, a conversa está aqui. Sua psiquiatra é avisada em risco."
            : "Humor registrado, meds em dia. Converse ou escreva no diário quando quiser."
        }
        href="/p/conversa"
        cta="Abrir conversa"
      />
    </FaixaShell>
  )
}

function FaixaShell({
  tone,
  dia,
  children,
}: {
  tone: Tone
  dia: string
  children: React.ReactNode
}) {
  return (
    <section
      className={`portal-card portal-hairline portal-rise-in portal-stagger-1 relative overflow-hidden p-5 ${TONE_BORDER[tone]}`}
    >
      <span aria-hidden className={`pointer-events-none absolute inset-0 ${TONE_GLOW[tone]}`} />
      <div className="relative">
        <p className="portal-eyebrow mb-3.5 capitalize">Seu dia · {dia}</p>
        <div className="flex items-start gap-4">{children}</div>
      </div>
    </section>
  )
}

function FaixaIcon({
  icon: Icon,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>
  tone: Tone
}) {
  const cls = {
    warning: "bg-warning/15 text-warning ring-warning/20",
    primary: "bg-primary/15 text-primary ring-primary/20",
    accent: "bg-accent/15 text-accent ring-accent/20",
    success: "bg-success/15 text-success ring-success/20",
  }[tone]
  return (
    <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ring-1 ${cls}`}>
      <Icon className="h-5 w-5" />
    </div>
  )
}

function FaixaCopy({
  titulo,
  subtitulo,
  href,
  cta,
  badge,
}: {
  titulo: string
  subtitulo: string
  href: string
  cta: string
  badge?: string
}) {
  return (
    <div className="min-w-0 flex-1 space-y-2.5">
      <div className="flex items-start gap-2">
        <h2 className="portal-display text-[1.2rem] font-medium leading-snug text-foreground">
          {titulo}
        </h2>
        {badge && (
          <span className="nums grid h-6 min-w-6 shrink-0 place-items-center rounded-full bg-warning px-1.5 text-[11px] font-bold text-background">
            {badge}
          </span>
        )}
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{subtitulo}</p>
      <Link
        href={href}
        className="group inline-flex items-center gap-1 pt-0.5 text-sm font-medium text-primary transition-colors hover:text-purple-light"
      >
        {cta}
        <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </Link>
    </div>
  )
}
