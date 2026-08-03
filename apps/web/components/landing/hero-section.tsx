'use cache'

import { cacheLife } from 'next/cache'
import Link from "next/link"
import { HeroPreview } from "@/components/landing/hero-preview"
import { AuroraBackdrop } from "@/components/landing/aurora-backdrop"
import { Eyebrow } from "@/components/landing/eyebrow"
import { Reveal } from "@/components/landing/reveal"
import { Button } from "@/components/ui/button"
import { CheckCircle, ArrowRight, Sparkles, HeartHandshake } from "lucide-react"

export async function HeroSection() {
  cacheLife('days')

  return (
    <section className="relative overflow-hidden pt-20 pb-28 lg:pt-28 lg:pb-36">
      {/* Camadas de fundo: aurora field WebGL (magnífico) + grid neural.
          Um único canvas animado por superfície — o shader substitui o
          NeuralField aqui; `.aurora` estático segue de fallback resiliente. */}
      <AuroraBackdrop grid shader intensity={0.9} />
      {/* fade do fundo para o conteúdo respirar */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#07070D] to-transparent" />

      <div className="container mx-auto max-w-7xl px-6 relative">
        <div className="grid items-center gap-16 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14">
          {/* Left */}
          <div className="space-y-8 lg:max-w-xl">
            <Reveal>
              <span className="inline-flex items-center gap-2.5 rounded-full glass-noir border border-noir-line px-4 py-2">
                <Eyebrow icon={Sparkles}>Acompanhamento entre consultas · Psiquiatria</Eyebrow>
              </span>
            </Reveal>

            <Reveal delay={0.06}>
              <h1 className="font-serif font-medium text-foreground text-[3.25rem] sm:text-6xl lg:text-7xl leading-[0.98] tracking-tight text-balance">
                Nenhum retorno começa do{" "}
                <span className="italic text-accent [text-shadow:0_0_40px_var(--noir-glow-coral)]">
                  zero
                </span>
                .
              </h1>
            </Reveal>

            <Reveal delay={0.12}>
              <p className="text-muted-foreground text-lg lg:text-xl leading-relaxed max-w-lg">
                Entre as consultas, o paciente registra humor, sintomas e até{" "}
                <strong className="font-semibold text-foreground">áudios no diário</strong>. Antes
                de cada retorno, a IA entrega um{" "}
                <strong className="font-semibold text-foreground">briefing pronto</strong> —
                evolução, aderência e sinais de risco.
              </p>
            </Reveal>

            <Reveal delay={0.18}>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row gap-4">
                  <Button variant="coral" size="lg" className="text-base px-8 py-6 rounded-xl transition-all duration-300 hover:-translate-y-0.5" asChild>
                    <Link href="/medicos/cadastro">
                      Criar conta
                      <ArrowRight className="ml-2 h-5 w-5" />
                    </Link>
                  </Button>
                  <Button variant="glass" size="lg" className="text-base px-8 py-6 rounded-xl transition-all duration-200" asChild>
                    <Link href="/precos">Ver preços</Link>
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  Já tem conta?{" "}
                  <Link href="/login" className="font-medium text-foreground underline underline-offset-4 hover:text-accent transition-colors">
                    Entrar
                  </Link>
                </p>
              </div>
            </Reveal>

            {/* Nota do criador — fato verdadeiro, preservado */}
            <Reveal delay={0.24}>
              <div className="flex items-start gap-3 rounded-xl glass-noir border border-noir-line p-3.5 max-w-md">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">
                  <HeartHandshake className="h-5 w-5" />
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  <span className="font-semibold text-foreground">Feito por quem vive isso.</span>{" "}
                  Sou desenvolvedor e também paciente há 15+ anos. Validado por psiquiatras.
                </p>
              </div>
            </Reveal>

            <Reveal delay={0.3}>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                {["Dados fictícios", "Azure · eastus2", "Protocolo de crise"].map((tag) => (
                  <div key={tag} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="grid h-5 w-5 place-items-center rounded-full bg-success/10">
                      <CheckCircle className="h-3 w-3 text-success" />
                    </span>
                    <span className="font-mono text-xs uppercase tracking-wide">{tag}</span>
                  </div>
                ))}
              </div>
            </Reveal>
          </div>

          {/* Right — briefing flutuante em vidro */}
          <div className="relative flex min-w-0 shrink-0 justify-center lg:justify-end">
            <div className="relative animate-scale-in" style={{ animationDelay: '0.2s' }}>
              <HeroPreview />
              <div className="pointer-events-none absolute -top-12 -right-12 h-72 w-72 rounded-full bg-primary/[0.16] blur-3xl" aria-hidden />
              <div className="pointer-events-none absolute -bottom-12 -left-12 h-64 w-64 rounded-full bg-coral/[0.12] blur-3xl" aria-hidden />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
