"use client";

// Fluxo próprio do ASSIST (ADR-049): Q1 multi-seleção de substâncias → bloco
// dinâmico Q2–Q7 por substância (regras de pulo oficiais) → Q8 (injetáveis).
// Visual idêntico ao QuizFlow (uma pergunta por tela, progresso, voltar).

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, ListChecks, LockKeyhole, Undo2 } from "lucide-react";
import {
  ASSIST_SUBSTANCES,
  ASSIST_Q1_TEXT,
  ASSIST_Q8,
  buildAssistPlan,
  scoreAssist,
  encodeAssistResult,
  type SubstanceId,
  type SubstanceAnswers,
} from "@/lib/scales/assist";
import { cn } from "@/lib/utils";

function fireEvent(event: string, sessionId: string) {
  fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, sessionId, scaleId: "assist" }),
  }).catch(() => {});
}

type Phase = "intro" | "q1" | "loop" | "q8";

export function AssistFlow() {
  const router = useRouter();
  const [sessionId, setSessionId] = useState("");
  useEffect(() => {
    setSessionId(crypto.randomUUID());
  }, []);

  const [phase, setPhase] = useState<Phase>("intro");
  const [selected, setSelected] = useState<SubstanceId[]>([]);
  const [answers, setAnswers] = useState<Partial<Record<SubstanceId, Partial<SubstanceAnswers>>>>({});
  const [stepIdx, setStepIdx] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const plan = buildAssistPlan(selected, answers);
  const step = plan[stepIdx];
  // progresso: Q1 + plano atual + Q8 (o plano encolhe quando Q2=nunca)
  const totalSteps = 1 + plan.length + 1;
  const done = phase === "q1" ? 0 : phase === "q8" ? 1 + plan.length : 1 + stepIdx;
  const progress = phase === "intro" ? 0 : Math.round((done / totalSteps) * 100);

  const finish = useCallback(
    (q8: number) => {
      const full = Object.fromEntries(
        Object.entries(answers).map(([id, a]) => [id, a as SubstanceAnswers])
      );
      const result = scoreAssist({ substances: full, q8 });
      fireEvent("test_completed", sessionId);
      const params = new URLSearchParams({
        sid: sessionId,
        scale: "assist",
        score: String(result.maxScore),
        band: result.band,
        label: result.bandLabel,
        sub: encodeAssistResult(result),
        inj: result.injectionFlag ? "1" : "0",
      });
      router.push(`/resultado?${params.toString()}`);
    },
    [answers, sessionId, router]
  );

  const handleStart = useCallback(() => {
    fireEvent("test_started", sessionId);
    setPhase("q1");
  }, [sessionId]);

  const toggleSubstance = useCallback((id: SubstanceId) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }, []);

  const handleQ1Next = useCallback(() => {
    if (selected.length === 0) {
      // Nenhum uso na vida → resultado direto (baixo risco), regra oficial.
      finish(0);
      return;
    }
    setPhase("loop");
    setStepIdx(0);
    setPicked(null);
  }, [selected, finish]);

  const handleLoopNext = useCallback(() => {
    if (picked === null || !step) return;
    const next = {
      ...answers,
      [step.substance]: { ...(answers[step.substance] ?? {}), [`q${step.q}`]: picked },
    };
    setAnswers(next);
    const newPlan = buildAssistPlan(selected, next);
    if (stepIdx + 1 >= newPlan.length) {
      setPhase("q8");
      setPicked(null);
      return;
    }
    setStepIdx(stepIdx + 1);
    const coming = newPlan[stepIdx + 1];
    const prev = next[coming.substance]?.[`q${coming.q}` as keyof SubstanceAnswers];
    setPicked(typeof prev === "number" ? prev : null);
  }, [picked, step, answers, selected, stepIdx]);

  const handleLoopBack = useCallback(() => {
    if (stepIdx === 0) {
      setPhase("q1");
      return;
    }
    const coming = plan[stepIdx - 1];
    const prev = answers[coming.substance]?.[`q${coming.q}` as keyof SubstanceAnswers];
    setPicked(typeof prev === "number" ? prev : null);
    setStepIdx(stepIdx - 1);
  }, [stepIdx, plan, answers]);

  const handleQ8Back = useCallback(() => {
    setPhase("loop");
    const last = plan[plan.length - 1];
    const prev = answers[last.substance]?.[`q${last.q}` as keyof SubstanceAnswers];
    setPicked(typeof prev === "number" ? prev : null);
    setStepIdx(plan.length - 1);
  }, [plan, answers]);

  const handleKeyNav = useCallback(
    (e: React.KeyboardEvent, idx: number, options: { value: number }[]) => {
      const n = options.length;
      let target = -1;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") target = (idx + 1) % n;
      else if (e.key === "ArrowUp" || e.key === "ArrowLeft") target = (idx - 1 + n) % n;
      if (target < 0) return;
      e.preventDefault();
      setPicked(options[target].value);
      optionRefs.current[target]?.focus();
    },
    []
  );

  // ── Intro ──
  if (phase === "intro") {
    return (
      <main className="flex min-h-[72vh] flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <p className="eyebrow reveal mb-4">ASSIST (OMS)</p>
          <h1 className="reveal reveal-1 mb-4 font-display text-3xl font-semibold leading-tight text-foreground sm:text-4xl">
            Triagem de uso de substâncias
          </h1>
          <p className="reveal reveal-2 mb-7 leading-relaxed text-muted-foreground">
            Perguntas sobre o uso de substâncias ao longo da vida e nos últimos 3 meses. O
            número de perguntas depende das suas respostas — em geral, leva de 2 a 5 minutos.
          </p>

          <ul className="reveal reveal-2 mb-7 space-y-3 text-sm text-muted-foreground">
            <li className="flex items-center gap-3">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-purple/25 bg-purple/10 text-purple-light" aria-hidden>
                <ListChecks className="h-4 w-4" />
              </span>
              Instrumento da Organização Mundial da Saúde
            </li>
            <li className="flex items-center gap-3">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-purple/25 bg-purple/10 text-purple-light" aria-hidden>
                <Undo2 className="h-4 w-4" />
              </span>
              Uma pergunta por tela — você pode voltar e revisar
            </li>
            <li className="flex items-center gap-3">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-purple/25 bg-purple/10 text-purple-light" aria-hidden>
                <LockKeyhole className="h-4 w-4" />
              </span>
              Anônimo: nada é gravado sem o seu consentimento
            </li>
          </ul>

          <div className="glass-noir reveal reveal-3 mb-8 rounded-2xl p-5 text-sm text-muted-foreground">
            <p className="mb-1 font-medium text-foreground">Antes de começar</p>
            <p>
              Responda com sinceridade — este espaço é anônimo e sem julgamento. As perguntas
              consideram apenas uso <strong>não prescrito pelo médico</strong>.
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

  const progressBar = (
    <div className="mb-8">
      <div className="mb-2 flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
        <span>
          Etapa <span className="font-semibold text-foreground">{done + 1}</span> de {totalSteps}
        </span>
        <span className="font-mono">{progress}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
        <div
          className="h-full rounded-full bg-gradient-to-r from-purple to-purple-light transition-all duration-500 [box-shadow:0_0_12px_var(--noir-glow-purple)]"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );

  // ── Q1: multi-seleção ──
  if (phase === "q1") {
    return (
      <main className="mx-auto flex min-h-[72vh] w-full max-w-md flex-col px-4 py-8">
        {progressBar}
        <div className="quiz-step-in flex flex-1 flex-col">
          <p className="mb-3 text-xs uppercase tracking-widest text-muted-foreground">ao longo da vida</p>
          <h2 className="mb-2 text-[1.35rem] font-semibold leading-snug text-foreground sm:text-2xl">
            {ASSIST_Q1_TEXT}
          </h2>
          <p className="mb-6 text-sm text-muted-foreground">
            Marque todas as que se aplicam — ou siga sem marcar nenhuma.
          </p>

          <div className="space-y-3" role="group" aria-label="Substâncias usadas na vida">
            {ASSIST_SUBSTANCES.map((s, idx) => {
              const isOn = selected.includes(s.id);
              return (
                <button
                  key={s.id}
                  role="checkbox"
                  aria-checked={isOn}
                  onClick={() => toggleSubstance(s.id)}
                  style={{ animationDelay: `${idx * 35}ms` }}
                  className={cn(
                    "quiz-opt-in flex min-h-[44px] w-full items-center gap-3.5 rounded-2xl border-2 px-5 py-3.5 text-left text-sm transition-all duration-150",
                    isOn
                      ? "border-purple bg-secondary font-medium text-purple-dark [box-shadow:0_0_28px_-8px_var(--noir-glow-purple)]"
                      : "border-border bg-card/70 text-foreground hover:border-purple-light/60 hover:bg-secondary/40"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border-2 transition-colors",
                      isOn ? "border-purple bg-purple text-white" : "border-[var(--noir-line)]"
                    )}
                    aria-hidden
                  >
                    {isOn && "✓"}
                  </span>
                  {s.label}
                </button>
              );
            })}
          </div>

          <div className="mt-auto flex gap-3 pt-8">
            <button
              onClick={() => setPhase("intro")}
              className="btn-ghost-noir min-h-[52px] shrink-0"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Voltar
            </button>
            <button onClick={handleQ1Next} className="btn-noir flex-1 min-w-0 text-lg">
              {selected.length === 0 ? "Nunca usei nenhuma — ver resultado" : "Próxima"}
              <ArrowRight className="h-5 w-5" aria-hidden />
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ── Loop Q2–Q7 / Q8 — mesma tela de opção única do QuizFlow ──
  const isQ8 = phase === "q8";
  const text = isQ8 ? ASSIST_Q8.text : step?.text ?? "";
  const options = isQ8 ? ASSIST_Q8.options : step?.options ?? [];
  const timeframe = isQ8
    ? "ao longo da vida"
    : step && (step.q === 6 || step.q === 7)
      ? "ao longo da vida"
      : "últimos 3 meses";
  const onNext = isQ8 ? () => picked !== null && finish(picked) : handleLoopNext;
  const onBack = isQ8 ? handleQ8Back : handleLoopBack;

  return (
    <main className="mx-auto flex min-h-[72vh] w-full max-w-md flex-col px-4 py-8">
      {progressBar}
      <div key={`${phase}-${stepIdx}`} className="quiz-step-in flex flex-1 flex-col">
        <p className="mb-3 text-xs uppercase tracking-widest text-muted-foreground">
          {isQ8 ? timeframe : `${step?.short} · ${timeframe}`}
        </p>
        <h2 className="mb-8 text-[1.35rem] font-semibold leading-snug text-foreground sm:text-2xl">
          {text}
        </h2>

        <div className="space-y-3" role="radiogroup" aria-label="Selecione uma opção">
          {options.map((opt, idx) => {
            const isSelected = picked === opt.value;
            return (
              <button
                key={opt.value}
                ref={(el) => {
                  optionRefs.current[idx] = el;
                }}
                role="radio"
                aria-checked={isSelected}
                onClick={() => setPicked(opt.value)}
                onKeyDown={(e) => handleKeyNav(e, idx, options)}
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

        <div className="mt-auto flex gap-3 pt-8">
          <button onClick={onBack} className="btn-ghost-noir min-h-[52px] shrink-0">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Voltar
          </button>
          <button
            onClick={onNext}
            disabled={picked === null}
            className={cn(
              "flex-1 min-w-0 text-lg",
              picked !== null
                ? "btn-noir"
                : "min-h-[52px] cursor-not-allowed rounded-[14px] bg-muted py-3.5 font-medium text-muted-foreground"
            )}
            aria-disabled={picked === null}
          >
            {isQ8 ? "Ver resultado" : "Próxima"}
            {picked !== null && <ArrowRight className="h-5 w-5" aria-hidden />}
          </button>
        </div>
      </div>
    </main>
  );
}
