// src/lib/scales/assist.ts
// ASSIST v3.0 — Alcohol, Smoking and Substance Involvement Screening Test (OMS).
// Versão brasileira validada (Henrique IFS et al., Rev Assoc Med Bras, 2004),
// a mesma adotada pelo material SUPERA (SENAD/Ministério da Saúde).
//
// VALIDADO: texto conferido pelo responsável clínico (Patrick, 2026-06-13).
// Fonte para re-conferência: Henrique et al. 2004 / material SUPERA
// ("bloco ASSIST"). Mudança de item exige nova conferência.
//
// ESTRUTURA (diferente do motor genérico — por isso módulo próprio, ADR-049):
//  - Q1: uso NA VIDA por classe de substância (10 classes, multi-seleção);
//  - Q2–Q5: últimos 3 meses, POR substância usada (Q2=nunca pula Q3–Q5;
//    tabaco não tem Q5 — regras oficiais do instrumento);
//  - Q6–Q7: na vida, POR substância usada;
//  - Q8: uso injetável (global; não soma — flag de atenção).
//  - Escore por substância (SSI) = Q2+Q3+Q4+Q5+Q6+Q7.
//  - Faixas: álcool 0–10/11–26/27+; demais 0–3/4–26/27+ (baixo/moderado/alto).
//
// Administração nesta superfície (decisões ADR-049, sem alterar itens):
//  - a opção "outras" de Q1 existe, mas NÃO coletamos especificação em texto
//    livre (o produto não tem campo livre — LGPD/clinical-safety);
//  - devolutiva SEMPRE estática (sem LLM) — substâncias são tema sensível.

export type SubstanceId =
  | "tabaco"
  | "alcool"
  | "maconha"
  | "cocaina"
  | "anfetaminas"
  | "inalantes"
  | "sedativos"
  | "alucinogenos"
  | "opioides"
  | "outras";

export interface AssistOption {
  value: number;
  label: string;
}

export const ASSIST_SUBSTANCES: { id: SubstanceId; label: string; short: string }[] = [
  { id: "tabaco", label: "Derivados do tabaco (cigarro, charuto, cachimbo, fumo de corda)", short: "tabaco" },
  { id: "alcool", label: "Bebidas alcoólicas (cerveja, vinho, destilados)", short: "álcool" },
  { id: "maconha", label: "Maconha (haxixe, skunk)", short: "maconha" },
  { id: "cocaina", label: "Cocaína, crack (merla, oxi)", short: "cocaína/crack" },
  { id: "anfetaminas", label: "Anfetaminas ou êxtase (bolinhas, rebites, MDMA)", short: "anfetaminas/êxtase" },
  { id: "inalantes", label: "Inalantes (solventes, cola, lança-perfume)", short: "inalantes" },
  { id: "sedativos", label: "Hipnóticos ou sedativos sem prescrição (calmantes, comprimidos para dormir)", short: "sedativos" },
  { id: "alucinogenos", label: "Alucinógenos (LSD, cogumelos, chá de ayahuasca)", short: "alucinógenos" },
  { id: "opioides", label: "Opioides (morfina, codeína, heroína, metadona sem prescrição)", short: "opioides" },
  { id: "outras", label: "Outras substâncias", short: "outras" },
];

export const ASSIST_Q1_TEXT =
  "Na sua vida, qual(is) destas substâncias você já usou? (somente uso não prescrito pelo médico)";

