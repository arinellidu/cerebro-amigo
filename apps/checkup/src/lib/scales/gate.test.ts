import { describe, it, expect } from "vitest";
import { isScaleAvailable } from "./gate";
import { phq9 } from "./phq9";
import { gad7 } from "./gad7";
import { asrs18 } from "./asrs18";
import type { Scale } from "./types";

// Escala mínima para testar o caminho feliz
const MOCK_VALIDATED_SCALE: Scale = {
  id: "phq9",
  name: "Mock",
  timeframe: "2 semanas",
  instructions: "teste",
  options: [{ value: 0, label: "Nenhuma" }],
  items: [{ index: 1, text: "Item 1" }],
  bands: [{ min: 0, max: 1, band: "minimal", bandLabel: "mínimo" }],
  validated: true,
  source: "teste",
};

describe("isScaleAvailable — gate de produção", () => {
  it("phq9: validated=true + items preenchidos → LIBERADO (conferido vs PDF oficial Pfizer, 2026-06-11)", () => {
    expect(isScaleAvailable(phq9)).toBe(true);
    expect(phq9.validated).toBe(true);
    expect(phq9.items.length).toBe(9);
  });

  it("gad7: validated=true + items preenchidos → LIBERADO (conferido vs PDF oficial Pfizer, 2026-06-11)", () => {
    expect(isScaleAvailable(gad7)).toBe(true);
    expect(gad7.validated).toBe(true);
    expect(gad7.items.length).toBe(7);
  });

  it("asrs18: validated=true + 18 items → LIBERADO (Mattos 2006, scoring qualitativo sem verdict)", () => {
    expect(isScaleAvailable(asrs18)).toBe(true);
    expect(asrs18.validated).toBe(true);
    expect(asrs18.items).toHaveLength(18);
  });

  it("escala totalmente pronta (validated=true + items preenchidos) → LIBERADA", () => {
    expect(isScaleAvailable(MOCK_VALIDATED_SCALE)).toBe(true);
  });

  it("validated=true mas items=[] → BLOQUEADO (defesa contra stub sem texto)", () => {
    const stub: Scale = { ...MOCK_VALIDATED_SCALE, items: [] };
    expect(isScaleAvailable(stub)).toBe(false);
  });

  it("validated=false mas items preenchidos → BLOQUEADO (texto não conferido)", () => {
    const unverified: Scale = { ...MOCK_VALIDATED_SCALE, validated: false };
    expect(isScaleAvailable(unverified)).toBe(false);
  });
});
