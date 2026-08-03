"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, ListChecks, LockKeyhole, Undo2 } from "lucide-react";
import type { Scale, ScaleResult } from "@/lib/scales/types";
import { scorePhq9 } from "@/lib/scales/phq9";
import { scoreGad7 } from "@/lib/scales/gad7";
import { scoreAsrs18 } from "@/lib/scales/asrs18";
import { scoreAudit } from "@/lib/scales/audit";
import { scoreMdq } from "@/lib/scales/mdq";
import { scoreFagerstrom } from "@/lib/scales/fagerstrom";
import { scoreMsiBpd } from "@/lib/scales/msi_bpd";
import { cn } from "@/lib/utils";

function getScoreFn(scaleId: string) {
  if (scaleId === "phq9") return scorePhq9;
  if (scaleId === "gad7") return scoreGad7;
  if (scaleId === "asrs18") return scoreAsrs18;
  if (scaleId === "audit") return scoreAudit;
  if (scaleId === "mdq") return scoreMdq;
  if (scaleId === "fagerstrom") return scoreFagerstrom;
  if (scaleId === "msi_bpd") return scoreMsiBpd;
  throw new Error(`No score function for ${scaleId}`);
}

function fireEvent(event: string, sessionId: string, scaleId: string) {
  fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, sessionId, scaleId }),
  }).catch(() => {});
}

interface Props {
  scale: Scale;
}

