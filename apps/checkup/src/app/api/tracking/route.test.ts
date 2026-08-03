import { describe, it, expect, afterEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { POST } from "./route";

// Testes de PORTÃO (sem DB): flag dark, fail-closed sem chave, rejeição de crise,
// validação. O caminho feliz precisa de Postgres (pgp_sym_encrypt) e roda no smoke.

const VALID = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  consent: true,
  email: "a@b.com",
  scaleId: "phq9",
  totalScore: 12,
  band: "moderate",
  crisis: false,
};

function post(body: unknown): NextRequest {
  return new Request("http://localhost/api/tracking", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "1.2.3.4" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/tracking — portões", () => {
  it("dark por padrão: flag != 'true' → 404", async () => {
    vi.stubEnv("NEXT_PUBLIC_CHECKUP_TRACKING_ENABLED", "false");
    vi.stubEnv("CHECKUP_ENCRYPTION_KEY", "k");
    const res = await POST(post(VALID));
    expect(res.status).toBe(404);
  });

  it("fail-closed: flag on mas sem CHECKUP_ENCRYPTION_KEY → 503", async () => {
    vi.stubEnv("NEXT_PUBLIC_CHECKUP_TRACKING_ENABLED", "true");
    vi.stubEnv("CHECKUP_ENCRYPTION_KEY", "");
    const res = await POST(post(VALID));
    expect(res.status).toBe(503);
  });

  it("crise é first-class: crisis=true → 409 (nunca cria série)", async () => {
    vi.stubEnv("NEXT_PUBLIC_CHECKUP_TRACKING_ENABLED", "true");
    vi.stubEnv("CHECKUP_ENCRYPTION_KEY", "k");
    const res = await POST(post({ ...VALID, crisis: true }));
    expect(res.status).toBe(409);
  });

  it("input inválido (sem e-mail) → 400", async () => {
    vi.stubEnv("NEXT_PUBLIC_CHECKUP_TRACKING_ENABLED", "true");
    vi.stubEnv("CHECKUP_ENCRYPTION_KEY", "k");
    const { email: _omit, ...semEmail } = VALID;
    const res = await POST(post(semEmail));
    expect(res.status).toBe(400);
  });

  it("consentimento explícito obrigatório: sem consent → 400", async () => {
    vi.stubEnv("NEXT_PUBLIC_CHECKUP_TRACKING_ENABLED", "true");
    vi.stubEnv("CHECKUP_ENCRYPTION_KEY", "k");
    const { consent: _c, ...semConsent } = VALID;
    expect((await POST(post(semConsent))).status).toBe(400);
    expect((await POST(post({ ...VALID, consent: false }))).status).toBe(400);
  });

  it("sem DB (vitest) → 503, nunca finge sucesso", async () => {
    vi.stubEnv("NEXT_PUBLIC_CHECKUP_TRACKING_ENABLED", "true");
    vi.stubEnv("CHECKUP_ENCRYPTION_KEY", "k");
    const res = await POST(post(VALID));
    expect(res.status).toBe(503);
  });
});
