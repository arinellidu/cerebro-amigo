'use cache'

import { cacheLife } from 'next/cache'
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Eyebrow } from "@/components/landing/eyebrow"
import { AuroraBackdrop } from "@/components/landing/aurora-backdrop"
import { Reveal } from "@/components/landing/reveal"
import { ArrowRight } from "lucide-react"

export async function CTASection() {
  cacheLife('days')

  return (
    <section className="relative py-36 bg-noir-bg overflow-hidden">
      <AuroraBackdrop grid />
      <div className="pointer-events-none absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-primary/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-coral/12 blur-3xl" />

      <div className="container mx-auto max-w-7xl px-6 text-center relative">
        <Reveal>
          <Eyebrow className="mb-5">Para psiquiatras e clínicos</Eyebrow>
          <h2 className="font-serif text-4xl lg:text-[3.25rem] font-medium text-foreground mb-6 text-balance max-w-3xl mx-auto leading-[1.05]">
            Comece a acompanhar seus pacientes{" "}
            <span className="text-accent [text-shadow:0_0_40px_var(--noir-glow-coral)]">entre consultas</span>
          </h2>
          <p className="text-muted-foreground text-lg mb-12 max-w-lg mx-auto leading-relaxed">
            Sem cartão de crédito. Configure em minutos.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button variant="coral" size="lg" className="text-base px-10 py-6 rounded-xl transition-all duration-300 hover:-translate-y-1" asChild>
              <Link href="/medicos/cadastro">
                Criar conta
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
            <Button variant="glass" size="lg" className="text-base px-10 py-6 rounded-xl transition-all duration-200" asChild>
              <Link href="/precos">Ver preços</Link>
            </Button>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
