'use cache'

import { cacheLife } from 'next/cache'
import { ClipboardList, Smartphone, ShieldAlert, Brain } from 'lucide-react'
import { RevealGroup, RevealItem } from '@/components/landing/reveal'

const steps = [
  {
    number: '01',
    label: 'Consulta',
    icon: ClipboardList,
    title: 'Plano de acompanhamento',
    description:
      'Médico registra frequência de check-ins, medicações e metas clínicas. Ponto de partida do ciclo.',
  },
  {
    number: '02',
    label: 'Entre consultas',
    icon: Smartphone,
    title: 'Acompanhamento automático',
    description:
      'Sistema envia check-ins no intervalo definido. Paciente responde pelo celular, sem precisar instalar app.',
  },
  {
    number: '03',
    label: 'Monitoramento',
    icon: ShieldAlert,
    title: 'IA monitora e alerta',
    description:
      'IA analisa respostas em tempo real. Em sinal de risco, médico é notificado imediatamente com protocolo fixo e aprovado.',
  },
  {
    number: '04',
    label: 'Pré-retorno',
    icon: Brain,
    title: 'Briefing pré-consulta com IA',
    description:
      'IA consolida humor, aderência e eventos do intervalo num briefing estruturado. Médico chega ao retorno preparado, sem improvisar.',
    highlight: true,
  },
]

const chipBase =
  'inline-flex items-center font-mono uppercase tracking-wider border'

export async function HowItWorks() {
  cacheLife('days')

  return (
    <RevealGroup as="ol" className="grid grid-cols-1 lg:grid-cols-4 gap-0 list-none m-0 p-0">
      {steps.map((step, i) => {
        const Icon = step.icon
        const isFirst = i === 0
        const isLast = i === steps.length - 1

        return (
          <RevealItem
            key={step.number}
            as="li"
            className={`relative flex gap-4 lg:flex-col lg:gap-0 lg:items-center lg:text-center ${!isLast ? 'pb-10 lg:pb-0' : ''}`}
          >
            {!isLast && (
              <div className="lg:hidden absolute left-5 top-10 bottom-0 w-px bg-noir-line z-0" />
            )}

            {/* Desktop: label chip */}
            <div className="hidden lg:flex justify-center mb-3">
              <span
                className={`${chipBase} px-2.5 py-0.5 rounded-full text-[0.62rem] h-6 ${
                  step.highlight
                    ? 'bg-primary/15 text-primary border-primary/40'
                    : 'bg-noir-surface-raised text-muted-foreground border-noir-line'
                }`}
              >
                {step.label}
              </span>
            </div>

            {/* Desktop: conectores + círculo */}
            <div className="relative hidden lg:flex w-full items-center justify-center py-2 mb-5">
              {!isFirst && (
                <div className="absolute top-1/2 left-0 right-1/2 h-px bg-noir-line -translate-y-1/2 z-0" />
              )}
              {!isLast && (
                <div className="absolute top-1/2 left-1/2 right-0 h-px bg-noir-line -translate-y-1/2 z-0" />
              )}
              <div
                className={`relative z-10 h-11 w-11 rounded-full flex items-center justify-center shrink-0 border-2 ${
                  step.highlight
                    ? 'bg-primary border-primary ring-4 ring-primary/15 glow-purple-lg'
                    : 'bg-noir-surface-raised border-noir-line'
                }`}
              >
                <Icon size={19} className={step.highlight ? 'text-primary-foreground' : 'text-primary'} />
              </div>
            </div>

            {/* Mobile: círculo */}
            <div
              className={`relative z-10 flex lg:hidden h-10 w-10 rounded-full items-center justify-center shrink-0 border-2 ${
                step.highlight
                  ? 'bg-primary border-primary ring-4 ring-primary/15 glow-purple-lg'
                  : 'bg-noir-surface-raised border-noir-line'
              }`}
            >
              <Icon size={18} className={step.highlight ? 'text-primary-foreground' : 'text-primary'} />
            </div>

            {/* Conteúdo */}
            <div className="relative z-10 flex-1 min-w-0 lg:px-3">
              <span className={`lg:hidden ${chipBase} mb-1 px-2 py-0.5 rounded-full text-[0.6rem] bg-noir-surface-raised text-muted-foreground border-noir-line`}>
                {step.label}
              </span>
              <h3 className="text-base font-semibold text-foreground leading-tight mt-0.5 mb-1.5">
                {step.title}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {step.description}
              </p>
            </div>
          </RevealItem>
        )
      })}
    </RevealGroup>
  )
}
