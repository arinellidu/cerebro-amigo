// src/lib/scales/audit.ts
// AUDIT — Alcohol Use Disorders Identification Test (OMS, Babor et al.).
// Versão brasileira validada (Lima et al., 2005; Méndez, 1999), a mesma adotada
// pelo material SUPERA (SENAD/Ministério da Saúde, UNIFESP).
//
// VALIDADO: texto conferido pelo responsável clínico (Patrick, 2026-06-12).
// Fonte para re-conferência: PDF oficial do SUPERA ("bloco_Audit.pdf",
// supera.org.br) / roteiro AUDIT da OMS em português (OPAS).
//
// Estrutura: 10 itens sobre os últimos 12 meses. Itens 1–8 pontuam 0–4;
// itens 9–10 pontuam 0/2/4. Escore 0–40. Zonas da OMS: I 0–7 (baixo risco),
// II 8–15 (uso de risco), III 16–19 (uso nocivo), IV 20–40 (provável dependência).
// Uso livre (instrumento da OMS).

import type { Scale, ScaleResult } from "./types";

const FREQ_12M = [
  { value: 0, label: "Nunca" },
  { value: 1, label: "Menos do que uma vez ao mês" },
  { value: 2, label: "Mensalmente" },
  { value: 3, label: "Semanalmente" },
  { value: 4, label: "Todos ou quase todos os dias" },
];

const VIDA_0_2_4 = [
  { value: 0, label: "Não" },
  { value: 2, label: "Sim, mas não nos últimos 12 meses" },
  { value: 4, label: "Sim, nos últimos 12 meses" },
];

export const audit: Scale = {
  id: "audit",
  name: "AUDIT",
  timeframe: "últimos 12 meses",
  instructions:
    "As perguntas a seguir são sobre o seu consumo de bebidas alcoólicas nos últimos 12 meses. Considere como \"uma dose\" uma lata de cerveja, uma taça de vinho ou uma dose de destilado.",
  // Itens 3–8 compartilham as opções de frequência; 1, 2, 9 e 10 têm opções próprias.
  options: FREQ_12M,
  items: [
    {
      index: 1,
      text: "Com que frequência você toma bebidas de álcool?",
      options: [
        { value: 0, label: "Nunca" },
        { value: 1, label: "Mensalmente ou menos" },
        { value: 2, label: "De 2 a 4 vezes por mês" },
        { value: 3, label: "De 2 a 3 vezes por semana" },
        { value: 4, label: "4 ou mais vezes por semana" },
      ],
    },
    {
      index: 2,
      text: "Nas ocasiões em que bebe, quantas doses você consome tipicamente?",
      options: [
        { value: 0, label: "1 ou 2" },
        { value: 1, label: "3 ou 4" },
        { value: 2, label: "5 ou 6" },
        { value: 3, label: "7, 8 ou 9" },
        { value: 4, label: "10 ou mais" },
      ],
    },
    { index: 3, text: "Com que frequência você toma seis ou mais doses de uma vez?" },
    {
      index: 4,
      text: "Quantas vezes, ao longo dos últimos 12 meses, você achou que não conseguiria parar de beber uma vez tendo começado?",
    },
    {
      index: 5,
      text: "Quantas vezes, ao longo dos últimos 12 meses, você, por causa do álcool, não conseguiu fazer o que era esperado de você?",
    },
    {
      index: 6,
      text: "Quantas vezes, ao longo dos últimos 12 meses, você precisou beber pela manhã para se sentir bem ao longo do dia, após ter bebido bastante no dia anterior?",
    },
    {
      index: 7,
      text: "Quantas vezes, ao longo dos últimos 12 meses, você se sentiu culpado(a) ou com remorso depois de ter bebido?",
    },
    {
      index: 8,
      text: "Quantas vezes, ao longo dos últimos 12 meses, você foi incapaz de lembrar o que aconteceu devido à bebida?",
    },
    {
      index: 9,
      text: "Alguma vez na vida você já causou ferimentos ou prejuízos a você mesmo(a) ou a outra pessoa após ter bebido?",
      options: VIDA_0_2_4,
    },
    {
      index: 10,
      text: "Alguma vez na vida algum parente, amigo(a), médico(a) ou outro profissional de saúde já se preocupou com o fato de você beber ou sugeriu que você parasse?",
      options: VIDA_0_2_4,
    },
  ],
  bands: [
    { min: 0, max: 7, band: "low_risk", bandLabel: "consumo de baixo risco" },
    { min: 8, max: 15, band: "risky_use", bandLabel: "consumo de risco" },
    { min: 16, max: 19, band: "harmful_use", bandLabel: "consumo nocivo" },
    { min: 20, max: 40, band: "probable_dependence", bandLabel: "possível dependência" },
  ],
  // VALIDADO: texto conferido pelo responsável clínico (Patrick, 2026-06-12)
  // contra a fonte indicada em `source`. Mudança de item exige nova conferência.
  validated: true,
  source:
    "AUDIT (OMS, Babor et al.) — versão brasileira validada (Lima et al., 2005; Méndez, 1999), material SUPERA/SENAD-MS",
};

export function scoreAudit(answers: number[]): ScaleResult {
  if (answers.length !== audit.items.length) {
    throw new Error(
      `scoreAudit: esperado ${audit.items.length} respostas, recebido ${answers.length}`
    );
  }
  answers.forEach((a, i) => {
    const opts = audit.items[i].options ?? audit.options;
    if (!opts.some((o) => o.value === a)) {
      throw new Error(`scoreAudit: valor inválido ${a} no item ${i + 1}`);
    }
  });
  const totalScore = answers.reduce((sum, a) => sum + a, 0);
  const scoreBand = audit.bands.find((b) => totalScore >= b.min && totalScore <= b.max)!;
  return {
    scaleId: "audit",
    answers: [...answers],
    totalScore,
    band: scoreBand.band,
    bandLabel: scoreBand.bandLabel,
    crisisFlag: false,
  };
}
