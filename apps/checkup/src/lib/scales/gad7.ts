// src/lib/scales/gad7.ts
// GAD-7 — versão oficial brasileira, formato AUTORRELATO (tradução Pfizer/MapiTrust),
// distribuída em phqscreeners.com.
// VALIDADO: conferido char-a-char contra PDF oficial phqscreeners "Portuguese for Brazil"
// (2026-06-11) — itens 1-7, opções e enunciado IDÊNTICOS, sem defeito de conteúdo.
// Cosmética decidida (Patrick, 2026-06-11): notação (a)/(o) + ortografia moderna = house style,
// não altera o conteúdo clínico do instrumento oficial.

import type { Scale, ScaleResult } from "./types";

export const gad7: Scale = {
  id: "gad7",
  name: "GAD-7",
  timeframe: "últimas 2 semanas",
  instructions:
    "Durante as últimas 2 semanas, com que frequência você foi incomodado(a) pelos problemas abaixo?",
  options: [
    { value: 0, label: "Nenhuma vez" },
    { value: 1, label: "Vários dias" },
    { value: 2, label: "Mais da metade dos dias" },
    { value: 3, label: "Quase todos os dias" },
  ],
  items: [
    { index: 1, text: "Sentir-se nervoso(a), ansioso(a) ou muito tenso(a)" },
    { index: 2, text: "Não ser capaz de impedir ou de controlar as preocupações" },
    { index: 3, text: "Preocupar-se muito com diversas coisas" },
    { index: 4, text: "Dificuldade para relaxar" },
    { index: 5, text: "Ficar tão agitado(a) que se torna difícil permanecer sentado(a)" },
    { index: 6, text: "Ficar facilmente aborrecido(a) ou irritado(a)" },
    { index: 7, text: "Sentir medo como se algo horrível fosse acontecer" },
  ],
  bands: [
    { min: 0, max: 4, band: "minimal", bandLabel: "sintomas mínimos" },
    { min: 5, max: 9, band: "mild", bandLabel: "sintomas leves" },
    { min: 10, max: 14, band: "moderate", bandLabel: "sintomas moderados" },
    { min: 15, max: 21, band: "severe", bandLabel: "sintomas graves" },
  ],
  validated: true,
  source: "GAD-7 oficial PT-BR, autorrelato (tradução Pfizer/MapiTrust; phqscreeners.com)",
};

export function scoreGad7(answers: number[]): ScaleResult {
  if (answers.length !== gad7.items.length) {
    throw new Error(
      `scoreGad7: esperado ${gad7.items.length} respostas, recebido ${answers.length}`
    );
  }
  for (const a of answers) {
    if (!Number.isInteger(a) || a < 0 || a > 3) {
      throw new Error(`scoreGad7: valor inválido ${a}; deve ser 0–3`);
    }
  }
  const totalScore = answers.reduce((sum, a) => sum + a, 0);
  const scoreBand = gad7.bands.find((b) => totalScore >= b.min && totalScore <= b.max)!;
  return {
    scaleId: "gad7",
    answers: [...answers],
    totalScore,
    band: scoreBand.band,
    bandLabel: scoreBand.bandLabel,
    crisisFlag: false,
  };
}