// Perguntas 2–7 — o "{s}" é substituído pelo nome da substância na administração
// (mecânica oficial do instrumento, não paráfrase).
export const ASSIST_QUESTIONS: {
  q: 2 | 3 | 4 | 5 | 6 | 7;
  text: string;
  options: AssistOption[];
  /** janela "na vida" (Q6/Q7) vs "últimos 3 meses" (Q2–Q5) */
  lifetime?: boolean;
}[] = [
  {
    q: 2,
    text: "Durante os três últimos meses, com que frequência você utilizou {s}?",
    options: [
      { value: 0, label: "Nunca" },
      { value: 2, label: "1 ou 2 vezes" },
      { value: 3, label: "Mensalmente" },
      { value: 4, label: "Semanalmente" },
      { value: 6, label: "Diariamente ou quase todos os dias" },
    ],
  },
  {
    q: 3,
    text: "Durante os três últimos meses, com que frequência você teve um forte desejo ou urgência em consumir {s}?",
    options: [
      { value: 0, label: "Nunca" },
      { value: 3, label: "1 ou 2 vezes" },
      { value: 4, label: "Mensalmente" },
      { value: 5, label: "Semanalmente" },
      { value: 6, label: "Diariamente ou quase todos os dias" },
    ],
  },
  {
    q: 4,
    text: "Durante os três últimos meses, com que frequência o seu consumo de {s} resultou em problemas de saúde, sociais, legais ou financeiros?",
    options: [
      { value: 0, label: "Nunca" },
      { value: 4, label: "1 ou 2 vezes" },
      { value: 5, label: "Mensalmente" },
      { value: 6, label: "Semanalmente" },
      { value: 7, label: "Diariamente ou quase todos os dias" },
    ],
  },
  {
    q: 5,
    text: "Durante os três últimos meses, com que frequência, por causa do seu uso de {s}, você deixou de fazer coisas que eram normalmente esperadas de você?",
    options: [
      { value: 0, label: "Nunca" },
      { value: 5, label: "1 ou 2 vezes" },
      { value: 6, label: "Mensalmente" },
      { value: 7, label: "Semanalmente" },
      { value: 8, label: "Diariamente ou quase todos os dias" },
    ],
  },
  {
    q: 6,
    lifetime: true,
    text: "Há amigos, parentes ou outra pessoa que tenha demonstrado preocupação com o seu uso de {s}?",
    options: [
      { value: 0, label: "Não, nunca" },
      { value: 6, label: "Sim, nos últimos 3 meses" },
      { value: 3, label: "Sim, mas não nos últimos 3 meses" },
    ],
  },
  {
    q: 7,
    lifetime: true,
    text: "Alguma vez você já tentou controlar, diminuir ou parar o uso de {s} e não conseguiu?",
    options: [
      { value: 0, label: "Não, nunca" },
      { value: 6, label: "Sim, nos últimos 3 meses" },
      { value: 3, label: "Sim, mas não nos últimos 3 meses" },
    ],
  },
];

export const ASSIST_Q8 = {
  text: "Alguma vez você já usou drogas por injeção? (somente uso não prescrito pelo médico)",
  options: [
    { value: 0, label: "Não, nunca" },
    { value: 2, label: "Sim, nos últimos 3 meses" },
    { value: 1, label: "Sim, mas não nos últimos 3 meses" },
  ] as AssistOption[],
};

// ─── Scoring ────────────────────────────────────────────────────────────────

export type AssistBand = "low_risk" | "moderate_risk" | "high_risk";

export interface SubstanceAnswers {
  q2: number;
  q3?: number;
  q4?: number;
  q5?: number;
  q6: number;
  q7: number;
}

export interface AssistInput {
  substances: Partial<Record<SubstanceId, SubstanceAnswers>>;
  q8: number;
}

export interface SubstanceResult {
  id: SubstanceId;
  short: string;
  score: number;
  band: AssistBand;
  bandLabel: string;
}

export interface AssistResult {
  scaleId: "assist";
  substances: SubstanceResult[];
  /** maior SSI entre as substâncias (0 se nenhuma usada) */
  maxScore: number;
  /** pior faixa entre as substâncias (low_risk se nenhuma usada) */
  band: AssistBand;
  bandLabel: string;
  /** uso injetável (Q8 > 0) — atenção adicional, não soma no escore */
  injectionFlag: boolean;
  crisisFlag: false;
}

const BAND_LABEL: Record<AssistBand, string> = {
  low_risk: "risco baixo",
  moderate_risk: "risco moderado",
  high_risk: "risco alto",
};

export function assistBandFor(id: SubstanceId, score: number): AssistBand {
  // Corte oficial: álcool 0–10/11–26/27+; demais substâncias 0–3/4–26/27+.
  const moderateMin = id === "alcool" ? 11 : 4;
  if (score >= 27) return "high_risk";
  if (score >= moderateMin) return "moderate_risk";
  return "low_risk";
}

function validOption(opts: AssistOption[], v: number | undefined): boolean {
  return v === undefined || opts.some((o) => o.value === v);
}

