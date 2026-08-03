import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { checkDevolutivaLimit, checkPdfLimit, _testOnly } from "./ratelimit";

const IP = "192.0.2.1";
const SESSION = "550e8400-e29b-41d4-a716-446655440000";

// Sem DB no unit test → exercita o fallback in-memory (getSql() retorna null).
beforeAll(() => {
  delete process.env.CHECKUP_DATABASE_URL;
});

beforeEach(() => {
  _testOnly.resetAll();
});

describe("checkDevolutivaLimit — por sessão (fallback in-memory)", () => {
  it("primeira chamada → permitida", async () => {
    expect((await checkDevolutivaLimit(IP, SESSION)).allowed).toBe(true);
  });

  it("até 3 chamadas → todas permitidas", async () => {
    const sid = "aaaaaaaa-0000-0000-0000-000000000001";
    for (let i = 0; i < 3; i++) {
      expect((await checkDevolutivaLimit(IP, sid)).allowed).toBe(true);
    }
  });

  it("4ª chamada na mesma sessão → 429 session_exceeded", async () => {
    const sid = "aaaaaaaa-0000-0000-0000-000000000002";
    for (let i = 0; i < 3; i++) await checkDevolutivaLimit(IP, sid);
    const r = await checkDevolutivaLimit(IP, sid);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe("session_exceeded");
  });

  it("sessões diferentes não interferem entre si", async () => {
    const sid1 = "aaaaaaaa-0000-0000-0000-000000000003";
    const sid2 = "aaaaaaaa-0000-0000-0000-000000000004";
    for (let i = 0; i < 3; i++) await checkDevolutivaLimit(IP, sid1);
    expect((await checkDevolutivaLimit(IP, sid2)).allowed).toBe(true);
  });
});

describe("checkDevolutivaLimit — por IP (fallback in-memory)", () => {
  it("IP com 19 chamadas → 20ª permitida, 21ª bloqueada", async () => {
    _testOnly.fillIpWindow(IP, 19);
    const sid20 = "bbbbbbbb-0000-0000-0000-000000000001";
    const sid21 = "bbbbbbbb-0000-0000-0000-000000000002";
    expect((await checkDevolutivaLimit(IP, sid20)).allowed).toBe(true);
    const r = await checkDevolutivaLimit(IP, sid21);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe("ip_exceeded");
  });

  it("IP bloqueado expõe retryAfterMs > 0", async () => {
    _testOnly.fillIpWindow(IP, 20);
    const r = await checkDevolutivaLimit(IP, SESSION);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.retryAfterMs ?? 0).toBeGreaterThan(0);
  });

  it("sessão esgotada tem prioridade sobre IP livre", async () => {
    _testOnly.setSessionCount(SESSION, 3);
    const r = await checkDevolutivaLimit(IP, SESSION);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe("session_exceeded");
  });
});

describe("checkPdfLimit — por IP (fallback in-memory)", () => {
  it("até 30 chamadas → todas permitidas", async () => {
    for (let i = 0; i < 30; i++) {
      expect((await checkPdfLimit(`10.0.0.${(i % 254) + 1}`)).allowed).toBe(true);
    }
  });

  it("31ª chamada do mesmo IP → 429 ip_exceeded", async () => {
    const ip = "10.0.0.99";
    for (let i = 0; i < 30; i++) await checkPdfLimit(ip);
    const r = await checkPdfLimit(ip);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe("ip_exceeded");
  });
});
