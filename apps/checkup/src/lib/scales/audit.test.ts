import { describe, it, expect } from "vitest";
import { audit, scoreAudit } from "./audit";

const ALL_ZERO = new Array(10).fill(0);
// itens 1–8 no máximo (4) + itens 9–10 no máximo (4) = 40
const ALL_MAX = [4, 4, 4, 4, 4, 4, 4, 4, 4, 4];

describe("scoreAudit", () => {
  describe("casos canônicos de escore (zonas OMS)", () => {
    it("tudo-zero → score 0, zona I (baixo risco)", () => {
      const r = scoreAudit(ALL_ZERO);
      expect(r.totalScore).toBe(0);
      expect(r.band).toBe("low_risk");
      expect(r.crisisFlag).toBe(false);
    });

    it("tudo-máximo → score 40, zona IV (possível dependência)", () => {
      const r = scoreAudit(ALL_MAX);
      expect(r.totalScore).toBe(40);
      expect(r.band).toBe("probable_dependence");
    });

    it("cutoff da triagem (8) entra na zona II (uso de risco)", () => {
      const r = scoreAudit([2, 2, 2, 2, 0, 0, 0, 0, 0, 0]); // 8
      expect(r.totalScore).toBe(8);
      expect(r.band).toBe("risky_use");
    });

    it("limite superior da zona I: score 7", () => {
      const r = scoreAudit([2, 2, 2, 1, 0, 0, 0, 0, 0, 0]); // 7
      expect(r.band).toBe("low_risk");
    });

    it("zona III (uso nocivo): score 16, incluindo item 9 com peso 0/2/4", () => {
      const r = scoreAudit([3, 3, 2, 2, 2, 0, 0, 0, 4, 0]); // 16
      expect(r.totalScore).toBe(16);
      expect(r.band).toBe("harmful_use");
    });

    it("zona IV começa em 20", () => {
      const r = scoreAudit([4, 4, 4, 4, 2, 2, 0, 0, 0, 0]); // 20
      expect(r.band).toBe("probable_dependence");
    });
  });

  describe("validação de entrada", () => {
    it("rejeita comprimento errado", () => {
      expect(() => scoreAudit([0, 0])).toThrow();
    });

    it("rejeita valor fora das opções do item (item 9 só aceita 0/2/4)", () => {
      const a = [...ALL_ZERO];
      a[8] = 1; // inválido para item 9
      expect(() => scoreAudit(a)).toThrow();
    });

    it("rejeita valor fora do range em item 1–8", () => {
      const a = [...ALL_ZERO];
      a[0] = 5;
      expect(() => scoreAudit(a)).toThrow();
    });
  });

  describe("estrutura do instrumento", () => {
    it("tem 10 itens, com opções próprias nos itens 1, 2, 9 e 10", () => {
      expect(audit.items).toHaveLength(10);
      expect(audit.items[0].options).toHaveLength(5);
      expect(audit.items[1].options).toHaveLength(5);
      expect(audit.items[8].options?.map((o) => o.value)).toEqual([0, 2, 4]);
      expect(audit.items[9].options?.map((o) => o.value)).toEqual([0, 2, 4]);
    });

    it("liberado para produção após conferência do responsável (validated=true)", () => {
      expect(audit.validated).toBe(true);
    });
  });
});
