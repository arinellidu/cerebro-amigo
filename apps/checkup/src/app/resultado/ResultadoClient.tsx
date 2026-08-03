"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import Link from "next/link";
import { FileDown, Info } from "lucide-react";
import { InstagramCta } from "@/components/instagram-cta";
import type { Devolutiva } from "@/lib/ai/types";
import { getFallback } from "@/lib/ai/fallbacks";
import { decodeAssistResult } from "@/lib/scales/assist";

const SCALE_NAMES: Record<string, string> = {
  phq9: "PHQ-9 — Depressão",
  gad7: "GAD-7 — Ansiedade",
  asrs18: "ASRS-18 — TDAH",
  audit: "AUDIT — Uso de Álcool",
  mdq: "MDQ — Bipolaridade",
  fagerstrom: "Fagerström — Nicotina",
  msi_bpd: "MSI-BPD — Traços Borderline",
  assist: "ASSIST — Uso de Substâncias (OMS)",
};

const SCALE_MAX: Record<string, number> = {
  phq9: 27,
  gad7: 21,
  audit: 40,
  fagerstrom: 10,
};

const BAND_CHIP: Record<string, string> = {
  minimal: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  mild: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  moderate: "border-orange-400/30 bg-orange-400/10 text-orange-300",
  moderately_severe: "border-red-400/30 bg-red-400/10 text-red-300",
  severe: "border-red-400/40 bg-red-400/15 text-red-200",
  crisis: "border-slate-400/30 bg-slate-400/10 text-slate-300",
  informative: "border-slate-400/30 bg-slate-400/10 text-slate-300",
  low_risk: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  risky_use: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  harmful_use: "border-orange-400/30 bg-orange-400/10 text-orange-300",
  probable_dependence: "border-red-400/40 bg-red-400/15 text-red-200",
  very_low: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  low: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  medium: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  high: "border-orange-400/30 bg-orange-400/10 text-orange-300",
  very_high: "border-red-400/40 bg-red-400/15 text-red-200",
  negative: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  positive: "border-orange-400/30 bg-orange-400/10 text-orange-300",
  moderate_risk: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  high_risk: "border-red-400/40 bg-red-400/15 text-red-200",
};

const BAND_RING: Record<string, string> = {
  minimal: "#34D399",
  mild: "#FBBF24",
  moderate: "#FB923C",
  moderately_severe: "#F87171",
  severe: "#F87171",
  low_risk: "#34D399",
  risky_use: "#FBBF24",
  harmful_use: "#FB923C",
  probable_dependence: "#F87171",
  very_low: "#34D399",
  low: "#34D399",
  medium: "#FBBF24",
  high: "#FB923C",
  very_high: "#F87171",
};

/** Delay escalonado p/ blocos da devolutiva (reveal CSS existente). */
function staggerStyle(step: number, base = 0): CSSProperties {
  return { animationDelay: `${base + step * 0.09}s` };
}

function ScoreGauge({ score, max, band }: { score: number; max: number; band: string }) {
  const C = 2 * Math.PI * 52;
  const frac = max > 0 ? Math.min(Math.max(score / max, 0), 1) : 0;
  const color = BAND_RING[band] ?? "#9486C9";
  const offset = C * (1 - frac);
  return (
    <div className="relative h-[124px] w-[124px] shrink-0" aria-hidden>
      <svg viewBox="0 0 120 120" className="h-full w-full">
        <circle cx="60" cy="60" r="52" fill="none" stroke="var(--noir-line)" strokeWidth="7" />
        <circle
          cx="60"
          cy="60"
          r="52"
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={offset}
          transform="rotate(-90 60 60)"
          className="gauge-arc"
          style={
            {
              "--gauge-circ": C,
              filter: `drop-shadow(0 0 8px ${color}55)`,
            } as CSSProperties
          }
        />
      </svg>
      <div className="reveal reveal-band absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold leading-none text-foreground">{score}</span>
        <span className="mt-1 text-xs text-muted-foreground">de {max}</span>
      </div>
    </div>
  );
}

