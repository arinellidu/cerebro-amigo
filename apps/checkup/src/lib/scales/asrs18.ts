// src/lib/scales/asrs18.ts
// ASRS-18 v1.1 (OMS) — TDAH adulto, versão brasileira (Mattos P et al., Rev Psiq Clín, 2006).
//
// Itens transcritos da versão final (Tabela 2, Mattos 2006) — conferidos char-a-char
// (2026-06-11). House style do app: ortografia moderna ("freqüência"→"frequência") e
// notação de gênero (a)/(o), consistente com PHQ-9/GAD-7. Estrutura real: Parte A = 9
// itens (desatenção, índices 1-9), Parte B = 9 itens (hiperatividade-impulsividade, 10-18).
//
// ⚠️ SCORING QUALITATIVO, SEM VERDICT (decisão Patrick, 2026-06-11).
// Mattos 2006 é adaptação transcultural — adverte EXPLICITAMENTE que NÃO há dados/pontos
// de corte validados para a população brasileira e recomenda cautela em usar a pontuação
// dos itens ou tratar "algumas vezes" como positivo. Portanto NÃO aplicamos os cutoffs
// americanos (Kessler) nem a tabela de células sombreadas: o checkup só coleta e devolve
// de forma acolhedora ("leve a um profissional"), sem afirmar triagem positiva/negativa.
// Alinha com a regra do produto: triagem nunca é diagnóstico.

import type { Scale, ScaleResult } from "./types";

export const asrs18: Scale = {
  id: "asrs18",
  name: "ASRS-18 (v1.1)",
  timeframe: "últimos 6 meses",
  instructions:
    "Responda pensando em como você se sentiu e se comportou nos últimos 6 meses.",
  options: [
    { value: 0, label: "Nunca" },
    { value: 1, label: "Raramente" },
    { value: 2, label: "Algumas vezes" },
    { value: 3, label: "Frequentemente" },
    { value: 4, label: "Muito frequentemente" },
  ],
  items: [
    // Parte A — desatenção (itens 1-9)
    { index: 1, text: "Com que frequência você comete erros por falta de atenção quando tem de trabalhar num projeto chato ou difícil?" },
    { index: 2, text: "Com que frequência você tem dificuldade para manter a atenção quando está fazendo um trabalho chato ou repetitivo?" },
    { index: 3, text: "Com que frequência você tem dificuldade para se concentrar no que as pessoas dizem, mesmo quando elas estão falando diretamente com você?" },
    { index: 4, text: "Com que frequência você deixa um projeto pela metade depois de já ter feito as partes mais difíceis?" },
    { index: 5, text: "Com que frequência você tem dificuldade para fazer um trabalho que exige organização?" },
    { index: 6, text: "Quando você precisa fazer algo que exige muita concentração, com que frequência você evita ou adia o início?" },
    // typo no original ("tem de dificuldade de encontrar") corrigido para "tem dificuldade de encontrar"
    { index: 7, text: "Com que frequência você coloca as coisas fora do lugar ou tem dificuldade de encontrar as coisas em casa ou no trabalho?" },
    { index: 8, text: "Com que frequência você se distrai com atividades ou barulho a sua volta?" },
    { index: 9, text: "Com que frequência você tem dificuldade para lembrar de compromissos ou obrigações?" },
    // Parte B — hiperatividade-impulsividade (itens 10-18; B1-B9 no instrumento)
    { index: 10, text: "Com que frequência você fica se mexendo na cadeira ou balançando as mãos ou os pés quando precisa ficar sentado(a) por muito tempo?" },
    { index: 11, text: "Com que frequência você se levanta da cadeira em reuniões ou em outras situações onde deveria ficar sentado(a)?" },
    { index: 12, text: "Com que frequência você se sente inquieto(a) ou agitado(a)?" },
    { index: 13, text: "Com que frequência você tem dificuldade para sossegar e relaxar quando tem tempo livre para você?" },
    { index: 14, text: "Com que frequência você se sente ativo(a) demais e necessitando fazer coisas, como se estivesse \"com um motor ligado\"?" },
    { index: 15, text: "Com que frequência você se pega falando demais em situações sociais?" },
    { index: 16, text: "Quando você está conversando, com que frequência você se pega terminando as frases das pessoas antes delas?" },
    { index: 17, text: "Com que frequência você tem dificuldade para esperar nas situações onde cada um tem a sua vez?" },
    { index: 18, text: "Com que frequência você interrompe os outros quando eles estão ocupados?" },
  ],
  // Banda única neutra: sem positivo/negativo (sem cutoff validado p/ BR — ver cabeçalho).
  bands: [
    { min: 0, max: 72, band: "informative", bandLabel: "registro para conversar com um profissional" },
  ],
  validated: true,
  source: "ASRS-18 v1.1, versão brasileira (Mattos P et al., Rev Psiq Clín, 2006), Tabela 2",
};

export function scoreAsrs18(answers: number[]): ScaleResult {
  if (answers.length !== asrs18.items.length) {
    throw new Error(
      `scoreAsrs18: esperado ${asrs18.items.length} respostas, recebido ${answers.length}`
    );
  }
  for (const a of answers) {
    if (!Number.isInteger(a) || a < 0 || a > 4) {
      throw new Error(`scoreAsrs18: valor inválido ${a}; deve ser 0–4`);
    }
  }
  // totalScore é apenas informativo (0–72). NÃO é um verdict — sem cutoff validado p/ BR.
  const totalScore = answers.reduce((sum, a) => sum + a, 0);
  const band = asrs18.bands[0];
  return {
    scaleId: "asrs18",
    answers: [...answers],
    totalScore,
    band: band.band,
    bandLabel: band.bandLabel,
    crisisFlag: false,
  };
}
