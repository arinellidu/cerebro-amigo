import { describe, it, expect } from "vitest";
import { mdq, scoreMdq } from "./mdq";

// 15 respostas: 13 sintomas (0/1) + simultaneidade (0/1) + prejuízo (0–3)
const seteSim = [1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0];

describe("scoreMdq", () => {
  describe("critério oficial de triagem (3 condições)", () => {
    it("≥7 sim + simultâneo + prejuízo moderado → positiva", () => {
      const r = scoreMdq([...seteSim, 1, 2]);
      expect(r.totalScore).toBe(7);
      expect(r.band).toBe("positive");
    });

    it("≥7 sim + simultâneo + prejuízo sério → positiva", () => {
      const r = scoreMdq([...seteSim, 1, 3]);
      expect(r.band).toBe("positive");
    });

    it("6 sim (abaixo do corte) → negativa, mesmo com simultaneidade e prejuízo", () => {
      const seis = [1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
      const r = scoreMdq([...seis, 1, 3]);
      expect(r.totalScore).toBe(6);
      expect(r.band).toBe("negative");
    });

    it("≥7 sim SEM simultaneidade → negativa", () => {
      const r = scoreMdq([...seteSim, 0, 3]);
      expect(r.band).toBe("negative");
    });

    it("≥7 sim + simultâneo + prejuízo apenas menor → negativa", () => {
      const r = scoreMdq([...seteSim, 1, 1]);
      expect(r.band).toBe("negative");
    });

    it("tudo-zero → score 0, negativa", () => {
      const r = scoreMdq(new Array(15).fill(0));
      expect(r.totalScore).toBe(0);
      expect(r.band).toBe("negative");
      expect(r.crisisFlag).toBe(false);
    });

    it("tudo-máximo → score 13 (itens 14/15 não somam), positiva", () => {
      const r = scoreMdq([...new Array(13).fill(1), 1, 3]);
      expect(r.totalScore).toBe(13);
      expect(r.band).toBe("positive");
    });
  });

  describe("validação de entrada", () => {
    it("rejeita comprimento errado", () => {
      expect(() => scoreMdq(new Array(13).fill(0))).toThrow();
    });

    it("rejeita valor inválido no item de prejuízo (só 0–3)", () => {
      expect(() => scoreMdq([...seteSim, 1, 4])).toThrow();
    });

    it("rejeita valor 2 em item sim/não", () => {
      const a = new Array(15).fill(0);
      a[0] = 2;
      expect(() => scoreMdq(a)).toThrow();
    });
  });

  describe("estrutura do instrumento", () => {
    it("tem 15 itens: 13 sintomas + simultaneidade + prejuízo (4 opções)", () => {
      expect(mdq.items).toHaveLength(15);
      expect(mdq.items[14].options).toHaveLength(4);
    });

    it("liberado para produção após conferência do responsável (validated=true)", () => {
      expect(mdq.validated).toBe(true);
    });
  });
});
