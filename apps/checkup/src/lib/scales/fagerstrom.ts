// src/lib/scales/fagerstrom.ts
// FTND — Teste de Fagerström para Dependência de Nicotina (Heatherton et al., 1991).
// Versão brasileira validada por Carmo & Pueschel, 2002 — a mesma adotada nos
// materiais de tratamento do tabagismo do INCA/Ministério da Saúde.
//
// VALIDADO: texto conferido pelo responsável clínico (Patrick, 2026-06-12).
// Fonte para re-conferência: materiais oficiais do INCA/MS (protocolo de
// tratamento do tabagismo).
//
// Estrutura: 6 itens com pesos próprios (escore 0–10). Graus de dependência:
// 0–2 muito baixo · 3–4 baixo · 5 médio · 6–7 elevado · 8–10 muito elevado.

import type { Scale, ScaleResult } from "./types";

const SIM_NAO = [
  { value: 1, label: "Sim" },
  { value: 0, label: "Não" },
];

export const fagerstrom: Scale = {
  id: "fagerstrom",
  name: "Teste de Fagerström",
  timeframe: "hábito atual",
  instructions:
    "As perguntas a seguir são sobre o seu hábito de fumar cigarros atualmente. Responda pensando na sua rotina dos últimos tempos.",
  options: SIM_NAO,
  items: [
    {
      index: 1,
      text: "Quanto tempo após acordar você fuma o seu primeiro cigarro?",
      options: [
        { value: 3, label: "Nos primeiros 5 minutos" },
        { value: 2, label: "Entre 6 e 30 minutos" },
        { value: 1, label: "Entre 31 e 60 minutos" },
        { value: 0, label: "Após 60 minutos" },
      ],
    },
    {
      index: 2,
      text: "Você acha difícil não fumar em lugares proibidos, como igrejas, bibliotecas, cinemas ou ônibus?",
    },
    {
      index: 3,
      text: "Qual o cigarro do dia que traz mais satisfação (ou que mais detestaria deixar de fumar)?",
      options: [
        { value: 1, label: "O primeiro da manhã" },
        { value: 0, label: "Outros" },
      ],
    },
    {
      index: 4,
      text: "Quantos cigarros você fuma por dia?",
      options: [
        { value: 0, label: "Menos de 10" },
        { value: 1, label: "De 11 a 20" },
        { value: 2, label: "De 21 a 30" },
        { value: 3, label: "Mais de 31" },
      ],
    },
    {
      index: 5,
      text: "Você fuma mais frequentemente pela manhã (ou nas primeiras horas do dia) do que no resto do dia?",
    },
    {
      index: 6,
      text: "Você fuma mesmo doente, quando precisa ficar de cama a maior parte do tempo?",
    },
  ],
  bands: [
    { min: 0, max: 2, band: "very_low", bandLabel: "dependência muito baixa" },
    { min: 3, max: 4, band: "low", bandLabel: "dependência baixa" },
    { min: 5, max: 5, band: "medium", bandLabel: "dependência média" },
    { min: 6, max: 7, band: "high", bandLabel: "dependência elevada" },
    { min: 8, max: 10, band: "very_high", bandLabel: "dependência muito elevada" },
  ],
  // VALIDADO: texto conferido pelo responsável clínico (Patrick, 2026-06-12)
  // contra a fonte indicada em `source`. Mudança de item exige nova conferência.
  validated: true,
  source:
    "Teste de Fagerström (FTND, Heatherton et al., 1991) — versão brasileira validada (Carmo & Pueschel, 2002; materiais INCA/MS)",
};

export function scoreFagerstrom(answers: number[]): ScaleResult {
  if (answers.length !== fagerstrom.items.length) {
    throw new Error(
      `scoreFagerstrom: esperado ${fagerstrom.items.length} respostas, recebido ${answers.length}`
    );
  }
  answers.forEach((a, i) => {
    const opts = fagerstrom.items[i].options ?? fagerstrom.options;
    if (!opts.some((o) => o.value === a)) {
      throw new Error(`scoreFagerstrom: valor inválido ${a} no item ${i + 1}`);
    }
  });
  const totalScore = answers.reduce((sum, a) => sum + a, 0);
  const scoreBand = fagerstrom.bands.find((b) => totalScore >= b.min && totalScore <= b.max)!;
  return {
    scaleId: "fagerstrom",
    answers: [...answers],
    totalScore,
    band: scoreBand.band,
    bandLabel: scoreBand.bandLabel,
    crisisFlag: false,
  };
}
