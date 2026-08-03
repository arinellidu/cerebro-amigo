'use cache'

import { cacheLife } from 'next/cache'
import { CardContent } from "@/components/ui/card"
import { SpotlightCard } from "@/components/ui/spotlight-card"
import { Eyebrow } from "@/components/landing/eyebrow"
import { Reveal, RevealGroup, RevealItem } from "@/components/landing/reveal"
import {
  ClipboardList,
  Smile,
  Mic,
  ShieldAlert,
  Bell,
  TrendingUp,
  Lock,
  Sparkles,
  Brain,
} from "lucide-react"

const features = [
  { icon: ClipboardList, title: "Prontuário eletrônico", description: "Histórico clínico completo, organizado por consulta. Evolução, condutas e medicações num só lugar." },
  { icon: Smile, title: "Check-in de humor", description: "Escalas validadas (PHQ-9, GAD-7) enviadas automaticamente entre consultas e armazenadas na evolução." },
  { icon: Mic, title: "Diário por voz", description: "O paciente registra como está por áudio. A IA transcreve em pt-BR e organiza em humor, temas e sintomas relatados — sem digitar nada." },
  { icon: ShieldAlert, title: "Protocolo de crise", description: "Detecção automática de risco com notificação imediata ao médico. Texto de crise fixo — nunca gerado por IA." },
  { icon: Bell, title: "Lembretes automatizados", description: "Medicação, tarefas terapêuticas e retornos agendados com envio por push ou mensagem." },
  { icon: TrendingUp, title: "Evolução clínica", description: "Gráficos de humor, aderência e progresso ao longo do tempo para embasar decisões no retorno." },
  { icon: Lock, title: "Privacidade LGPD", description: "Dados de saúde mental protegidos por criptografia, minimização de dados e trilhas de auditoria imutáveis." },
]

const featuredFeature = {
  icon: Brain,
  title: "Briefing pré-consulta com IA",
  description:
    "Antes de cada retorno, a IA consolida tudo que aconteceu no intervalo: variações de humor, aderência a medicações, eventos registrados e alertas. O médico entra na consulta com um resumo claro — sem precisar garimpar anotações.",
  badge: "Inteligência Artificial",
}

const SPOT = "148,134,201" // roxo claro noir

export async function FeaturesSection() {
  cacheLife('days')

  return (
    <section id="recursos" className="relative py-28">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_40%_at_50%_100%,rgba(148,134,201,0.06),transparent)]" />

      <div className="container mx-auto max-w-7xl px-6 relative">
        <Reveal className="max-w-2xl mb-16">
          <Eyebrow className="mb-4">Recursos</Eyebrow>
          <h2 className="font-serif text-4xl lg:text-[3rem] font-medium text-foreground leading-[1.05] text-balance">
            Tudo que o acompanhamento entre consultas exige
          </h2>
        </Reveal>

        {/* Briefing com IA — card em destaque */}
        <Reveal delay={0.06}>
          <SpotlightCard spotlightColor={SPOT} className="mb-6 glow-purple-lg">
            <CardContent className="p-8 sm:p-12 bg-gradient-to-br from-noir-surface-raised to-noir-surface">
              <div className="flex flex-col sm:flex-row sm:items-start gap-6">
                <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30 flex items-center justify-center flex-shrink-0">
                  <featuredFeature.icon className="h-8 w-8 text-primary" />
                </div>
                <div className="flex-1 space-y-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h3 className="text-2xl font-semibold text-foreground">{featuredFeature.title}</h3>
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/25 font-mono text-[10px] font-medium text-primary uppercase tracking-wider">
                      <Sparkles className="h-3 w-3" />
                      {featuredFeature.badge}
                    </span>
                  </div>
                  <p className="text-muted-foreground leading-relaxed max-w-2xl text-base">
                    {featuredFeature.description}
                  </p>
                </div>
              </div>
            </CardContent>
          </SpotlightCard>
        </Reveal>

        <RevealGroup className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature) => (
            <RevealItem key={feature.title}>
              <SpotlightCard spotlightColor={SPOT} className="group h-full">
                <CardContent className="p-8 space-y-5 bg-gradient-to-br from-noir-surface-raised to-noir-surface h-full">
                  <div className="h-12 w-12 rounded-xl bg-noir-surface-raised border border-noir-line flex items-center justify-center group-hover:border-primary/30 transition-all duration-300">
                    <feature.icon className="h-5 w-5 text-primary group-hover:scale-110 transition-transform duration-300" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground mb-2 text-[17px]">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
                  </div>
                </CardContent>
              </SpotlightCard>
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
    </section>
  )
}
