import Link from "next/link";
import type { Metadata } from "next";
import { Activity, ArrowRight, Cigarette, CloudRain, Heart, Lock, Pill, ShieldCheck, Timer, Wind, Wine, Zap } from "lucide-react";
import { ComoFunciona } from "@/components/landing-blocks";
import { InstagramCta } from "@/components/instagram-cta";
import { InstagramPopup } from "@/components/instagram-popup";
import { Logo } from "@/components/logo";
import { NeuralField } from "@/components/neural-field";

export const metadata: Metadata = {
  title: "Check-up Mental Gratuito — Triagem de Saúde Mental",
  description:
    "Escolha o teste de triagem que mais se aplica ao que você está sentindo. Gratuito, anônimo e baseado em instrumentos clínicos validados.",
};

const TESTES = [
  {
    href: "/depressao",
    icon: CloudRain,
    titulo: "Depressão",
    instrumento: "PHQ-9",
    descricao:
      "Para quando você está se sentindo para baixo, sem energia ou sem prazer nas coisas.",
    duracao: "~3 min",
    acao: "Fazer teste de depressão",
  },
  {
    href: "/ansiedade",
    icon: Wind,
    titulo: "Ansiedade",
    instrumento: "GAD-7",
    descricao:
      "Para quando a preocupação está tomando conta, com tensão, dificuldade de relaxar ou até mesmo palpitações e tremores em situações cotidianas.",
    duracao: "~2 min",
    acao: "Fazer teste de ansiedade",
  },
  {
    href: "/tdah-adulto",
    icon: Zap,
    titulo: "TDAH (adulto)",
    instrumento: "ASRS-18",
    descricao:
      "Para quando foco e impulsividade são um desafio constante no dia a dia.",
    duracao: "~5 min",
    acao: "Ver mais sobre TDAH",
  },
  {
    href: "/bipolaridade",
    icon: Activity,
    titulo: "Bipolaridade",
    instrumento: "MDQ",
    descricao:
      "Para quando períodos de energia e ânimo muito acima do habitual chamam atenção — sua ou de quem convive com você.",
    duracao: "~3 min",
    acao: "Fazer teste de bipolaridade",
  },
  {
    href: "/borderline",
    icon: Heart,
    titulo: "Traços borderline",
    instrumento: "MSI-BPD",
    descricao:
      "Para quando emoções intensas, relações instáveis e medo de abandono pesam no dia a dia.",
    duracao: "~2 min",
    acao: "Fazer teste de traços borderline",
  },
  {
    href: "/alcool",
    icon: Wine,
    titulo: "Uso de álcool",
    instrumento: "AUDIT (OMS)",
    descricao:
      "Para entender em que zona de risco está o seu padrão de consumo — antes que ele decida por você.",
    duracao: "~3 min",
    acao: "Fazer teste de uso de álcool",
  },
  {
    href: "/tabagismo",
    icon: Cigarette,
    titulo: "Tabagismo",
    instrumento: "Fagerström",
    descricao:
      "Para medir o grau de dependência de nicotina — o primeiro passo de quem pensa em parar.",
    duracao: "~1 min",
    acao: "Fazer teste de tabagismo",
  },
  {
    href: "/drogas",
    icon: Pill,
    titulo: "Uso de substâncias",
    instrumento: "ASSIST (OMS)",
    descricao:
      "Para avaliar, substância por substância, o risco do seu padrão de uso — com perguntas que se adaptam às suas respostas.",
    duracao: "2–5 min",
    acao: "Fazer teste de substâncias",
  },
] as const;

const CONFIANCA = [
  { icon: ShieldCheck, label: "Instrumentos clínicos validados" },
  { icon: Lock, label: "Anônimo, sem cadastro" },
  { icon: Timer, label: "Resultado na hora" },
] as const;