// Ilha CLARA estática (clinical-safety): sem animação — legibilidade em crise.
function CrisisResources() {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 mb-6">
      <p className="font-medium text-slate-700 mb-2 text-sm">Canais de apoio disponíveis 24h</p>
      <div className="space-y-1 text-sm text-slate-600">
        <p>
          <a href="tel:188" className="underline font-medium">CVV — 188</a> · Ligação gratuita
        </p>
        <p>
          <a href="https://cvv.org.br" target="_blank" rel="noopener noreferrer" className="underline">cvv.org.br</a> · Chat 24h
        </p>
        <p>
          <a href="tel:192" className="underline font-medium">SAMU — 192</a> · Emergência
        </p>
      </div>
    </div>
  );
}

export default function ResultadoClient() {
  const searchParams = useSearchParams();
  const sid = searchParams.get("sid") ?? "";
  const scale = searchParams.get("scale") ?? "";
  const score = parseInt(searchParams.get("score") ?? "0", 10);
  const band = searchParams.get("band") ?? "";
  const label = searchParams.get("label") ?? band;
  const isCrisis = searchParams.get("crisis") === "true";
  const series = searchParams.get("series") ?? "";

  const [devolutiva, setDevolutiva] = useState<Devolutiva | null>(null);
  const [loading, setLoading] = useState(true);
  const [consented, setConsented] = useState(false);
  const [consentSaved, setConsentSaved] = useState(false);

  const [emailPdf, setEmailPdf] = useState("");
  const [emailState, setEmailState] = useState<"idle" | "sending" | "done" | "error">("idle");

  const trackingEnabled = process.env.NEXT_PUBLIC_CHECKUP_TRACKING_ENABLED === "true";
  const [trackEmail, setTrackEmail] = useState("");
  const [trackConsent, setTrackConsent] = useState(false);
  const [trackState, setTrackState] = useState<"idle" | "saving" | "done" | "error">("idle");

  const handleConsent = (checked: boolean) => {
    setConsented(checked);
    if (!checked || consentSaved || !sid || !scale || !band) return;
    fetch("/api/result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: sid,
        scaleId: scale,
        totalScore: score,
        band,
        crisisFlag: isCrisis,
        consented: true,
      }),
    })
      .then((r) => {
        if (r.ok) setConsentSaved(true);
      })
      .catch(() => {});
  };

  const handleEmailPdf = (e: FormEvent) => {
    e.preventDefault();
    if (!emailPdf || emailState === "sending") return;
    setEmailState("sending");
    fetch("/api/email-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sid, email: emailPdf, scale, score, band, label, crisis: isCrisis }),
    })
      .then((r) => {
        setEmailState(r.ok ? "done" : "error");
        if (r.ok)
          void fetch("/api/events", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ event: "email_report_sent", sessionId: sid, scaleId: scale }),
          }).catch(() => {});
      })
      .catch(() => setEmailState("error"));
  };

  const handleTracking = (e: FormEvent) => {
    e.preventDefault();
    if (!trackConsent || !trackEmail || !sid || !scale || !band || isCrisis) return;
    setTrackState("saving");
    fetch("/api/tracking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: sid,
        consent: true,
        email: trackEmail,
        scaleId: scale,
        totalScore: score,
        band,
        crisis: isCrisis,
      }),
    })
      .then((r) => setTrackState(r.ok ? "done" : "error"))
      .catch(() => setTrackState("error"));
  };

  useEffect(() => {
    if (!scale || !band) {
      setLoading(false);
      return;
    }

    const input = {
      scaleId: scale as import("@/lib/scales/types").ScaleId,
      totalScore: score,
      band,
      bandLabel: label,
    };

    fetch("/api/devolutiva", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, sessionId: sid || undefined }),
    })
      .then((r) => {
        if (r.status === 429 || !r.ok) return null;
        return r.json();
      })
      .then((data) => {
        setDevolutiva(data ?? getFallback(input));
      })
      .catch(() => {
        setDevolutiva(getFallback(input));
      })
      .finally(() => setLoading(false));
  }, [scale, band, score, label, sid]);

  useEffect(() => {
    if (!trackingEnabled || !series || isCrisis || !scale || !band) return;
    fetch("/api/tracking/point", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: series, totalScore: score, band, crisis: isCrisis }),
    }).catch(() => {});
  }, [trackingEnabled, series, isCrisis, scale, band, score]);

  const assistSub = scale === "assist" ? decodeAssistResult(searchParams.get("sub") ?? "") : [];
  const assistInj = scale === "assist" && searchParams.get("inj") === "1";

  const pdfHref = `/api/pdf?scale=${scale}&score=${score}&band=${band}&label=${encodeURIComponent(label)}&crisis=${isCrisis}&rid=${sid.slice(0, 8)}${scale === "assist" ? `&sub=${encodeURIComponent(searchParams.get("sub") ?? "")}&inj=${assistInj ? "1" : "0"}` : ""}`;
  const max = SCALE_MAX[scale];

  // Stagger da devolutiva: gauge já rodou durante o fetch — blocos entram em sequência.
  const devBase = 0.12;
  const leituraOffset = 1;
  const limitesStep = leituraOffset + (devolutiva?.leitura.length ?? 0);
  const passosHeaderStep = limitesStep + 1;

  return (
    <main className="mx-auto min-h-screen w-full max-w-lg px-4 py-12 sm:px-6">
      {isCrisis && <CrisisResources />}

      {/* CTA Instagram no topo — nunca na versão crise (clinical-safety: zero marketing em crise). */}
      {!isCrisis && (
        <InstagramCta sessionId={sid || undefined} scaleId={scale || undefined} className="reveal mb-6" />
      )}

      <section className="glass-noir-deep reveal mb-8 rounded-3xl p-6 sm:p-7">
        <p className="eyebrow reveal mb-4">Seu resultado · {SCALE_NAMES[scale] ?? scale}</p>
        {scale === "assist" ? (
          <div>
            {assistSub.length === 0 ? (
              <p className="reveal reveal-band text-sm leading-relaxed text-muted-foreground">
                Você não relatou uso de substâncias ao longo da vida — risco baixo neste
                momento.
              </p>
            ) : (
              <div className="space-y-2.5">
                {assistSub.map((s, i) => (
                  <div
                    key={s.id}
                    className="reveal flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-xl border border-border bg-card/60 px-4 py-3"
                    style={staggerStyle(i, 0.85)}
                  >
                    <span className="text-sm font-medium capitalize text-foreground">
                      {s.short}
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="font-mono text-xs text-muted-foreground">{s.score}</span>
                      <span
                        className={`inline-block rounded-full border px-2.5 py-1 text-xs font-medium ${BAND_CHIP[s.band] ?? "border-slate-400/30 bg-slate-400/10 text-slate-300"}`}
                      >
                        {s.bandLabel}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
            {assistInj && (
              <div
                className="reveal mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"
                style={staggerStyle(assistSub.length, 0.85)}
              >
                <p className="text-sm leading-relaxed text-amber-800">
                  Você relatou uso de drogas injetáveis. Esse padrão merece uma conversa com
                  um profissional de saúde o quanto antes — o CAPS AD atende gratuitamente
                  pelo SUS, sem julgamento.
                </p>
              </div>
            )}
          </div>
        ) : band === "informative" || max === undefined ? (
          <span
            className={`reveal reveal-band inline-block rounded-full border px-3.5 py-1.5 text-sm font-medium ${BAND_CHIP[band] ?? "border-slate-400/30 bg-slate-400/10 text-slate-300"}`}
          >
            {label}
          </span>
        ) : (
          <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:gap-6 sm:text-left">
            <ScoreGauge score={score} max={max} band={band} />
            <div className="space-y-2">
              <span
                className={`reveal reveal-band inline-block rounded-full border px-3.5 py-1.5 text-sm font-medium ${BAND_CHIP[band] ?? "border-slate-400/30 bg-slate-400/10 text-slate-300"}`}
              >
                {label}
              </span>
              <p className="reveal reveal-band-2 text-xs leading-relaxed text-muted-foreground">
                Faixa do seu escore neste instrumento de triagem.
              </p>
            </div>
          </div>
        )}
      </section>

      {loading ? (
        <div className="animate-pulse space-y-3" aria-label="Preparando sua devolutiva">
          <div className="h-5 w-3/4 rounded-lg bg-muted" />
          <div className="h-4 w-full rounded-lg bg-muted" />
          <div className="h-4 w-full rounded-lg bg-muted" />
          <div className="h-4 w-2/3 rounded-lg bg-muted" />
        </div>
      ) : devolutiva ? (
        <div className="space-y-7">
          <p
            className="reveal text-lg leading-relaxed text-foreground"
            style={staggerStyle(0, devBase)}
          >
            {devolutiva.acolhimento}
          </p>

          <div className="space-y-3">
            {devolutiva.leitura.map((l, i) => (
              <p
                key={i}
                className="reveal leading-relaxed text-muted-foreground"
                style={staggerStyle(leituraOffset + i, devBase)}
              >
                {l}
              </p>
            ))}
          </div>

          <div
            className="reveal glass-noir flex gap-3 rounded-2xl p-4"
            style={staggerStyle(limitesStep, devBase)}
          >
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-purple-light" aria-hidden />
            <p className="text-sm leading-relaxed text-muted-foreground">{devolutiva.limites}</p>
          </div>

          <div>
            <p
              className="reveal mb-3 font-display text-xl font-semibold text-foreground"
              style={staggerStyle(passosHeaderStep, devBase)}
            >
              Próximos passos
            </p>
            <ul className="space-y-3">
              {devolutiva.proximos_passos.map((p, i) => (
                <li
                  key={i}
                  className="reveal flex gap-3 text-sm leading-relaxed text-muted-foreground"
                  style={staggerStyle(passosHeaderStep + 1 + i, devBase)}
                >
                  <span
                    className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-purple/15 font-mono text-[0.65rem] font-semibold text-purple-light"
                    aria-hidden
                  >
                    {i + 1}
                  </span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {!loading && !isCrisis && (
        <section
          className="reveal glass-noir-deep relative mt-10 overflow-hidden rounded-3xl p-6 sm:p-7"
          style={staggerStyle(
            passosHeaderStep + 1 + (devolutiva?.proximos_passos.length ?? 0),
            devBase,
          )}
        >
          <div className="aurora pointer-events-none absolute inset-0" aria-hidden />
          <div className="relative">
            <div className="mb-4 flex items-start gap-4">
              <span
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-purple/25 bg-purple/10 text-purple-light"
                aria-hidden
              >
                <FileDown className="h-5 w-5" />
              </span>
              <div>
                <p className="font-display text-xl font-semibold leading-snug text-foreground">
                  Leve este resultado ao seu médico
                </p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Relatório em PDF com seu escore e a faixa, gerado pelo{" "}
                  <strong className="text-foreground">Cérebro Amigo</strong>.
                </p>
              </div>
            </div>
            <a
              href={pdfHref}
              onClick={() =>
                fetch("/api/events", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ event: "report_generated", sessionId: sid, scaleId: scale }),
                }).catch(() => {})
              }
              className="btn-noir w-full"
            >
              Baixar relatório PDF
            </a>
            <p className="mt-2.5 text-center text-xs text-muted-foreground">
              Para levar ao seu médico ou psicólogo.
            </p>

            <hr className="my-5 border-white/10" />
            {emailState === "done" ? (
              <p className="text-center text-sm text-purple-light">✓ Relatório enviado para {emailPdf}</p>
            ) : (
              <form onSubmit={handleEmailPdf} className="space-y-2">
                <p className="text-sm font-medium text-foreground">Receber o PDF por e-mail</p>
                <div className="flex gap-2">
                  <input
                    type="email"
                    required
                    value={emailPdf}
                    onChange={(e) => setEmailPdf(e.target.value)}
                    placeholder="seu@email.com"
                    autoComplete="email"
                    disabled={emailState === "sending"}
                    className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-purple/40 focus:outline-none disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={!emailPdf || emailState === "sending"}
                    className="shrink-0 rounded-xl border border-purple/25 bg-purple/10 px-4 py-2 text-sm font-medium text-purple-light transition hover:bg-purple/20 disabled:opacity-50"
                  >
                    {emailState === "sending" ? "Enviando…" : "Enviar"}
                  </button>
                </div>
                {emailState === "error" && (
                  <p className="text-xs text-amber-300">Não foi possível enviar agora. Tente de novo.</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Seu e-mail não é salvo — usamos só para enviar o PDF.
                </p>
              </form>
            )}
          </div>
        </section>
      )}

      {!loading && scale && band && (
        <div
          className="reveal mt-8"
          style={staggerStyle(
            passosHeaderStep + 2 + (devolutiva?.proximos_passos.length ?? 0),
            devBase,
          )}
        >
          <label className="glass-noir flex cursor-pointer items-start gap-3 rounded-2xl p-4">
            <input
              type="checkbox"
              checked={consented}
              onChange={(e) => handleConsent(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-(--purple)"
            />
            <span className="text-sm leading-relaxed text-muted-foreground">
              Guardar meu resultado de forma anônima para ajudar a melhorar o Check-up.
              Nada que te identifique é salvo — só a escala, o escore e a faixa.
            </span>
          </label>
          {consentSaved && (
            <p className="mt-2 text-xs text-purple-light">✓ Resultado guardado anonimamente. Obrigado.</p>
          )}
        </div>
      )}

      {trackingEnabled && !series && !loading && !isCrisis && scale && band && (
        <section
          className="reveal glass-noir mt-8 rounded-2xl p-5"
          style={staggerStyle(
            passosHeaderStep + 3 + (devolutiva?.proximos_passos.length ?? 0),
            devBase,
          )}
        >
          {trackState === "done" ? (
            <p className="text-sm leading-relaxed text-purple-light">
              ✓ Pronto. Em 14 dias te lembramos por e-mail de refazer e ver sua evolução.
              Você pode cancelar ou apagar seus dados a qualquer momento pelo link do e-mail.
            </p>
          ) : (
            <form onSubmit={handleTracking}>
              <p className="font-display text-lg font-semibold leading-snug text-foreground">
                Acompanhar sua evolução
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Quer ver como isso muda com o tempo? Deixe seu e-mail e te lembramos de
                refazer o Check-up em 14 dias.
              </p>
              <input
                type="email"
                required
                value={trackEmail}
                onChange={(e) => setTrackEmail(e.target.value)}
                placeholder="seu@email.com"
                autoComplete="email"
                className="mt-3 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-purple/40 focus:outline-none"
              />
              <label className="mt-3 flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={trackConsent}
                  onChange={(e) => setTrackConsent(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-(--purple)"
                />
                <span className="text-xs leading-relaxed text-muted-foreground">
                  Guardamos seus escores ao longo do tempo e seu e-mail (cifrado) só para te
                  lembrar e mostrar sua evolução. Não é diagnóstico. Você apaga quando quiser.
                </span>
              </label>
              <button
                type="submit"
                disabled={!trackConsent || !trackEmail || trackState === "saving"}
                className="btn-noir mt-3 w-full disabled:opacity-50"
              >
                {trackState === "saving" ? "Salvando..." : "Quero acompanhar"}
              </button>
              {trackState === "error" && (
                <p className="mt-2 text-xs text-amber-300">Não deu pra salvar agora. Tente de novo.</p>
              )}
            </form>
          )}
        </section>
      )}

      {!isCrisis && (
        <p className="mt-7 text-center text-xs text-muted-foreground">
          Se precisar de apoio: <a href="tel:188" className="underline underline-offset-2">CVV 188</a> · 24h
        </p>
      )}

      {trackingEnabled && series && !isCrisis && (
        <div className="mt-6 text-center">
          <Link
            href={`/evolucao?t=${encodeURIComponent(series)}`}
            className="text-sm text-purple-light underline-offset-2 hover:underline"
          >
            Ver minha evolução →
          </Link>
        </div>
      )}

      <div className="mt-8 text-center">
        <Link href="/" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
          ← Fazer outro teste
        </Link>
      </div>
    </main>
  );
}
