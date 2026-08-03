import { describe, it, expect } from "vitest";
import { fagerstrom, scoreFagerstrom } from "./fagerstrom";

// 6 respostas na ordem dos itens: [tempo, lugares, qual cigarro, qtd/dia, manhã, doente]
const ALL_ZERO = [0, 0, 0, 0, 0, 0];
const ALL_MAX = [3, 1, 1, 3, 1, 1]; // 10

describe("scoreFagerstrom", () => {
  describe("casos canônicos de escore (graus de dependência)", () => {
    it("tudo-zero → score 0, dependência muito baixa", () => {
      const r = scoreFagerstrom(ALL_ZERO);
      expect(r.totalScore).toBe(0);
      expect(r.band).toBe("very_low");
      expect(r.crisisFlag).toBe(false);
    });

    it("tudo-máximo → score 10, dependência muito elevada", () => {
      const r = scoreFagerstrom(ALL_MAX);
      expect(r.totalScore).toBe(10);
      expect(r.band).toBe("very_high");
    });

    it("score 3 → dependência baixa", () => {
      const r = scoreFagerstrom([2, 0, 1, 0, 0, 0]); // 3
      expect(r.band).toBe("low");
    });

    it("score 5 → dependência média (faixa de um único valor)", () => {
      const r = scoreFagerstrom([3, 1, 0, 1, 0, 0]); // 5
      expect(r.band).toBe("medium");
    });

    it("score 6 → dependência elevada", () => {
      const r = scoreFagerstrom([3, 1, 1, 1, 0, 0]); // 6
      expect(r.band).toBe("high");
    });

    it("score 8 → dependência muito elevada", () => {
      const r = scoreFagerstrom([3, 1, 1, 3, 0, 0]); // 8
      expect(r.band).toBe("very_high");
    });
  });

  describe("validação de entrada", () => {
    it("rejeita comprimento errado", () => {
      expect(() => scoreFagerstrom([0, 0])).toThrow();
    });

    it("rejeita peso inválido no item 1 (só 0–3)", () => {
      expect(() => scoreFagerstrom([4, 0, 0, 0, 0, 0])).toThrow();
    });

    it("rejeita valor 2 em item sim/não", () => {
      expect(() => scoreFagerstrom([0, 2, 0, 0, 0, 0])).toThrow();
    });
  });

  describe("estrutura do instrumento", () => {
    it("tem 6 itens, com pesos próprios nos itens 1, 3 e 4", () => {
      expect(fagerstrom.items).toHaveLength(6);
      expect(fagerstrom.items[0].options?.map((o) => o.value)).toEqual([3, 2, 1, 0]);
      expect(fagerstrom.items[3].options?.map((o) => o.value)).toEqual([0, 1, 2, 3]);
    });

    it("liberado para produção após conferência do responsável (validated=true)", () => {
      expect(fagerstrom.validated).toBe(true);
    });
  });
});
