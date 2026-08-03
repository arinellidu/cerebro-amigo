import { describe, it, expect } from "vitest";
import { containsProhibitedContent, devolutivaHasProhibitedContent } from "./types";
import { getFallback } from "./fallbacks";
import type { DevolutivaInput } from "./types";

// Guardrail mecânico da devolutiva (review clinical-safety 2026-06-12):
// frases seguras obrigatórias passam; afirmação diagnóstica/medicação cai no fallback.
describe("containsProhibitedContent", () => {
  describe("frases seguras obrigatórias (o prompt MANDA escrevê-las) — devem PASSAR", () => {
    it.each([
      "Isto é uma triagem, não é um diagnóstico.",
      "O resultado não é diagnóstico e não substitui avaliação.",
      "Ele é um ponto de partida para uma conversa, não um diagnóstico.",
      "Esta triagem não substitui um diagnóstico feito por profissional.",
    ])("%s", (s) => {
      expect(containsProhibitedContent(s)).toBe(false);
    });
  });

  describe("afirmação diagnóstica — deve BLOQUEAR", () => {
    it.each([
      "Seus resultados indicam um diagnóstico de depressão.",
      "Você foi diagnosticado com transtorno bipolar.",
      "O diagnostico está claro.", // sem acento
      "Você tem depressão.",
      "Você sofre de ansiedade.",
      "Você pode ter bipolaridade.",
      "Você provavelmente tem TDAH.",
      "Você apresenta transtorno bipolar.",
      "Isso confirma que você é bipolar.",
      "Transtorno bipolar confirmado.",
      "Doença confirmada pelos escores.",
    ])("%s", (s) => {
      expect(containsProhibitedContent(s)).toBe(true);
    });
  });

  describe("medicação/tratamento específico — deve BLOQUEAR", () => {
    it.each([
      "O lítio costuma ser usado nesses casos.",
      "Um estabilizador de humor pode ajudar.",
      "Considere um antidepressivo.",
      "Antipsicóticos são indicados.",
      "Converse sobre a dosagem com seu médico.",
      "Talvez um remédio ajude.",
      "Pergunte sobre medicamentos.",
      "Ajustar a medicação é o caminho.",
    ])("%s", (s) => {
      expect(containsProhibitedContent(s)).toBe(true);
    });
  });
});

describe("fallbacks estáticos × guardrail (nunca podem cair no GENERIC por regex)", () => {
  const inputs: DevolutivaInput[] = [
    ...["minimal", "mild", "moderate", "moderately_severe", "severe"].map((band) => ({
      scaleId: "phq9" as const, totalScore: 10, band, bandLabel: band,
    })),
    ...["minimal", "mild", "moderate", "severe"].map((band) => ({
      scaleId: "gad7" as const, totalScore: 10, band, bandLabel: band,
    })),
    { scaleId: "asrs18" as const, totalScore: 30, band: "informative", bandLabel: "informativo" },
    ...["low_risk", "risky_use", "harmful_use", "probable_dependence"].map((band) => ({
      scaleId: "audit" as const, totalScore: 12, band, bandLabel: band,
    })),
    ...["very_low", "low", "medium", "high", "very_high"].map((band) => ({
      scaleId: "fagerstrom" as const, totalScore: 5, band, bandLabel: band,
    })),
    ...["negative", "positive"].map((band) => ({
      scaleId: "mdq" as const, totalScore: 8, band, bandLabel: band,
    })),
    { scaleId: "msi_bpd" as const, totalScore: 6, band: "informative", bandLabel: "informativo" },
    ...["low_risk", "moderate_risk", "high_risk"].map((band) => ({
      scaleId: "assist" as const, totalScore: 12, band, bandLabel: band,
    })),
  ];

  it.each(inputs.map((i) => [`${i.scaleId}/${i.band}`, i] as const))(
    "fallback %s passa no guardrail",
    (_label, input) => {
      expect(devolutivaHasProhibitedContent(getFallback(input))).toBe(false);
    }
  );
});
