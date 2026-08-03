import { describe, it, expect } from "vitest";
import { asrs18, scoreAsrs18 } from "./asrs18";

const zeros = () => new Array(18).fill(0);

describe("asrs18 — estrutura validada (Mattos 2006)", () => {
  it("validated=true e 18 itens transcritos", () => {
    expect(asrs18.validated).toBe(true);
    expect(asrs18.items).toHaveLength(18);
  });

  it("escala de resposta 0–4 (5 opções)", () => {
    expect(asrs18.options).toHaveLength(5);
    expect(asrs18.options.map((o) => o.value)).toEqual([0, 1, 2, 3, 4]);
  });

  it("NÃO tem item de crise (ASRS não dispara protocolo)", () => {
    expect(asrs18.items.some((i) => i.isCrisisItem)).toBe(false);
  });
});

describe("scoreAsrs18 — qualitativo, SEM verdict (sem cutoff validado p/ BR)", () => {
  it("tudo-zero → totalScore 0, band informative, sem crise", () => {
    const r = scoreAsrs18(zeros());
    expect(r.totalScore).toBe(0);
    expect(r.band).toBe("informative");
    expect(r.crisisFlag).toBe(false);
  });

  it("tudo-máximo → totalScore 72, band informative (nunca 'positive')", () => {
    const r = scoreAsrs18(new Array(18).fill(4));
    expect(r.totalScore).toBe(72);
    expect(r.band).toBe("informative");
    expect(r.crisisFlag).toBe(false);
  });

  it("escore alto NÃO vira verdict: band continua informative", () => {
    // 6 itens em 'frequentemente' — limiar que seria 'positivo' no cutoff US.
    const answers = zeros();
    for (let i = 0; i < 6; i++) answers[i] = 3;
    const r = scoreAsrs18(answers);
    expect(r.band).toBe("informative");
    expect(r.bandLabel).not.toMatch(/positiv/i);
  });

  it("crisisFlag é sempre false", () => {
    expect(scoreAsrs18(new Array(18).fill(4)).crisisFlag).toBe(false);
  });
});

describe("scoreAsrs18 — validação de entrada", () => {
  it("comprimento errado (17) lança", () => {
    expect(() => scoreAsrs18(new Array(17).fill(0))).toThrow(/esperado 18/);
  });

  it("comprimento errado (19) lança", () => {
    expect(() => scoreAsrs18(new Array(19).fill(0))).toThrow(/esperado 18/);
  });

  it("valor acima de 4 lança (escala 0–4, não 0–3)", () => {
    const bad = zeros();
    bad[0] = 5;
    expect(() => scoreAsrs18(bad)).toThrow(/0–4/);
  });

  it("valor negativo lança", () => {
    const bad = zeros();
    bad[3] = -1;
    expect(() => scoreAsrs18(bad)).toThrow(/0–4/);
  });
});
