import { describe, expect, it } from "vitest";
import { getResultShareMeta } from "./result-og";

describe("getResultShareMeta", () => {
  it("mapeia escala para texto de compartilhamento sem PII", () => {
    expect(getResultShareMeta("gad7").title).toBe("Fiz meu check-up de ansiedade");
    expect(getResultShareMeta("phq9").title).toBe("Fiz meu check-up de depressão");
  });

  it("não inclui escore nem faixa no metadata", () => {
    const meta = getResultShareMeta("gad7");
    expect(meta.title).not.toMatch(/\d/);
    expect(meta.description).not.toMatch(/escore|faixa|grave|leve/i);
  });

  it("usa fallback genérico para escala desconhecida", () => {
    expect(getResultShareMeta("xyz").title).toBe("Fiz meu check-up mental");
    expect(getResultShareMeta(null).title).toBe("Fiz meu check-up mental");
  });
});
