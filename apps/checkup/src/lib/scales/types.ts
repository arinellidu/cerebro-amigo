// src/lib/scales/types.ts
// Tipos do motor de instrumentos. Mantenha este arquivo livre de dependências.

export type ScaleId =
  | "phq9"
  | "gad7"
  | "asrs18"
  | "audit"
  | "mdq"
  | "fagerstrom"
  | "msi_bpd"
  | "assist";

export interface ResponseOption {
  value: number;
  label: string;
}

export interface ScaleItem {
  /** 1-based, na ordem oficial do instrumento */
  index: number;
  text: string;
  /** Item cuja resposta > 0 dispara o fluxo de crise (PHQ-9 item 9; MSI-BPD item 2) */
  isCrisisItem?: boolean;
  /**
   * ASRS Parte A: valores que contam como "célula sombreada" para este item.
   * Ausente nos demais instrumentos.
   */
  shadedValues?: number[];
  /**
   * Opções específicas deste item, quando o instrumento não tem opções
   * uniformes (AUDIT, Fagerström, MDQ itens 14/15). Ausente = usa as da escala.
   * O `value` de cada opção é a PONTUAÇÃO oficial do item (o scoring soma values).
   */
  options?: ResponseOption[];
}

export interface ScoreBand {
  min: number;
  max: number;
  /** chave neutra usada pela camada de devolutiva; não exibir crua na UI.
   *  "informative" = sem verdict (ASRS-18 e MSI-BPD: sem cutoff validado p/ BR).
   *  low_risk..probable_dependence = zonas do AUDIT (OMS).
   *  very_low..very_high = graus de dependência do Fagerström. */
  band:
    | "minimal" | "mild" | "moderate" | "moderately_severe" | "severe"
    | "positive" | "negative" | "informative"
    | "low_risk" | "risky_use" | "harmful_use" | "probable_dependence"
    | "very_low" | "low" | "medium" | "high" | "very_high";
  bandLabel: string;
}

export interface Scale {
  id: ScaleId;
  name: string;
  /** ex.: "últimas 2 semanas" — exibido no topo do teste e no PDF */
  timeframe: string;
  instructions: string;
  options: ResponseOption[];
  items: ScaleItem[];
  bands: ScoreBand[];
  /** false bloqueia build/uso em produção até conferência do texto validado */
  validated: boolean;
  /** referência da versão brasileira validada usada */
  source: string;
}

export interface ScaleResult {
  scaleId: ScaleId;
  /** respostas na ordem dos itens; mesmo comprimento de items */
  answers: number[];
  totalScore: number;
  band: ScoreBand["band"];
  bandLabel: string;
  /** true ⇒ UI desvia para o fluxo de crise antes de qualquer resultado */
  crisisFlag: boolean;
  /** ASRS: nº de itens positivos na Parte A */
  partAPositives?: number;
}

export type ScoreFn = (scale: Scale, answers: number[]) => ScaleResult;
