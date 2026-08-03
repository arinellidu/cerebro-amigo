import { describe, it, expect } from "vitest";
import { scorePhq9 } from "./phq9";

const ALL_ZERO: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
const ALL_MAX: number[]  = [3, 3, 3, 3, 3, 3, 3, 3, 3]; // 27

describe("scorePhq9", () => {
  describe("casos canônicos de escore", () => {
    it("tudo-zero → score 0, faixa minimal, sem crise", () => {
      const r = scorePhq9(ALL_ZERO);
      expect(r.totalScore).toBe(0);
      expect(r.band).toBe("minimal");
      expect(r.crisisFlag).toBe(false);
    });

    it("tudo-máximo → score 27, faixa severe, crisisFlag true (item9=3)", () => {
      const r = scorePhq9(ALL_MAX);
      expect(r.totalScore).toBe(27);
      expect(r.band).toBe("severe");
      expect(r.crisisFlag).toBe(true);
    });

    it("faixa leve (5–9): score 7", () => {
      const r = scorePhq9([1, 1, 1, 1, 1, 1, 1, 0, 0]); // 7
      expect(r.totalScore).toBe(7);
      expect(r.band).toBe("mild");
      expect(r.crisisFlag).toBe(false);
    });

    it("faixa moderado (10–14): score 12", () => {
      const r = scorePhq9([2, 2, 2, 2, 2, 1, 1, 0, 0]); // 12
      expect(r.totalScore).toBe(12);
      expect(r.band).toBe("moderate");
      expect(r.crisisFlag).toBe(false);
    });

    it("faixa moderadamente grave (15–19): score 16", () => {
      const r = scorePhq9([2, 2, 2, 2, 2, 2, 2, 2, 0]); // 16
      expect(r.totalScore).toBe(16);
      expect(r.band).toBe("moderately_severe");
      expect(r.crisisFlag).toBe(false);
    });

    it("faixa grave (20–27): score 21, crisisFlag true", () => {
      const r = scorePhq9([3, 3, 3, 3, 3, 2, 2, 1, 1]); // 21
      expect(r.totalScore).toBe(21);
      expect(r.band).toBe("severe");
      expect(r.crisisFlag).toBe(true);
    });
  });

  // Regra clínica crítica: item 9 > 0 ⇒ crisisFlag independente do escore total.
  describe("crisisFlag — item 9 (prioridade máxima)", () => {
    it("item9=1, demais=0 (score 1, minimal) → crisisFlag true", () => {
      const r = scorePhq9([0, 0, 0, 0, 0, 0, 0, 0, 1]);
      expect(r.totalScore).toBe(1);
      expect(r.band).toBe("minimal");
      expect(r.crisisFlag).toBe(true);
    });

    it("item9=2, demais=0 (score 2) → crisisFlag true", () => {
      expect(scorePhq9([0, 0, 0, 0, 0, 0, 0, 0, 2]).crisisFlag).toBe(true);
    });

    it("item9=3, demais=0 (score 3) → crisisFlag true", () => {
      expect(scorePhq9([0, 0, 0, 0, 0, 0, 0, 0, 3]).crisisFlag).toBe(true);
    });

    it("item9=0, todos demais=3 (score 24, severe) → crisisFlag false", () => {
      const r = scorePhq9([3, 3, 3, 3, 3, 3, 3, 3, 0]);
      expect(r.totalScore).toBe(24);
      expect(r.band).toBe("severe");
      expect(r.crisisFlag).toBe(false);
    });
  });

  describe("validação de entrada", () => {
    it("comprimento 8 (faltando item) → throws", () => {
      expect(() => scorePhq9([0, 0, 0, 0, 0, 0, 0, 0])).toThrow();
    });

    it("comprimento 10 (item a mais) → throws", () => {
      expect(() => scorePhq9([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])).toThrow();
    });

    it("valor 4 (fora de 0–3) → throws", () => {
      expect(() => scorePhq9([0, 0, 0, 0, 0, 0, 0, 0, 4])).toThrow();
    });

    it("valor negativo → throws", () => {
      expect(() => scorePhq9([0, 0, 0, 0, 0, 0, 0, 0, -1])).toThrow();
    });
  });

  describe("metadados do resultado", () => {
    it("scaleId = 'phq9'", () => {
      expect(scorePhq9(ALL_ZERO).scaleId).toBe("phq9");
    });

    it("answers devolvidos idênticos ao input", () => {
      expect(scorePhq9(ALL_ZERO).answers).toEqual(ALL_ZERO);
    });
  });
});
