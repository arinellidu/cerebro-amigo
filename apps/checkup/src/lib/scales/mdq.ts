// src/lib/scales/mdq.ts
// MDQ — Mood Disorder Questionnaire (Hirschfeld et al., 2000), triagem de
// transtorno do espectro bipolar. Versão brasileira validada por
// Castelo et al., 2010 (Revista Brasileira de Psiquiatria).
//
// VALIDADO: texto conferido pelo responsável clínico (Patrick, 2026-06-12).
// Fonte para re-conferência: instrumento publicado na validação brasileira
// (Castelo MS et al., Rev Bras Psiquiatr, 2010).
//
// Estrutura oficial: 13 itens sim/não (sintomas, 1 ponto por "sim") +
// item 14 (simultaneidade, sim/não) + item 15 (prejuízo funcional, 4 níveis).
// Triagem POSITIVA exige as três condições: ≥7 "sim" nos itens 1–13 E
// simultaneidade ("sim" no 14) E prejuízo moderado ou sério (item 15).
// totalScore reportado = nº de "sim" nos itens 1–13 (0–13).

import type { Scale, ScaleResult } from "./types";

const SIM_NAO = [
  { value: 1, label: "Sim" },
  { value: 0, label: "Não" },
];

const STEM = "Alguma vez houve um período em que você não estava no seu jeito habitual e…";

export const mdq: Scale = {
  id: "mdq",
  name: "MDQ",
  timeframe: "ao longo da vida",
  instructions:
    "As perguntas a seguir são sobre períodos da sua vida em que você não estava no seu jeito habitual. Responda pensando se isso JÁ aconteceu alguma vez, mesmo que não esteja acontecendo agora.",
  options: SIM_NAO,
  items: [
    {
      index: 1,
      text: `${STEM} você se sentia tão bem ou tão animado(a) que outras pessoas acharam que você não estava no seu normal, ou tão animado(a) que se meteu em problemas?`,
    },
    {
      index: 2,
      text: `${STEM} você estava tão irritado(a) que gritava com as pessoas ou começava brigas ou discussões?`,
    },
    {
      index: 3,
      text: `${STEM} você se sentia muito mais autoconfiante do que de costume?`,
    },
    {
      index: 4,
      text: `${STEM} você dormia muito menos do que de costume e achava que isso não fazia falta?`,
    },
    {
      index: 5,
      text: `${STEM} você estava muito mais falante ou falava mais rápido do que de costume?`,
    },
    {
      index: 6,
      text: `${STEM} os pensamentos corriam pela sua cabeça e você não conseguia desacelerá-los?`,
    },
    {
      index: 7,
      text: `${STEM} você se distraía tão facilmente com as coisas ao seu redor que tinha dificuldade para se concentrar ou manter a linha de pensamento?`,
    },
    {
      index: 8,
      text: `${STEM} você tinha muito mais energia do que de costume?`,
    },
    {
      index: 9,
      text: `${STEM} você estava muito mais ativo(a) ou fazia muito mais coisas do que de costume?`,
    },
    {
      index: 10,
      text: `${STEM} você estava muito mais sociável ou extrovertido(a) do que de costume — por exemplo, telefonava para amigos no meio da noite?`,
    },
    {
      index: 11,
      text: `${STEM} você estava muito mais interessado(a) em sexo do que de costume?`,
    },
    {
      index: 12,
      text: `${STEM} você fazia coisas que não eram habituais para você ou que outras pessoas poderiam considerar exageradas, imprudentes ou arriscadas?`,
    },
    {
      index: 13,
      text: `${STEM} gastar dinheiro causou problemas para você ou para a sua família?`,
    },
    {
      index: 14,
      text: "Se você respondeu SIM a mais de uma das perguntas anteriores: várias dessas coisas aconteceram durante o MESMO período de tempo?",
    },
    {
      index: 15,
      text: "Até que ponto isso foi um problema para você — como não conseguir trabalhar, ter problemas familiares, financeiros ou legais, ou se envolver em discussões ou brigas?",
      options: [
        { value: 0, label: "Nenhum problema" },
        { value: 1, label: "Problema menor" },
        { value: 2, label: "Problema moderado" },
        { value: 3, label: "Problema sério" },
      ],
    },
  ],
  bands: [
    // bands por triagem (não por soma): scoreMdq decide positive/negative
    // pelas 3 condições oficiais; min/max aqui cobrem o totalScore 0–13.
    { min: 0, max: 13, band: "negative", bandLabel: "triagem negativa" },
    { min: 0, max: 13, band: "positive", bandLabel: "triagem positiva" },
  ],
  // VALIDADO: texto conferido pelo responsável clínico (Patrick, 2026-06-12)
  // contra a fonte indicada em `source`. Mudança de item exige nova conferência.
  validated: true,
  source:
    "MDQ (Hirschfeld et al., 2000) — versão brasileira validada (Castelo MS et al., Rev Bras Psiquiatr, 2010)",
};

export function scoreMdq(answers: number[]): ScaleResult {
  if (answers.length !== mdq.items.length) {
    throw new Error(
      `scoreMdq: esperado ${mdq.items.length} respostas, recebido ${answers.length}`
    );
  }
  answers.forEach((a, i) => {
    const opts = mdq.items[i].options ?? mdq.options;
    if (!opts.some((o) => o.value === a)) {
      throw new Error(`scoreMdq: valor inválido ${a} no item ${i + 1}`);
    }
  });

  // Itens 1–13 somam; 14 (simultaneidade) e 15 (prejuízo) são critérios, não pontos.
  const totalScore = answers.slice(0, 13).reduce((sum, a) => sum + a, 0);
  const simultaneo = answers[13] === 1;
  const prejuizoModeradoOuSerio = answers[14] >= 2;
  const positive = totalScore >= 7 && simultaneo && prejuizoModeradoOuSerio;
  const scoreBand = mdq.bands.find((b) => b.band === (positive ? "positive" : "negative"))!;

  return {
    scaleId: "mdq",
    answers: [...answers],
    totalScore,
    band: scoreBand.band,
    bandLabel: scoreBand.bandLabel,
    crisisFlag: false,
  };
}
