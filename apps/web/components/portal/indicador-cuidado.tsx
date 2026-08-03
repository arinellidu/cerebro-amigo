"use client"

import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { BookOpen, Check, Layers, ShieldCheck } from "lucide-react"
import { cn } from "@/lib/utils"

/** Etapas honestas do pipeline clínico (orchestrator → auditoria → resposta). */
export type EtapaCuidado = "lendo" | "organizando" | "conferindo" | "finalizando"

const ORDEM: EtapaCuidado[] = ["lendo", "organizando", "conferindo", "finalizando"]

const PASSOS: {
  id: EtapaCuidado
  titulo: string
  descricao: string
  Icon: typeof BookOpen
}[] = [
  {
    id: "lendo",
    titulo: "Lendo",
    descricao: "Lendo sua mensagem",
    Icon: BookOpen,
  },
  {
    id: "organizando",
    titulo: "Organizando",
    descricao: "Organizando",
    Icon: Layers,
  },
  {
    id: "conferindo",
    titulo: "Conferindo",
    descricao: "Conferindo com segurança",
    Icon: ShieldCheck,
  },
]

const NODE_ETAPA: Record<string, EtapaCuidado> = {
  load_context: "lendo",
  detect_crisis: "lendo",
  degraded_response: "organizando",
  classify_medication: "organizando",
  update_medication_intake: "organizando",
  medication_acknowledgment: "organizando",
  extract_symptoms: "organizando",
  generate_response: "organizando",
  audit_response: "conferindo",
  escalate_to_human: "conferindo",
  finalize: "finalizando",
  crisis_protocol: "finalizando",
}

export function etapaDeNode(name: string, status: string): EtapaCuidado | null {
  if (status !== "started") return null
  return NODE_ETAPA[name] ?? null
}

export function avancarEtapa(
  atual: EtapaCuidado | null,
  nova: EtapaCuidado,
): EtapaCuidado {
  if (!atual) return nova
  return ORDEM.indexOf(nova) > ORDEM.indexOf(atual) ? nova : atual
}

function indicePasso(etapa: EtapaCuidado): number {
  if (etapa === "finalizando") return PASSOS.length
  return Math.max(0, ORDEM.indexOf(etapa))
}

interface IndicadorCuidadoProps {
  etapa: EtapaCuidado
}

/**
 * Progresso calmo e honesto durante a conversa — substitui "digitando…".
 * Reflete estágios reais do grafo (leitura → organização → auditoria).
 */
export function IndicadorCuidado({ etapa }: IndicadorCuidadoProps) {
  const idxAtual = indicePasso(etapa)
  const passoVisivel = Math.min(idxAtual, PASSOS.length - 1)
  const descricao =
    etapa === "finalizando"
      ? "Quase pronto…"
      : PASSOS[passoVisivel]?.descricao ?? "Processando…"
  const progresso = etapa === "finalizando" ? 100 : ((idxAtual + 0.35) / PASSOS.length) * 100

  const [visivel, setVisivel] = useState(false)
  useEffect(() => {
    const t = requestAnimationFrame(() => setVisivel(true))
    return () => cancelAnimationFrame(t)
  }, [])

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: visivel ? 1 : 0, y: visivel ? 0 : 10 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="flex justify-start w-full"
    >
      <div
        className={cn(
          "relative max-w-[88%] overflow-hidden rounded-2xl",
          "glass-noir aurora glow-purple-lg",
        )}
        role="status"
        aria-live="polite"
        aria-label={descricao}
      >
        <div className="pointer-events-none absolute inset-0 bg-linear-to-br from-primary/5 via-transparent to-accent/5" />

        <div className="relative space-y-3.5 px-4 py-3.5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border border-primary/25 bg-primary/10">
              <motion.span
                className="h-2 w-2 rounded-full bg-primary"
                animate={{ scale: [1, 1.35, 1], opacity: [0.65, 1, 0.65] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
              />
            </span>

            <div className="min-w-0 space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-noir-text-dim">
                Processando com cuidado
              </p>
              <AnimatePresence mode="wait">
                <motion.p
                  key={descricao}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.28, ease: "easeOut" }}
                  className="text-sm font-medium leading-snug text-foreground"
                >
                  {descricao}
                  <motion.span
                    aria-hidden
                    animate={{ opacity: [0.25, 1, 0.25] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                  >
                    …
                  </motion.span>
                </motion.p>
              </AnimatePresence>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {etapa === "conferindo" || etapa === "finalizando"
                  ? "Cada resposta passa por uma revisão antes de chegar até você."
                  : "Isso pode levar alguns segundos — é normal."}
              </p>
            </div>
          </div>

          <div className="space-y-2.5">
            <div
              className="relative h-1 overflow-hidden rounded-full bg-noir-line/70"
              aria-hidden
            >
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full bg-linear-to-r from-primary/70 via-primary to-accent/80"
                initial={{ width: "8%" }}
                animate={{ width: `${Math.min(progresso, 100)}%` }}
                transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>

            <ol className="grid grid-cols-3 gap-1" aria-hidden>
              {PASSOS.map((passo, i) => {
                const feito = i < idxAtual || etapa === "finalizando"
                const ativo = i === passoVisivel && etapa !== "finalizando"
                const Icon = passo.Icon

                return (
                  <li key={passo.id} className="flex flex-col items-center gap-1.5 text-center">
                    <span
                      className={cn(
                        "relative grid h-7 w-7 place-items-center rounded-full border transition-colors duration-300",
                        feito && "border-success/45 bg-success/12 text-success",
                        ativo && "border-primary/50 bg-primary/15 text-primary",
                        !feito && !ativo && "border-noir-line bg-noir-surface-raised/80 text-noir-text-dim",
                      )}
                    >
                      {ativo && (
                        <motion.span
                          className="absolute inset-0 rounded-full border border-primary/35"
                          animate={{ scale: [1, 1.28, 1], opacity: [0.55, 0, 0.55] }}
                          transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut" }}
                        />
                      )}
                      {feito ? (
                        <Check className="relative h-3.5 w-3.5" strokeWidth={2.5} />
                      ) : (
                        <Icon className="relative h-3.5 w-3.5" strokeWidth={2} />
                      )}
                    </span>
                    <span
                      className={cn(
                        "text-[9px] font-medium leading-tight tracking-wide",
                        ativo || feito ? "text-foreground/90" : "text-noir-text-dim",
                      )}
                    >
                      {passo.titulo}
                    </span>
                  </li>
                )
              })}
            </ol>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
