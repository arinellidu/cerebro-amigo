"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ClipboardList,
  Loader2,
  Undo2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { CrisisSupportPanel } from "@/components/portal/crisis-support-panel"
import { cn } from "@/lib/utils"

interface OpcaoEscala {
  label: string
  valor: number
}
interface EscalaDef {
  codigo: string
  nome: string
  instrucao: string
  opcoes: OpcaoEscala[]
  itens: string[]
  itemIdeacaoIndice?: number | null
}

interface Props {
  checkinId: string
  /** "phq9" | "gad7" */
  codigo: string
  onConcluido: (id: string) => void
}

type Modo = "carregando" | "pronto" | "intro" | "quiz" | "enviando" | "enviado" | "crise" | "erro"

/**
 * Questionário clínico (PHQ-9/GAD-7) no portal — uma pergunta por tela.
 * Texto dos itens vem versionado do gateway (nunca parafraseado no front).
 * Crise: item de ideação (PHQ-9 q9) > 0 → protocolo fixo no backend.
 */
export function QuestionarioEscala({ checkinId, codigo, onConcluido }: Props) {
  const [def, setDef] = useState<EscalaDef | null>(null)
  const [modo, setModo] = useState<Modo>("carregando")
  const [step, setStep] = useState(0)
  const [respostas, setRespostas] = useState<Record<string, number>>({})
  const [selected, setSelected] = useState<number | null>(null)
  const [criseTexto, setCriseTexto] = useState<string | null>(null)
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    fetch(`/api/paciente/escalas/${codigo}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: EscalaDef) => {
        setDef(d)
        setModo("pronto")
      })
      .catch(() => setModo("erro"))
  }, [codigo])

  const total = def?.itens.length ?? 0
  const progress = total > 0 ? Math.round(((step + 1) / total) * 100) : 0
  const isLast = step === total - 1
  const overlayAtivo = modo === "intro" || modo === "quiz" || modo === "enviando"

  const enviar = useCallback(
    async (respostasFinais: Record<string, number>) => {
      if (!def || Object.keys(respostasFinais).length !== total) return
      setModo("enviando")
      try {
        const r = await fetch(`/api/paciente/checkins/${checkinId}/responder`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resposta: { respostas: respostasFinais } }),
        })
        if (r.status === 200) {
          const data = await r.json().catch(() => null)
          if (data?.crise) {
            setCriseTexto(data.criseTexto ?? null)
            setModo("crise")
            return
          }
        }
        if (r.ok) {
          setModo("enviado")
          onConcluido(checkinId)
          return
        }
        setModo("erro")
      } catch {
        setModo("erro")
      }
    },
    [checkinId, def, onConcluido, total],
  )

  const handleStart = useCallback(() => {
    setStep(0)
    setSelected(null)
    setModo("quiz")
  }, [])

  const handleNext = useCallback(() => {
    if (selected === null || !def) return
    const chave = `q${step + 1}`
    const next = { ...respostas, [chave]: selected }
    setRespostas(next)

    if (isLast) {
      void enviar(next)
      return
    }

    const proximo = step + 1
    setStep(proximo)
    setSelected(next[`q${proximo + 1}`] ?? null)
  }, [def, enviar, isLast, respostas, selected, step])

  const handleBack = useCallback(() => {
    if (step <= 0 || !def) return
    const chave = `q${step + 1}`
    const next = selected !== null ? { ...respostas, [chave]: selected } : respostas
    setRespostas(next)
    const anterior = step - 1
    setStep(anterior)
    setSelected(next[`q${anterior + 1}`] ?? null)
  }, [def, respostas, selected, step])

  const handleOptionKeyDown = useCallback(
    (e: React.KeyboardEvent, idx: number) => {
      if (!def) return
      const n = def.opcoes.length
      let target = -1
      if (e.key === "ArrowDown" || e.key === "ArrowRight") target = (idx + 1) % n
      else if (e.key === "ArrowUp" || e.key === "ArrowLeft") target = (idx - 1 + n) % n
      if (target < 0) return
      e.preventDefault()
      setSelected(def.opcoes[target].valor)
      optionRefs.current[target]?.focus()
    },
    [def],
  )

  if (modo === "carregando") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando questionário…
      </div>
    )
  }

  if (modo === "erro") {
    return (
      <p className="text-sm text-destructive">
        Não foi possível carregar agora. Tente novamente mais tarde.
      </p>
    )
  }

  if (modo === "enviado") {
    return (
      <p className="flex items-center gap-1.5 text-sm text-success">
        <Check className="h-4 w-4" /> Respostas enviadas
      </p>
    )
  }

  if (modo === "crise") {
    return (
      <CrisisSupportPanel
        texto={
          criseTexto ??
          "Se você sente que pode se machucar ou está em risco agora, ligue para o CVV no 188 (24h, gratuito). Em risco imediato, vá ao pronto-socorro mais próximo ou ligue para o SAMU (192)."
        }
        titulo="Sua psiquiatra foi avisada"
        subtitulo="Apoio imediato disponível"
      />
    )
  }

  const overlay = overlayAtivo && def && (
    <div className="fixed inset-0 z-[100] flex flex-col bg-background">
      <div className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col px-4 pb-8 pt-6">
        {modo === "intro" ? (
          <div className="flex flex-1 flex-col justify-center">
            <p className="mb-3 font-mono text-xs uppercase tracking-widest text-accent-on-dark">
              {def.nome}
            </p>
            <h2 className="mb-4 text-2xl font-semibold leading-snug text-foreground">
              Como você tem se sentido?
            </h2>
            <p className="mb-6 text-sm leading-relaxed text-muted-foreground">{def.instrucao}</p>

            <ul className="mb-6 space-y-3 text-sm text-muted-foreground">
              <li className="flex items-center gap-3">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-noir-line bg-noir-surface-raised text-primary">
                  <ClipboardList className="h-4 w-4" />
                </span>
                {total} {total === 1 ? "pergunta" : "perguntas"} · últimas 2 semanas
              </li>
              <li className="flex items-center gap-3">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-noir-line bg-noir-surface-raised text-primary">
                  <Undo2 className="h-4 w-4" />
                </span>
                Uma pergunta por tela — você pode voltar e revisar
              </li>
            </ul>

            <div className="glass-noir mb-8 rounded-2xl p-4 text-sm text-muted-foreground">
              <p className="mb-1 font-medium text-foreground">Antes de começar</p>
              <p>
                Responda com sinceridade sobre como você tem se sentido. Não há respostas certas ou
                erradas — o que importa é o que você realmente está experienciando.
              </p>
            </div>

            <Button size="lg" className="w-full gap-2 text-base" onClick={handleStart}>
              Começar
              <ArrowRight className="h-5 w-5" />
            </Button>
            <button
              type="button"
              className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground"
              onClick={() => setModo("pronto")}
            >
              Voltar aos check-ins
            </button>
          </div>
        ) : (
          <>
            <div className="mb-6">
              <div className="mb-2 flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  Pergunta{" "}
                  <span className="font-semibold text-foreground">{step + 1}</span> de {total}
                </span>
                <span className="font-mono">{progress}%</span>
              </div>
              <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-purple-light transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            <div key={step} className="quiz-step-in flex min-h-0 flex-1 flex-col">
              <p className="mb-3 text-xs uppercase tracking-widest text-muted-foreground">
                Últimas 2 semanas
              </p>
              <h3 className="mb-8 text-xl font-semibold leading-snug text-foreground sm:text-2xl">
                {def.itens[step]}
              </h3>

              <div className="space-y-3" role="radiogroup" aria-label="Selecione uma opção">
                {def.opcoes.map((op, idx) => {
                  const isSelected = selected === op.valor
                  return (
                    <button
                      key={op.valor}
                      ref={(el) => {
                        optionRefs.current[idx] = el
                      }}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      onClick={() => setSelected(op.valor)}
                      onKeyDown={(e) => handleOptionKeyDown(e, idx)}
                      style={{ animationDelay: `${idx * 45}ms` }}
                      className={cn(
                        "quiz-opt-in flex min-h-[44px] w-full items-center gap-3.5 rounded-2xl border-2 px-4 py-3.5 text-left text-sm transition-all duration-150",
                        isSelected
                          ? "border-primary bg-secondary font-medium text-foreground shadow-[0_0_28px_-8px_var(--noir-glow-purple)]"
                          : "border-border bg-card/70 text-foreground hover:border-primary/40 hover:bg-secondary/40",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                          isSelected ? "border-primary" : "border-noir-line",
                        )}
                        aria-hidden
                      >
                        {isSelected && <span className="h-2 w-2 rounded-full bg-primary" />}
                      </span>
                      {op.label}
                    </button>
                  )
                })}
              </div>

              <div className="mt-auto flex gap-3 pt-8">
                {step > 0 && (
                  <Button type="button" variant="outline" className="min-h-[48px] shrink-0 gap-1" onClick={handleBack}>
                    <ArrowLeft className="h-4 w-4" />
                    Voltar
                  </Button>
                )}
                <Button
                  type="button"
                  className="min-h-[48px] flex-1 gap-2 text-base"
                  disabled={selected === null || modo === "enviando"}
                  onClick={handleNext}
                >
                  {modo === "enviando" ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : isLast ? (
                    "Enviar respostas"
                  ) : (
                    <>
                      Próxima
                      <ArrowRight className="h-5 w-5" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )

  if (modo === "pronto") {
    return (
      <>
        <p className="text-xs text-muted-foreground">
          {def?.nome} · {total} perguntas · uma por tela
        </p>
        <Button size="sm" className="w-full gap-2" onClick={() => setModo("intro")}>
          Iniciar questionário
          <ArrowRight className="h-4 w-4" />
        </Button>
      </>
    )
  }

  return (
    <>
      {overlay}
    </>
  )
}
