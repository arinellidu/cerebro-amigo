'use cache'

import { cacheLife } from 'next/cache'
import { CheckCircle } from "lucide-react"
import { Eyebrow } from "@/components/landing/eyebrow"
import { AuroraBackdrop } from "@/components/landing/aurora-backdrop"
import { Reveal, RevealGroup, RevealItem } from "@/components/landing/reveal"

const securityItems = [
  "Portfólio público com dados exclusivamente fictícios",
  "Criptografia em repouso e em trânsito",
  "Trilhas de auditoria imutáveis para todos os eventos clínicos",
  "Acesso por perfil: médico visualiza apenas seus próprios pacientes",
]

const securityBadges = [
  { label: "LGPD", desc: "Categoria especial de dado — saúde mental" },
  { label: "Azure", desc: "eastus2 — sem promessa de residência no Brasil" },
  { label: "Auditoria", desc: "Logs imutáveis de cada evento clínico" },
  { label: "Crise", desc: "Protocolo fixo, pré-aprovado — sem geração dinâmica por IA" },
]

export async function SecuritySection() {
  cacheLife('days')

  return (
    <section id="seguranca" className="relative py-28 border-y border-noir-line bg-noir-bg overflow-hidden">
      <AuroraBackdrop />
      <div className="container mx-auto max-w-7xl px-6 relative">
        <div className="grid md:grid-cols-2 gap-16 items-center">
          <Reveal>
            <Eyebrow className="mb-4">Segurança &amp; Privacidade</Eyebrow>
            <h2 className="font-serif text-4xl font-medium text-foreground mb-4 text-balance leading-[1.05]">
              Infraestrutura pensada para dados de saúde mental
            </h2>
            <p className="text-muted-foreground leading-relaxed mb-8">
              Saúde mental é categoria especial de dado pela LGPD. Nossa arquitetura foi desenhada
              com isso em mente desde o primeiro dia.
            </p>
            <div className="space-y-3.5">
              {securityItems.map((item) => (
                <div key={item} className="flex items-start gap-3">
                  <CheckCircle className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                  <span className="text-sm text-foreground/90 leading-relaxed">{item}</span>
                </div>
              ))}
            </div>
          </Reveal>

          <RevealGroup className="grid grid-cols-2 gap-4">
            {securityBadges.map((item) => (
              <RevealItem
                key={item.label}
                className="glass-noir rounded-2xl border border-noir-line p-5 transition-all hover:glow-purple-lg"
              >
                <p className="font-mono text-xs uppercase tracking-wider text-accent-on-dark mb-1.5">{item.label}</p>
                <p className="text-xs text-muted-foreground leading-snug">{item.desc}</p>
              </RevealItem>
            ))}
          </RevealGroup>
        </div>
      </div>
    </section>
  )
}
