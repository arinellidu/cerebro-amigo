import Link from "next/link"
import type { ReactNode } from "react"
import { ArrowRight, Check } from "lucide-react"

// Blocos compartilhados das landings de condição (/depressao, /ansiedade, /tdah-adulto).
// Server components, Neural Noir. Textos clínicos vêm de cada página (não daqui).

export function LandingHero({
  icon,
  eyebrow,
  title,
  lead,
  ctaHref,
  ctaLabel,
  badges,
}: {
  icon: ReactNode
  eyebrow: string
  title: string
  lead: string
  ctaHref: string
  ctaLabel: string
  badges: string[]
}) {
  return (
    <div className="relative mb-16 text-center">
      <span className="glass-noir reveal mb-6 inline-flex h-20 w-20 items-center justify-center rounded-2xl text-purple-light [box-shadow:0_0_48px_-16px_var(--noir-glow-purple)]">
        {icon}
      </span>
      <p className="eyebrow reveal reveal-1 mb-4">{eyebrow}</p>
      <h1 className="reveal reveal-1 mx-auto mb-5 max-w-xl font-display text-4xl font-semibold leading-[1.12] text-foreground sm:text-5xl">
        {title}
      </h1>
      <p className="reveal reveal-2 mx-auto mb-9 max-w-xl text-lg leading-relaxed text-muted-foreground">
        {lead}
      </p>
      <div className="reveal reveal-3">
        <Link href={ctaHref} className="btn-noir px-10 text-lg">
          {ctaLabel}
          <ArrowRight className="h-5 w-5" aria-hidden />
        </Link>
        <p className="mt-3 text-xs text-muted-foreground">
          Gratuito · Anônimo · Sem cadastro
        </p>
      </div>
      <div className="reveal reveal-4 mt-6 flex flex-wrap items-center justify-center gap-2">
        {badges.map((b) => (
          <span
            key={b}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--noir-glass-border)] bg-secondary/60 px-3 py-1 text-xs text-secondary-foreground"
          >
            <Check className="h-3 w-3 text-purple-light" aria-hidden />
            {b}
          </span>
        ))}
      </div>
    </div>
  )
}

const PASSOS = [
  { n: "01", t: "Responda no seu ritmo", d: "Uma pergunta por tela, sem pressa. Você pode voltar e revisar." },
  { n: "02", t: "Resultado na hora", d: "Escore com faixa explicada e uma devolutiva acolhedora." },
  { n: "03", t: "Leve ao seu médico", d: "Baixe o relatório em PDF para conversar com um profissional." },
] as const

export function ComoFunciona() {
  return (
    <section className="mb-14">
      <h2 className="mb-6 font-display text-2xl font-semibold text-foreground">Como funciona</h2>
      <ol className="grid gap-3 sm:grid-cols-3">
        {PASSOS.map((p) => (
          <li key={p.n} className="glass-noir rounded-2xl p-5">
            <span className="mb-4 block font-mono text-sm font-semibold tracking-widest text-purple-light">
              {p.n}
            </span>
            <p className="mb-1.5 text-sm font-semibold text-foreground">{p.t}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">{p.d}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}

export function SymptomGrid({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="glass-noir mb-14 rounded-3xl p-6 sm:p-8">
      <h2 className="mb-5 font-display text-2xl font-semibold text-foreground">{title}</h2>
      <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
        {items.map((s) => (
          <li key={s} className="flex gap-3 text-sm leading-relaxed text-muted-foreground">
            <span
              className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-purple/15"
              aria-hidden
            >
              <Check className="h-3 w-3 text-purple-light" />
            </span>
            <span>{s}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function LandingCta({
  title,
  ctaHref,
  ctaLabel,
}: {
  title: string
  ctaHref: string
  ctaLabel: string
}) {
  return (
    <div className="glass-noir-deep relative overflow-hidden rounded-3xl p-8 text-center sm:p-10">
      <div className="aurora pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative">
        <p className="mb-5 font-display text-2xl font-medium leading-snug text-foreground">{title}</p>
        <Link href={ctaHref} className="btn-noir px-10 text-lg">
          {ctaLabel}
          <ArrowRight className="h-5 w-5" aria-hidden />
        </Link>
        <p className="mt-4 text-xs text-muted-foreground">Gratuito · Anônimo · Sem cadastro</p>
      </div>
    </div>
  )
}

// Cross-links padronizados no fim de cada landing — mantém a pessoa no funil
// quando a condição da página não é a que ela procura.
const TODAS_TRIAGENS = [
  { href: "/depressao", titulo: "Depressão", instrumento: "PHQ-9", duracao: "~3 min" },
  { href: "/ansiedade", titulo: "Ansiedade", instrumento: "GAD-7", duracao: "~2 min" },
  { href: "/tdah-adulto", titulo: "TDAH adulto", instrumento: "ASRS-18", duracao: "~5 min" },
  { href: "/bipolaridade", titulo: "Bipolaridade", instrumento: "MDQ", duracao: "~3 min" },
  { href: "/borderline", titulo: "Traços borderline", instrumento: "MSI-BPD", duracao: "~2 min" },
  { href: "/alcool", titulo: "Uso de álcool", instrumento: "AUDIT (OMS)", duracao: "~3 min" },
  { href: "/tabagismo", titulo: "Dependência de nicotina", instrumento: "Fagerström", duracao: "~1 min" },
  { href: "/drogas", titulo: "Uso de substâncias", instrumento: "ASSIST (OMS)", duracao: "2–5 min" },
] as const

export function OutrasTriagens({ current }: { current: string }) {
  const outras = TODAS_TRIAGENS.filter((t) => t.href !== current)
  return (
    <section className="mt-14">
      <p className="mb-4 text-center text-sm text-muted-foreground">
        Não era bem isso que você procurava?
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {outras.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="glass-noir group flex items-center justify-between gap-3 rounded-2xl px-5 py-4 transition-all duration-300 hover:-translate-y-0.5 hover:[box-shadow:0_0_40px_-14px_var(--noir-glow-purple)]"
          >
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-foreground">
                Teste de {t.titulo.toLowerCase()}
              </span>
              <span className="text-xs text-muted-foreground">
                {t.instrumento} · {t.duracao}
              </span>
            </span>
            <ArrowRight
              className="h-4 w-4 shrink-0 text-purple-light transition-transform group-hover:translate-x-1"
              aria-hidden
            />
          </Link>
        ))}
      </div>
    </section>
  )
}