export function scoreAssist(input: AssistInput): AssistResult {
  if (!validOption(ASSIST_Q8.options, input.q8)) {
    throw new Error(`scoreAssist: valor inválido ${input.q8} na Q8`);
  }

  const substances: SubstanceResult[] = [];
  for (const meta of ASSIST_SUBSTANCES) {
    const a = input.substances[meta.id];
    if (!a) continue;

    for (const q of ASSIST_QUESTIONS) {
      const v = a[`q${q.q}` as keyof SubstanceAnswers];
      if (!validOption(q.options, v)) {
        throw new Error(`scoreAssist: valor inválido ${v} na Q${q.q} de ${meta.id}`);
      }
    }
    if (meta.id === "tabaco" && a.q5 !== undefined) {
      throw new Error("scoreAssist: Q5 não se aplica a tabaco (regra oficial)");
    }
    // Regra de pulo oficial: Q2 = nunca → Q3–Q5 não são feitas (entram como 0).
    if (a.q2 === 0 && (a.q3 !== undefined || a.q4 !== undefined || a.q5 !== undefined)) {
      throw new Error(`scoreAssist: Q3–Q5 devem ser puladas quando Q2=nunca (${meta.id})`);
    }

    const score = a.q2 + (a.q3 ?? 0) + (a.q4 ?? 0) + (a.q5 ?? 0) + a.q6 + a.q7;
    const band = assistBandFor(meta.id, score);
    substances.push({ id: meta.id, short: meta.short, score, band, bandLabel: BAND_LABEL[band] });
  }

  const worst =
    substances.length === 0
      ? "low_risk"
      : substances.reduce<AssistBand>((acc, s) => {
          const rank: Record<AssistBand, number> = { low_risk: 0, moderate_risk: 1, high_risk: 2 };
          return rank[s.band] > rank[acc] ? s.band : acc;
        }, "low_risk");

  return {
    scaleId: "assist",
    substances,
    maxScore: substances.reduce((m, s) => Math.max(m, s.score), 0),
    band: worst,
    bandLabel: BAND_LABEL[worst],
    injectionFlag: input.q8 > 0,
    crisisFlag: false,
  };
}

// ─── Serialização compacta p/ query string (resultado/PDF, sem PII) ─────────
// Formato: "maconha:14,cocaina:5" — faixas são recomputadas deterministicamente.

export function encodeAssistResult(r: AssistResult): string {
  return r.substances.map((s) => `${s.id}:${s.score}`).join(",");
}

export function decodeAssistResult(sub: string): SubstanceResult[] {
  if (!sub) return [];
  const valid = new Set(ASSIST_SUBSTANCES.map((s) => s.id));
  const out: SubstanceResult[] = [];
  for (const part of sub.split(",")) {
    const [id, raw] = part.split(":");
    const score = Number(raw);
    if (!valid.has(id as SubstanceId) || !Number.isInteger(score) || score < 0 || score > 39) continue;
    const meta = ASSIST_SUBSTANCES.find((s) => s.id === id)!;
    const band = assistBandFor(id as SubstanceId, score);
    out.push({ id: id as SubstanceId, short: meta.short, score, band, bandLabel: BAND_LABEL[band] });
  }
  return out;
}

// ─── Plano de perguntas (fluxo dinâmico do quiz — puro e testável) ──────────

export interface AssistStep {
  substance: SubstanceId;
  short: string;
  q: 2 | 3 | 4 | 5 | 6 | 7;
  text: string;
  options: AssistOption[];
}

/**
 * Monta a sequência de perguntas dado o que já foi respondido. Regras:
 *  - por substância selecionada na Q1, na ordem oficial: Q2 → (Q3, Q4, Q5 se
 *    Q2 > 0; tabaco nunca tem Q5) → Q6 → Q7;
 *  - o plano é recalculado a cada resposta (Q2=nunca encolhe o bloco).
 */
export function buildAssistPlan(
  selected: SubstanceId[],
  answers: Partial<Record<SubstanceId, Partial<SubstanceAnswers>>>
): AssistStep[] {
  const steps: AssistStep[] = [];
  for (const meta of ASSIST_SUBSTANCES) {
    if (!selected.includes(meta.id)) continue;
    const a = answers[meta.id] ?? {};
    for (const q of ASSIST_QUESTIONS) {
      if (q.q === 5 && meta.id === "tabaco") continue;
      if (q.q >= 3 && q.q <= 5 && a.q2 === 0) continue;
      steps.push({
        substance: meta.id,
        short: meta.short,
        q: q.q,
        text: q.text.replace("{s}", meta.short),
        options: q.options,
      });
    }
  }
  return steps;
}

// Gate de produção — texto conferido pelo responsável (Patrick, 2026-06-13).
export const ASSIST_VALIDATED = true;
export const ASSIST_SOURCE =
  "ASSIST v3.0 (OMS) — versão brasileira validada (Henrique IFS et al., Rev Assoc Med Bras, 2004; material SUPERA/SENAD-MS)";
