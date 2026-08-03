"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

// Tela de evolução do acompanhamento (ADR-050 Parte 2, Fase 4).
// clinical-safety: SÓ dados (escore + faixa validada por data). SEM narrativa de
// tendência, SEM "melhorou/piorou", SEM diagnóstico, SEM LLM. A IA não calcula escore.

const SCALE_NAMES: Record<string, string> = {
  phq9: "PHQ-9 — Depressão",
  gad7: "GAD-7 — Ansiedade",
  asrs18: "ASRS-18 — TDAH",
  audit: "AUDIT — Uso de Álcool",
  mdq: "MDQ — Bipolaridade",
  fagerstrom: "Fagerström — Nicotina",
  msi_bpd: "MSI-BPD — Traços Borderline",
  assist: "ASSIST — Uso de Substâncias",
};

// Escore máximo p/ a escala do gráfico (faixas qualitativas caem no máx observado).
const SCALE_MAX: Record<string, number> = { phq9: 27, gad7: 21, audit: 40, fagerstrom: 10 };

const BAND_COLOR: Record<string, string> = {
  minimal: "#34D399", mild: "#FBBF24", moderate: "#FB923C", moderately_severe: "#F87171", severe: "#F87171",
  low_risk: "#34D399", risky_use: "#FBBF24", harmful_use: "#FB923C", probable_dependence: "#F87171",
  very_low: "#34D399", low: "#34D399", medium: "#FBBF24", high: "#FB923C", very_high: "#F87171",
  negative: "#34D399", positive: "#FB923C", moderate_risk: "#FBBF24", high_risk: "#F87171",
};

interface Point {
  score: number;
  band: string;
  at: string;
}
interface Series {
  scaleId: string;
  points: Point[];
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

// Gráfico de linha SVG, determinístico. Só plota os dados — sem interpretar.
function EvolucaoChart({ points, max }: { points: Point[]; max: number }) {
  const W = 320;
  const H = 168;
  const padX = 28;
  const padY = 24;
  const plotW = W - padX * 2;
  const plotH = H - padY * 2;
  const n = points.length;
  const x = (i: number) => (n === 1 ? W / 2 : padX + (plotW * i) / (n - 1));
  const y = (s: number) => padY + plotH * (1 - Math.min(Math.max(s / max, 0), 1));
  const line = points.map((p, i) => `${x(i)},${y(p.score)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full" role="img" aria-label="Gráfico dos seus escores ao longo do tempo">
      {[0, 0.5, 1].map((f) => (
        <line key={f} x1={padX} x2={W - padX} y1={padY + plotH * f} y2={padY + plotH * f} stroke="var(--noir-line)" strokeWidth="1" />
      ))}
      {n > 1 && <polyline points={line} fill="none" stroke="#9486C9" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.score)} r="4.5" fill={BAND_COLOR[p.band] ?? "#9486C9"} />
          <text x={x(i)} y={y(p.score) - 11} textAnchor="middle" className="fill-foreground" style={{ fontSize: 13, fontWeight: 600 }}>
            {p.score}
          </text>
          <text x={x(i)} y={H - 6} textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 11 }}>
            {fmtDate(p.at)}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default function EvolucaoClient() {
  const token = useSearchParams().get("t") ?? "";
  const [state, setState] = useState<"loading" | "ok" | "notfound" | "error">("loading");
  const [series, setSeries] = useState<Series | null>(null);

  useEffect(() => {
    if (!token) {
      setState("notfound");
      return;
    }
    fetch(`/api/tracking/series?t=${encodeURIComponent(token)}`, { cache: "no-store" })
      .then((r) => {
        if (r.status === 404) return setState("notfound");
        if (!r.ok) return setState("error");
        return r.json().then((d: Series) => {
          setSeries(d);
          setState("ok");
        });
      })
      .catch(() => setState("error"));
  }, [token]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
      <section className="glass-noir rounded-3xl p-6 sm:p-7">
        <h1 className="font-display text-xl font-semibold leading-snug text-foreground">Sua evolução</h1>

        {state === "loading" && <p role="status" aria-live="polite" className="mt-3 text-sm text-muted-foreground">Carregando...</p>}

        {state === "notfound" && (
          <p role="status" aria-live="polite" className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Não encontramos seu acompanhamento. O link pode ter expirado ou os dados foram apagados.
          </p>
        )}

        {state === "error" && (
          <p role="alert" className="mt-3 text-sm leading-relaxed text-amber-300">Não deu pra carregar agora. Tente de novo.</p>
        )}

        {state === "ok" && series && (
          <>
            <p className="mt-1 text-sm text-muted-foreground">{SCALE_NAMES[series.scaleId] ?? series.scaleId}</p>
            <div className="mt-5">
              <EvolucaoChart
                points={series.points}
                max={SCALE_MAX[series.scaleId] ?? Math.max(...series.points.map((p) => p.score), 1)}
              />
            </div>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Seus escores ao longo do tempo. É um instrumento de triagem, não um diagnóstico —
              leve seus resultados ao seu médico ou psicólogo.
            </p>
            <Link href={`/teste/${series.scaleId}?series=${encodeURIComponent(token)}`} className="btn-noir mt-5 block w-full text-center">
              Refazer o teste agora
            </Link>
          </>
        )}

        <div className="mt-6 text-center">
          <Link href="/" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
            ← Voltar ao Check-up
          </Link>
        </div>
      </section>
    </main>
  );
}
