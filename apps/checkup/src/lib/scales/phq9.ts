// src/lib/scales/phq9.ts
// PHQ-9 — versão oficial brasileira, formato AUTORRELATO (tradução Pfizer/MapiTrust;
// back-translation Fraguas Jr. et al., 2006), distribuída em phqscreeners.com.
// NÃO confundir com a versão de Santos et al. (2013), que é aplicada por entrevistador
// e usa opções de resposta modificadas (nenhum dia / menos de uma semana / ...).
// VALIDADO: conferido caractere a caractere contra o PDF oficial "Portuguese for Brazil"
// do phqscreeners.com (2026-06-11). Notação de gênero (a)/(o) e ortografia moderna são
// house style do app — não alteram o conteúdo clínico do instrumento oficial.

import type { Scale, ScaleResult } from "./types";

export const phq9: Scale = {
  id: "phq9",
  name: "PHQ-9",
  timeframe: "últimas 2 semanas",
  instructions:
    "Durante as últimas 2 semanas, com que frequência você foi incomodado(a) por qualquer um dos problemas abaixo?",
  options: [
    { value: 0, label: "Nenhuma vez" },
    { value: 1, label: "Vários dias" },
    { value: 2, label: "Mais da metade dos dias" },
    { value: 3, label: "Quase todos os dias" },
  ],
  items: [
    { index: 1, text: "Pouco interesse ou pouco prazer em fazer as coisas" },
    { index: 2, text: "Se sentir \"para baixo\", deprimido(a) ou sem perspectiva" },
    { index: 3, text: "Dificuldade para pegar no sono ou permanecer dormindo, ou dormir mais do que de costume" },
    { index: 4, text: "Se sentir cansado(a) ou com pouca energia" },
    { index: 5, text: "Falta de apetite ou comendo demais" },
    { index: 6, text: "Se sentir mal consigo mesmo(a) — ou achar que você é um fracasso ou que decepcionou sua família ou você mesmo(a)" },
    { index: 7, text: "Dificuldade para se concentrar nas coisas, como ler o jornal ou ver televisão" },
    { index: 8, text: "Lentidão para se movimentar ou falar a ponto das outras pessoas perceberem, ou o oposto: estar tão agitado(a) ou irrequieto(a) que você fica andando de um lado para o outro muito mais do que de costume" },
    { index: 9, text: "Pensar em se ferir de alguma maneira ou que seria melhor estar morto(a)", isCrisisItem: true },
  ],
  bands: [
    { min: 0, max: 4, band: "minimal", bandLabel: "sintomas mínimos" },
    { min: 5, max: 9, band: "mild", bandLabel: "sintomas leves" },
    { min: 10, max: 14, band: "moderate", bandLabel: "sintomas moderados" },
    { min: 15, max: 19, band: "moderately_severe", bandLabel: "sintomas moderadamente graves" },
    { min: 20, max: 27, band: "severe", bandLabel: "sintomas graves" },
  ],
  // Conferido char-a-char contra PDF oficial phqscreeners "Portuguese for Brazil" (2026-06-11):
  // conteúdo bate (itens 1-7,9 e opções idênticos; item 8 corrigido — faltava "muito").
  // Cosmética decidida (Patrick, 2026-06-11): notação (a)/(o) + ortografia moderna = house style.
  validated: true,
  source: "PHQ-9 oficial PT-BR, autorrelato (tradução Pfizer/MapiTrust; back-translation Fraguas Jr. et al., J Affect Disord 2006; phqscreeners.com)",
};

export function scorePhq9(answers: number[]): ScaleResult {
  if (answers.length !== phq9.items.length) {
    throw new Error(
      `scorePhq9: esperado ${phq9.items.length} respostas, recebido ${answers.length}`
    );
  }
  for (const a of answers) {
    if (!Number.isInteger(a) || a < 0 || a > 3) {
      throw new Error(`scorePhq9: valor inválido ${a}; deve ser 0–3`);
    }
  }
  const totalScore = answers.reduce((sum, a) => sum + a, 0);
  const crisisFlag = answers[8] > 0;
  const scoreBand = phq9.bands.find((b) => totalScore >= b.min && totalScore <= b.max)!;
  return {
    scaleId: "phq9",
    answers: [...answers],
    totalScore,
    band: scoreBand.band,
    bandLabel: scoreBand.bandLabel,
    crisisFlag,
  };
}
