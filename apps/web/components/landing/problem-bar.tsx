'use cache'

import { cacheLife } from 'next/cache'
import { Eyebrow } from '@/components/landing/eyebrow'
import { RevealGroup, RevealItem } from '@/components/landing/reveal'

const items = [
  {
    label: "O problema",
    value: "O que acontece entre uma consulta e a próxima?",
    sub: "Paciente vai para casa. Você perde visibilidade. A próxima consulta começa do zero.",
  },
  {
    label: "O custo",
    value: "Gaps clínicos não detectados",
    sub: "Crises, abandono de medicação e recaídas se desenvolvem no intervalo — e chegam tarde.",
  },
  {
    label: "A solução",
    value: "Acompanhamento contínuo e automatizado",
    sub: "Cérebro Amigo monitora, alerta e organiza — para você chegar ao retorno preparado.",
  },
]

export async function ProblemBar() {
  cacheLife('days')

  return (
    <section className="relative border-y border-noir-line bg-noir-surface">
      <div className="container mx-auto max-w-7xl px-6">
        <RevealGroup className="grid md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-noir-line">
          {items.map((item) => (
            <RevealItem key={item.label} className="py-12 px-8 lg:px-10">
              <Eyebrow className="mb-3">{item.label}</Eyebrow>
              <p className="text-foreground font-medium text-xl leading-snug mb-3 text-balance">{item.value}</p>
              <p className="text-muted-foreground text-sm leading-relaxed">{item.sub}</p>
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
    </section>
  )
}