export function QuizFlow({ scale }: Props) {
  const router = useRouter();
  // Re-rastreio do acompanhamento (ADR-050 Parte 2): token opaco da série, repassado
  // ao /resultado p/ anexar o novo ponto. Só no caminho normal — NUNCA no de crise.
  // Lido via window PÓS-montagem (não useSearchParams) p/ NÃO jogar o quiz atrás de
  // Suspense — mantém o QuizFlow renderizado no servidor (SSR; smoke grepa o HTML cru).
  const [seriesToken, setSeriesToken] = useState("");
  // Sessão efêmera anônima: UUID gerado client-side PÓS-montagem.
  // NÃO gerar no render — crypto.randomUUID quebra o prerender PPR (sem Suspense acima).
  const [sessionId, setSessionId] = useState("");
  useEffect(() => {
    setSessionId(crypto.randomUUID());
    const t = new URLSearchParams(window.location.search).get("series");
    if (t) setSeriesToken(t);
  }, []);

  const [step, setStep] = useState(-1); // -1 = intro
  const [answers, setAnswers] = useState<number[]>(new Array(scale.items.length).fill(-1));
  const [selected, setSelected] = useState<number | null>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const totalItems = scale.items.length;
  const currentItem = scale.items[step];
  // AUDIT/MDQ/Fagerström têm opções específicas por item; o resto usa as da escala.
  const currentOptions = currentItem?.options ?? scale.options;
  const isLastStep = step === totalItems - 1;
  const progress = step < 0 ? 0 : Math.round(((step + 1) / totalItems) * 100);

  const handleStart = useCallback(() => {
    fireEvent("test_started", sessionId, scale.id);
    setStep(0);
    setSelected(null);
  }, [sessionId, scale.id]);

  const handleNext = useCallback(() => {
    if (selected === null) return;

    const newAnswers = [...answers];
    newAnswers[step] = selected;

    // Check crisis on item 9 (PHQ-9, index 8) — BEFORE anything else
    if (currentItem?.isCrisisItem && selected > 0) {
      fireEvent("crisis_routed", sessionId, scale.id);
      // Store partial result in query for "Continuar" path
      const partialScore = newAnswers
        .slice(0, step)
        .reduce((sum, a) => sum + (a >= 0 ? a : 0), 0) + selected;
      router.push(
        `/crise?sid=${sessionId}&scale=${scale.id}&score=${partialScore}&band=crisis`
      );
      return;
    }

    setAnswers(newAnswers);

    if (isLastStep) {
      const scoreFn = getScoreFn(scale.id);
      const result: ScaleResult = scoreFn(newAnswers);
      fireEvent("test_completed", sessionId, scale.id);
      router.push(
        `/resultado?sid=${sessionId}&scale=${scale.id}&score=${result.totalScore}&band=${result.band}&label=${encodeURIComponent(result.bandLabel)}` +
          (seriesToken ? `&series=${encodeURIComponent(seriesToken)}` : "")
      );
      return;
    }

    setStep((s) => s + 1);
    setSelected(newAnswers[step + 1] >= 0 ? newAnswers[step + 1] : null);
  }, [selected, answers, step, currentItem, isLastStep, sessionId, scale.id, router, seriesToken]);

  // Voltar: revisita a pergunta anterior com a resposta dada (pode corrigir).
  // Não interfere no gate de crise — ele só dispara no "Próxima" do item de crise.
  const handleBack = useCallback(() => {
    if (step <= 0) return;
    const newAnswers = [...answers];
    if (selected !== null) newAnswers[step] = selected; // preserva a escolha atual
    setAnswers(newAnswers);
    setStep((s) => s - 1);
    setSelected(newAnswers[step - 1] >= 0 ? newAnswers[step - 1] : null);
  }, [step, answers, selected]);

  // Navegação por teclado no radiogroup (padrão WAI-ARIA): setas movem foco E seleção.
  const handleOptionKeyDown = useCallback(
    (e: React.KeyboardEvent, idx: number) => {
      const n = currentOptions.length;
      let target = -1;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") target = (idx + 1) % n;
      else if (e.key === "ArrowUp" || e.key === "ArrowLeft") target = (idx - 1 + n) % n;
      if (target < 0) return;
      e.preventDefault();
      setSelected(currentOptions[target].value);
      optionRefs.current[target]?.focus();
    },
    [currentOptions]
  );

  // Intro screen
  if (step < 0) {
    return (
      <main className="flex min-h-[72vh] flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <p className="eyebrow reveal mb-4">{scale.name}</p>
          <h1 className="reveal reveal-1 mb-4 font-display text-3xl font-semibold leading-tight text-foreground sm:text-4xl">
            Como você tem se sentido?
          </h1>
          <p className="reveal reveal-2 mb-7 leading-relaxed text-muted-foreground">
            {scale.instructions}
          </p>

          <ul className="reveal reveal-2 mb-7 space-y-3 text-sm text-muted-foreground">
            <li className="flex items-center gap-3">
              <span
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-purple/25 bg-purple/10 text-purple-light"
                aria-hidden
              >
                <ListChecks className="h-4 w-4" />
              </span>
              {totalItems} {totalItems === 1 ? "pergunta" : "perguntas"} · {scale.timeframe}
            </li>
            <li className="flex items-center gap-3">
              <span
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-purple/25 bg-purple/10 text-purple-light"
                aria-hidden
              >
                <Undo2 className="h-4 w-4" />
              </span>
              Uma pergunta por tela — você pode voltar e revisar
            </li>
            <li className="flex items-center gap-3">
              <span
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-purple/25 bg-purple/10 text-purple-light"
                aria-hidden
              >
                <LockKeyhole className="h-4 w-4" />
              </span>
              Anônimo: nada é gravado sem o seu consentimento
            </li>
          </ul>

          <div className="glass-noir reveal reveal-3 mb-8 rounded-2xl p-5 text-sm text-muted-foreground">
            <p className="mb-1 font-medium text-foreground">Antes de começar</p>
            <p>
              Responda com sinceridade sobre como você tem se sentido. Não há respostas certas ou
              erradas — o que importa é o que você realmente está experienciando.
            </p>
          </div>

          <div className="reveal reveal-4">
            <button onClick={handleStart} className="btn-noir w-full text-lg">
              Começar triagem
              <ArrowRight className="h-5 w-5" aria-hidden />
            </button>
            <p className="mt-4 text-center text-xs text-muted-foreground">
              Gratuito · Anônimo · Sem cadastro
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[72vh] w-full max-w-md flex-col px-4 py-8">
      {/* Progress bar */}
      <div className="mb-8">
        <div className="mb-2 flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
          <span>
            Pergunta <span className="font-semibold text-foreground">{step + 1}</span> de {totalItems}
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
            className="h-full rounded-full bg-gradient-to-r from-purple to-purple-light transition-all duration-500 [box-shadow:0_0_12px_var(--noir-glow-purple)]"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Question — key={step} remonta com animação suave (reduced-motion zera via global) */}
      <div key={step} className="quiz-step-in flex flex-1 flex-col">
        <p className="mb-3 text-xs uppercase tracking-widest text-muted-foreground">
          {scale.timeframe}
        </p>
        <h2 className="mb-8 text-[1.35rem] font-semibold leading-snug text-foreground sm:text-2xl">
          {currentItem.text}
        </h2>

        {/* Options */}
        <div className="space-y-3" role="radiogroup" aria-label="Selecione uma opção">
          {currentOptions.map((opt, idx) => {
            const isSelected = selected === opt.value;
            return (
              <button
                key={opt.value}
                ref={(el) => {
                  optionRefs.current[idx] = el;
                }}
                role="radio"
                aria-checked={isSelected}
                onClick={() => setSelected(opt.value)}
                onKeyDown={(e) => handleOptionKeyDown(e, idx)}
                style={{ animationDelay: `${idx * 45}ms` }}
                className={cn(
                  "quiz-opt-in flex min-h-[44px] w-full items-center gap-3.5 rounded-2xl border-2 px-5 py-4 text-left transition-all duration-150",
                  isSelected
                    ? "border-purple bg-secondary font-medium text-purple-dark [box-shadow:0_0_28px_-8px_var(--noir-glow-purple)]"
                    : "border-border bg-card/70 text-foreground hover:border-purple-light/60 hover:bg-secondary/40"
                )}
              >
                <span
                  className={cn(
                    "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                    isSelected ? "border-purple" : "border-[var(--noir-line)]"
                  )}
                  aria-hidden
                >
                  {isSelected && <span className="h-2 w-2 rounded-full bg-purple" />}
                </span>
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* Voltar / Próxima */}
        <div className="mt-auto flex gap-3 pt-8">
          {step > 0 && (
            <button onClick={handleBack} className="btn-ghost-noir min-h-[52px] shrink-0">
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Voltar
            </button>
          )}
          <button
            onClick={handleNext}
            disabled={selected === null}
            className={cn(
              "flex-1 min-w-0 text-lg",
              selected !== null
                ? "btn-noir"
                : "min-h-[52px] cursor-not-allowed rounded-[14px] bg-muted py-3.5 font-medium text-muted-foreground"
            )}
            aria-disabled={selected === null}
          >
            {isLastStep ? "Ver resultado" : "Próxima"}
            {selected !== null && <ArrowRight className="h-5 w-5" aria-hidden />}
          </button>
        </div>
      </div>
    </main>
  );
}
