import { z } from "zod";
import type { ScaleId } from "@/lib/scales/types";

export const DevolutivaSchema = z.object({
  acolhimento: z.string().min(10).max(400),
  leitura: z.array(z.string().min(5)).min(1).max(5),
  limites: z.string().min(10).max(300),
  proximos_passos: z.array(z.string().min(5)).min(1).max(5),
});

export type Devolutiva = z.infer<typeof DevolutivaSchema>;

export interface DevolutivaInput {
  scaleId: ScaleId;
  totalScore: number;
  band: string;
  bandLabel: string;
  partAPositives?: number;
}

// Frases seguras OBRIGATÓRIAS no produto (o prompt MANDA escrever "não é diagnóstico")
// são removidas ANTES da checagem — sem isso, /diagnóstic/ derrubaria toda devolutiva
// obediente para o fallback e mataria o caminho LLM silenciosamente (review 2026-06-12).
const SAFE_PHRASES = [
  /n[ãa]o ((é|e|seja|substitui) )?(um |uma )?diagn[óo]stico/gi,
  /triagem,? n[ãa]o (um )?diagn[óo]stico/gi,
];

// Conteúdo proibido na saída do LLM — fallback imediato se aparecer.
// Direcionais: pegam afirmação diagnóstica/medicação; não pegam a negação segura (acima).
const PROHIBITED = [
  /você tem\s+\w/i,
  /você sofre de/i,
  /(você|voce) (pode ter|provavelmente tem|apresenta|tem sinais de)/i,
  /(é|seja|sendo) bipolar\b/i,
  /diagn[óo]stic/i, // qualquer forma restante após remover as frases seguras (incl. "diagnosticado", sem acento)
  /\bconfirmad[oa]s?\b/i,
  /l[íi]tio|estabilizador(es)? de humor|antidepressiv|antipsic[óo]tic|ansiol[íi]tic|benzodiazep/i,
  /medicament|medicaç|rem[ée]dio|comprimido|dosagem|\bdose\b/i,
];

export function containsProhibitedContent(text: string): boolean {
  let t = text;
  for (const re of SAFE_PHRASES) t = t.replace(re, "");
  return PROHIBITED.some((re) => re.test(t));
}

export function devolutivaHasProhibitedContent(d: Devolutiva): boolean {
  const all = [d.acolhimento, d.limites, ...d.leitura, ...d.proximos_passos].join(" ");
  return containsProhibitedContent(all);
}
