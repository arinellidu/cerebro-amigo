import { describe, it, expect } from "vitest";
import { buildNudgeLinks, buildNudgeEmail } from "./nudge-email";

describe("nudge-email — template fixo (clinical-safety)", () => {
  const links = buildNudgeLinks("https://checkup.cerebroamigo.com.br/", "TOK_abc-123");

  it("links usam o series_token, encodados, sem barra dupla", () => {
    expect(links.evolucao).toBe("https://checkup.cerebroamigo.com.br/evolucao?t=TOK_abc-123");
    expect(links.cancelar).toContain("/api/tracking/unsubscribe?t=TOK_abc-123");
    expect(links.apagar).toContain("/descadastrar?t=TOK_abc-123");
  });

  it("e-mail traz os 3 links + CVV + marca, e NÃO interpreta resultado", () => {
    const { subject, text } = buildNudgeEmail(links);
    expect(subject).toMatch(/refazer/i);
    expect(text).toContain(links.evolucao);
    expect(text).toContain(links.cancelar);
    expect(text).toContain(links.apagar);
    expect(text).toContain("CVV 188");
    expect(text).toContain("cerebroamigo.com.br");
    // "diagnóstico" só pode aparecer na negação ("não um diagnóstico") — nunca afirmando.
    expect(text).toMatch(/não um diagnóstico/i);
    // sem variáveis de escore/faixa no template (builder nem recebe escore).
    expect(text).not.toMatch(/escore|pontu|faixa|grave|moderad/i);
  });
});
