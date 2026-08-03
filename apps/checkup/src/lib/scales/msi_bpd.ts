// src/lib/scales/msi_bpd.ts
// MSI-BPD — McLean Screening Instrument for Borderline Personality Disorder
// (Zanarini et al., 2003). 10 itens sim/não.
//
// ⚠️ SCORING QUALITATIVO, SEM VERDICT (mesma decisão do ASRS-18): o cutoff ≥7
// é da amostra americana; não localizamos validação psicométrica brasileira com
// ponto de corte publicado. Até existir (reabrir por ADR), o resultado é
// informativo — nunca "triagem positiva/negativa". Transtorno de personalidade
// é rótulo sensível; a devolutiva é SEMPRE estática (sem LLM), revisada à mão.
//
// 🚨 ITEM 2 É ITEM DE CRISE: pergunta sobre autolesão/tentativas de suicídio.
// Resposta "sim" desvia IMEDIATAMENTE para /crise (docs/CRISIS-PROTOCOL.md),
// antes de qualquer escore — mesma mecânica do item 9 do PHQ-9.
//
// VALIDADO: texto conferido pelo responsável clínico (Patrick, 2026-06-12).
// Permanece SEM VERDICT até existir validação BR com cutoff publicado
// (reabrir por ADR).

import type { Scale, ScaleResult } from "./types";

const SIM_NAO = [
  { value: 1, label: "Sim" },
  { value: 0, label: "Não" },
];

export const msiBpd: Scale = {
  id: "msi_bpd",
  name: "MSI-BPD",
  timeframe: "padrões ao longo da vida adulta",
  instructions:
    "As perguntas a seguir são sobre padrões de sentimentos e comportamentos que podem ter aparecido em diferentes momentos da sua vida adulta. Responda com sinceridade — não há respostas certas ou erradas.",
  options: SIM_NAO,
  items: [
    {
      index: 1,
      text: "Alguns dos seus relacionamentos mais próximos foram marcados por muitos altos e baixos, com idas e vindas?",
    },
    {
      index: 2,
      text: "Você já se machucou de propósito (por exemplo, se cortando ou se queimando) ou já fez tentativas de suicídio?",
      isCrisisItem: true,
    },
    {
      index: 3,
      text: "Você já teve pelo menos dois outros problemas com impulsividade (como comer descontroladamente, gastar demais, beber em excesso ou explosões verbais)?",
    },
    {
      index: 4,
      text: "Você tem mudanças de humor intensas e frequentes?",
    },
    {
      index: 5,
      text: "Você sente raiva intensa com frequência, ou age com raiva de um jeito que depois considera inadequado?",
    },
    {
      index: 6,
      text: "Você já ficou desconfiado(a) de outras pessoas sem motivo claro, ou se sentiu distante de tudo, como se as coisas não fossem reais?",
    },
    {
      index: 7,
      text: "Você se sente cronicamente vazio(a)?",
    },
    {
      index: 8,
      text: "Você costuma sentir que não sabe quem você é, ou que não tem identidade própria?",
    },
    {
      index: 9,
      text: "Você já fez esforços desesperados para evitar se sentir abandonado(a) ou para evitar ser abandonado(a) (como ligar repetidamente para alguém ou implorar para a pessoa não ir embora)?",
    },
    {
      index: 10,
      text: "O medo de ser abandonado(a) já fez você agir de formas que normalmente não agiria?",
    },
  ],
  bands: [
    // Sem cutoff validado p/ BR → banda única informativa (precedente: ASRS-18).
    { min: 0, max: 10, band: "informative", bandLabel: "resultado informativo" },
  ],
  // VALIDADO: texto conferido pelo responsável clínico (Patrick, 2026-06-12)
  // contra a fonte indicada em `source`. Mudança de item exige nova conferência.
  validated: true,
  source:
    "MSI-BPD (Zanarini et al., J Pers Disord, 2003) — tradução pt-BR a confirmar contra versão brasileira publicada",
};

export function scoreMsiBpd(answers: number[]): ScaleResult {
  if (answers.length !== msiBpd.items.length) {
    throw new Error(
      `scoreMsiBpd: esperado ${msiBpd.items.length} respostas, recebido ${answers.length}`
    );
  }
  for (const a of answers) {
    if (a !== 0 && a !== 1) {
      throw new Error(`scoreMsiBpd: valor inválido ${a}; deve ser 0 ou 1`);
    }
  }
  const totalScore = answers.reduce((sum, a) => sum + a, 0);
  // Item 2 (índice 1) = autolesão/tentativas → crise (a UI desvia antes;
  // o flag cobre qualquer caminho que chegue ao scoring com "sim").
  const crisisFlag = answers[1] > 0;
  const scoreBand = msiBpd.bands[0];
  return {
    scaleId: "msi_bpd",
    answers: [...answers],
    totalScore,
    band: scoreBand.band,
    bandLabel: scoreBand.bandLabel,
    crisisFlag,
  };
}
