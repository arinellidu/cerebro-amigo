import { describe, expect, it } from "vitest";
import { extractJsonPayload } from "./devolutiva";

// Regressão 2026-07-15: claude-haiku-4-5 devolvia o JSON dentro de cerca markdown e
// TODA devolutiva LLM degradava para o fallback estático (JSON.parse estourava).
describe("extractJsonPayload", () => {
  const payload = '{"acolhimento":"oi"}';

  it("JSON puro passa intacto", () => {
    expect(extractJsonPayload(payload)).toBe(payload);
  });

  it("strip de cerca ```json", () => {
    expect(extractJsonPayload("```json\n" + payload + "\n```")).toBe(payload);
  });

  it("strip de cerca ``` sem linguagem", () => {
    expect(extractJsonPayload("```\n" + payload + "\n```")).toBe(payload);
  });

  it("tolera whitespace nas bordas", () => {
    expect(extractJsonPayload("  \n```json\n" + payload + "\n```\n  ")).toBe(payload);
  });

  it("não mexe em texto que só contém cerca no meio", () => {
    const meio = 'antes ```json {"x":1}``` depois';
    expect(extractJsonPayload(meio)).toBe(meio);
  });
});
