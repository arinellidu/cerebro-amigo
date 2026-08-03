import { describe, it, expect } from "vitest";
import { scoreGad7 } from "./gad7";

const ALL_ZERO: number[] = [0, 0, 0, 0, 0, 0, 0];
const ALL_MAX: number[]  = [3, 3, 3, 3, 3, 3, 3]; // 21

describe("scoreGad7", () => {
  describe("casos canônicos de escore", () => {
    it("tudo-zero → score 0, faixa minimal", () => {
      const r = scoreGad7(ALL_ZERO);
      expect(r.totalScore).toBe(0);
      expect(r.band).toBe("minimal");
      expect(r.crisisFlag).toBe(false);
    });

    it("tudo-máximo → score 21, faixa severe", () => {
      const r = scoreGad7(ALL_MAX);
      expect(r.totalScore).toBe(21);
      expect(r.band).toBe("severe");
      expect(r.crisisFlag).toBe(false);
    });

    it("faixa leve (5–9): score 7", () => {
      const r = scoreGad7([1, 1, 1, 1, 1, 1, 1]); // 7
      expect(r.totalScore).toBe(7);
      expect(r.band).toBe("mild");
    });

    it("faixa moderado (10–14): score 12", () => {
      const r = scoreGad7([2, 2, 2, 2, 2, 1, 1]); // 12
      expect(r.totalScore).toBe(12);
      expect(r.band).toBe("moderate");
    });

    it("faixa grave (15–21): score 17", () => {
      const r = scoreGad7([3, 3, 3, 3, 3, 1, 1]); // 17
      expect(r.totalScore).toBe(17);
      expect(r.band).toBe("severe");
    });
  });

  describe("crisisFlag — GAD-7 nunca dispara crise", () => {
    it("tudo-máximo → crisisFlag false", () => {
      expect(scoreGad7(ALL_MAX).crisisFlag).toBe(false);
    });

    it("tudo-zero → crisisFlag false", () => {
      expect(scoreGad7(ALL_ZERO).crisisFlag).toBe(false);
    });
  });

  describe("validação de entrada", () => {
    it("comprimento 6 (faltando item) → throws", () => {
      expect(() => scoreGad7([0, 0, 0, 0, 0, 0])).toThrow();
    });

    it("comprimento 8 (item a mais) → throws", () => {
      expect(() => scoreGad7([0, 0, 0, 0, 0, 0, 0, 0])).toThrow();
    });

    it("valor 4 (fora de 0–3) → throws", () => {
      expect(() => scoreGad7([0, 0, 0, 0, 0, 0, 4])).toThrow();
    });

    it("valor negativo → throws", () => {
      expect(() => scoreGad7([-1, 0, 0, 0, 0, 0, 0])).toThrow();
    });
  });

  describe("metadados do resultado", () => {
    it("scaleId = 'gad7'", () => {
      expect(scoreGad7(ALL_ZERO).scaleId).toBe("gad7");
    });

    it("answers devolvidos idênticos ao input", () => {
      expect(scoreGad7(ALL_ZERO).answers).toEqual(ALL_ZERO);
    });
  });
});