export default function HomePage() {
  return (
    <main className="landing-aurora relative mx-auto w-full max-w-2xl px-4 pb-20 pt-16 sm:px-6 sm:pt-24">
      {/* Campo neural (canvas 2D) — mesmo efeito de fundo da página de login do
          site principal (apps/web). Camada fixa cobrindo a viewport, atrás do
          conteúdo e sobre a aurora/grid (.noir-backdrop/.noir-grid, z -10).
          Cursor-reativo no desktop; mobile cai na aurora CSS. */}
      <div
        className="pointer-events-none fixed inset-0 opacity-60"
        style={{ zIndex: -5 }}
        aria-hidden
      >
        <NeuralField />
      </div>

      {/* CTA Instagram no topo (home não é superfície de crise — /crise é isolada). */}
      <InstagramCta className="reveal mb-8" />

      {/* Popup de entrada (1x por visitante; só na home, mesma regra de crise acima). */}
      <InstagramPopup />

      {/* Hero */}
      <div className="mb-12 text-center">
        <p className="eyebrow reveal mb-4">Check-up Mental · gratuito e anônimo</p>
        <h1 className="reveal reveal-1 mx-auto mb-5 max-w-xl font-display text-[2.6rem] font-semibold leading-[1.1] text-foreground sm:text-6xl">
          Como você está{" "}
          <em className="text-aurora not-italic">se sentindo?</em>
        </h1>
        <p className="reveal reveal-2 mx-auto max-w-lg text-lg leading-relaxed text-muted-foreground">
          Escolha a triagem que mais combina com o que você está sentindo.
          Baseada em instrumentos clínicos validados — resultado na hora.
        </p>

        <ul className="reveal reveal-3 mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2.5">
          {CONFIANCA.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-center gap-2 text-xs text-secondary-foreground">
              <Icon className="h-3.5 w-3.5 text-purple-light" aria-hidden />
              {label}
            </li>
          ))}
        </ul>
      </div>

      {/* Cards das triagens */}
      <div className="space-y-4">
        {TESTES.map((t, i) => {
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`glass-noir-deep group block rounded-3xl p-6 transition-all duration-300 hover:-translate-y-1 hover:border-purple/40 hover:[box-shadow:0_0_56px_-14px_var(--noir-glow-purple)] sm:p-7 reveal reveal-${i + 3}`}
            >
              <div className="flex items-start gap-5">
                <span
                  className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-purple/25 bg-purple/10 text-purple-light transition-colors group-hover:bg-purple/20"
                  aria-hidden
                >
                  <Icon className="h-6 w-6" />
                </span>
                <div className="flex-1">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-foreground">{t.titulo}</h2>
                    <span className="rounded-full bg-secondary px-2.5 py-0.5 font-mono text-[0.68rem] tracking-wide text-secondary-foreground">
                      {t.instrumento}
                    </span>
                    <span className="text-xs text-muted-foreground">{t.duracao}</span>
                  </div>
                  <p className="mb-3 text-sm leading-relaxed text-muted-foreground">
                    {t.descricao}
                  </p>
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-purple-light">
                    {t.acao}
                    <ArrowRight
                      className="h-4 w-4 transition-transform group-hover:translate-x-1"
                      aria-hidden
                    />
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      <p className="reveal reveal-5 mt-8 text-center text-xs text-muted-foreground">
        Anônimo por padrão · nenhum cadastro necessário
      </p>

      {/* Como funciona */}
      <div className="mt-16">
        <ComoFunciona />
      </div>

      {/* Cérebro Amigo em evidência */}
      <section className="glass-noir-deep relative mt-4 overflow-hidden rounded-3xl p-8 text-center sm:p-10">
        <div className="aurora pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative space-y-4">
          <Logo size="lg" href={null} />
          <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
            O Check-up Mental é oferecido pelo <strong className="text-foreground">Cérebro Amigo</strong> —
            a plataforma que ajuda psiquiatras a acompanhar pacientes entre as consultas.
          </p>
          <a
            href="https://www.cerebroamigo.com.br"
            className="btn-ghost-noir text-sm"
          >
            Conhecer a plataforma
            <ArrowRight className="h-4 w-4" aria-hidden />
          </a>
        </div>
      </section>
    </main>
  );
}
