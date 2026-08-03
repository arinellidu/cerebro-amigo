import { z } from "zod";

/**
 * Faixas válidas dos instrumentos (ADR-050 Parte 2). `band` gravado em tracking_points
 * é restrito a este conjunto — minimização: impede texto livre/PII/narrativa no campo.
 * "crisis" fica de fora de propósito: crise nunca vira ponto de acompanhamento.
 */
export const ALLOWED_BANDS = [
  "minimal", "mild", "moderate", "moderately_severe", "severe", "informative",
  "low_risk", "risky_use", "harmful_use", "probable_dependence",
  "very_low", "low", "medium", "high", "very_high",
  "negative", "positive", "moderate_risk", "high_risk",
] as const;

export const bandSchema = z.enum(ALLOWED_BANDS);
