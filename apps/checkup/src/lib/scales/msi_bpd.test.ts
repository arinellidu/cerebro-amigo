import { describe, it, expect } from "vitest";
import { msiBpd, scoreMsiBpd } from "./msi_bpd";

const ALL_ZERO = new Array(10).fill(0);
const ALL_MAX = new Array(10).fill(1);

describe("scoreMsiBpd", () => {
  describe("scoring qualitativo (sem cutoff validado p/ BR)", () => {
    it("tudo-zero → score 0, banda informativa, sem crise", () => {
      const r = scoreMsiBpd(ALL_ZERO);
      expect(r.totalScore).toBe(0);
      expect(r.band).toBe("informative");
      expect(r.crisisFlag).toBe(false);
    });

    it("tudo-máximo → score 10, banda CONTINUA informativa (nunca positive)", () => {
      const r = scoreMsiBpd(ALL_MAX);
      expect(r.totalScore).toBe(10);
      expect(r.band).toBe("informative");
    });

    it("7 sim (cutoff americano) NÃO vira triagem positiva", () => {
      const r = scoreMsiBpd([1, 0, 1, 1, 1, 1, 1, 1, 0, 0]);
      expect(r.totalScore).toBe(7);
      expect(r.band).toBe("informative");
    });
  });

  describe("crise (item 2 — autolesão/tentativas)", () => {
    it("sim no item 2 → crisisFlag, independentemente do resto", () => {
      const a = [...ALL_ZERO];
      a[1] = 1;
      const r = scoreMsiBpd(a);
      expect(r.crisisFlag).toBe(true);
    });

    it("o item 2 está marcado como isCrisisItem (UI desvia antes do escore)", () => {
      expect(msiBpd.items[1].isCrisisItem).toBe(true);
    });
  });

  describe("validação de entrada", () => {
    it("rejeita comprimento errado", () => {
      expect(() => scoreMsiBpd([0, 1])).toThrow();
    });

    it("rejeita valor não-binário", () => {
      const a = [...ALL_ZERO];
      a[0] = 2;
      expect(() => scoreMsiBpd(a)).toThrow();
    });
  });

  describe("estrutura do instrumento", () => {
    it("tem 10 itens sim/não", () => {
      expect(msiBpd.items).toHaveLength(10);
      expect(msiBpd.options.map((o) => o.value).sort()).toEqual([0, 1]);
    });

    it("liberado para produção após conferência do responsável (validated=true)", () => {
      expect(msiBpd.validated).toBe(true);
    });
  });
});
