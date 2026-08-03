import { describe, it, expect } from "vitest";
import {
  scoreAssist,
  buildAssistPlan,
  assistBandFor,
  encodeAssistResult,
  decodeAssistResult,
  ASSIST_SUBSTANCES,
  ASSIST_VALIDATED,
} from "./assist";

describe("scoreAssist", () => {
  it("nenhuma substância usada → risco baixo geral, sem flag de injeção", () => {
    const r = scoreAssist({ substances: {}, q8: 0 });
    expect(r.substances).toHaveLength(0);
    expect(r.band).toBe("low_risk");
    expect(r.maxScore).toBe(0);
    expect(r.injectionFlag).toBe(false);
    expect(r.crisisFlag).toBe(false);
  });

  it("SSI = Q2+Q3+Q4+Q5+Q6+Q7 (maconha: 6+6+7+8+6+6 = 39, risco alto)", () => {
    const r = scoreAssist({
      substances: { maconha: { q2: 6, q3: 6, q4: 7, q5: 8, q6: 6, q7: 6 } },
      q8: 0,
    });
    expect(r.substances[0].score).toBe(39);
    expect(r.substances[0].band).toBe("high_risk");
    expect(r.band).toBe("high_risk");
  });

  it("corte de drogas: 3 = baixo, 4 = moderado, 27 = alto", () => {
    expect(assistBandFor("maconha", 3)).toBe("low_risk");
    expect(assistBandFor("maconha", 4)).toBe("moderate_risk");
    expect(assistBandFor("maconha", 26)).toBe("moderate_risk");
    expect(assistBandFor("maconha", 27)).toBe("high_risk");
  });

  it("corte do álcool é diferente: 10 = baixo, 11 = moderado", () => {
    expect(assistBandFor("alcool", 10)).toBe("low_risk");
    expect(assistBandFor("alcool", 11)).toBe("moderate_risk");
    expect(assistBandFor("alcool", 27)).toBe("high_risk");
  });

  it("Q2=nunca com Q6/Q7 positivos ainda pontua (uso passado)", () => {
    const r = scoreAssist({
      substances: { cocaina: { q2: 0, q6: 3, q7: 3 } },
      q8: 0,
    });
    expect(r.substances[0].score).toBe(6);
    expect(r.substances[0].band).toBe("moderate_risk");
  });

  it("pior faixa entre substâncias define a banda geral", () => {
    const r = scoreAssist({
      substances: {
        maconha: { q2: 2, q3: 0, q4: 0, q5: 0, q6: 0, q7: 0 }, // 2 → baixo
        cocaina: { q2: 6, q3: 6, q4: 7, q5: 8, q6: 6, q7: 6 }, // 39 → alto
      },
      q8: 0,
    });
    expect(r.band).toBe("high_risk");
    expect(r.maxScore).toBe(39);
  });

  it("Q8 > 0 liga o flag de uso injetável sem somar no escore", () => {
    const r = scoreAssist({
      substances: { maconha: { q2: 2, q3: 0, q4: 0, q5: 0, q6: 0, q7: 0 } },
      q8: 2,
    });
    expect(r.injectionFlag).toBe(true);
    expect(r.substances[0].score).toBe(2);
  });

  describe("validação de entrada (regras oficiais)", () => {
    it("rejeita Q5 em tabaco", () => {
      expect(() =>
        scoreAssist({ substances: { tabaco: { q2: 2, q3: 0, q4: 0, q5: 5, q6: 0, q7: 0 } }, q8: 0 })
      ).toThrow();
    });

    it("rejeita Q3–Q5 respondidas quando Q2=nunca", () => {
      expect(() =>
        scoreAssist({ substances: { maconha: { q2: 0, q3: 3, q6: 0, q7: 0 } }, q8: 0 })
      ).toThrow();
    });

    it("rejeita valor fora das opções oficiais (Q2 não tem valor 1)", () => {
      expect(() =>
        scoreAssist({ substances: { maconha: { q2: 1, q6: 0, q7: 0 } }, q8: 0 })
      ).toThrow();
    });

    it("rejeita Q8 inválida", () => {
      expect(() => scoreAssist({ substances: {}, q8: 5 })).toThrow();
    });
  });
});

describe("buildAssistPlan (fluxo dinâmico)", () => {
  it("substância sem respostas → 6 perguntas (Q2–Q7); tabaco → 5 (sem Q5)", () => {
    expect(buildAssistPlan(["maconha"], {})).toHaveLength(6);
    expect(buildAssistPlan(["tabaco"], {}).map((s) => s.q)).toEqual([2, 3, 4, 6, 7]);
  });

  it("Q2=nunca encolhe o bloco para Q2, Q6 e Q7", () => {
    const plan = buildAssistPlan(["maconha"], { maconha: { q2: 0 } });
    expect(plan.map((s) => s.q)).toEqual([2, 6, 7]);
  });

  it("interpola o nome da substância no texto", () => {
    const plan = buildAssistPlan(["cocaina"], {});
    expect(plan[0].text).toContain("cocaína/crack");
    expect(plan[0].text).not.toContain("{s}");
  });

  it("ordem oficial das substâncias é respeitada", () => {
    const plan = buildAssistPlan(["cocaina", "tabaco"], {});
    expect(plan[0].substance).toBe("tabaco");
  });
});

describe("encode/decode do resultado", () => {
  it("ida e volta preserva escores e recomputa faixas", () => {
    const r = scoreAssist({
      substances: {
        alcool: { q2: 4, q3: 4, q4: 0, q5: 0, q6: 3, q7: 0 }, // 11 → moderado (corte do álcool)
        maconha: { q2: 2, q3: 0, q4: 0, q5: 0, q6: 0, q7: 0 }, // 2 → baixo
      },
      q8: 0,
    });
    const decoded = decodeAssistResult(encodeAssistResult(r));
    expect(decoded).toHaveLength(2);
    expect(decoded.find((s) => s.id === "alcool")?.band).toBe("moderate_risk");
    expect(decoded.find((s) => s.id === "maconha")?.band).toBe("low_risk");
  });

  it("decode ignora lixo na query (id inválido, escore fora do range)", () => {
    expect(decodeAssistResult("heroina:99,maconha:abc,cocaina:50,maconha:5")).toHaveLength(1);
    expect(decodeAssistResult("")).toHaveLength(0);
  });
});

describe("estrutura do instrumento", () => {
  it("tem as 10 classes de substâncias da Q1", () => {
    expect(ASSIST_SUBSTANCES).toHaveLength(10);
  });

  it("liberado para produção após conferência do responsável (ASSIST_VALIDATED=true)", () => {
    expect(ASSIST_VALIDATED).toBe(true);
  });
});
