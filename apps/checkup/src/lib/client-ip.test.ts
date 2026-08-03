import { describe, it, expect, afterEach } from "vitest";
import { getClientIp } from "./client-ip";

// Monta um req falso só com headers (o helper só lê headers).
function req(headers: Record<string, string>) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { headers: { get: (name: string) => lower[name.toLowerCase()] ?? null } };
}

// As envs são lidas em runtime → limpa entre testes.
afterEach(() => {
  delete process.env.CHECKUP_TRUSTED_PROXY_HOPS;
  delete process.env.CHECKUP_TRUST_CF_VIEWER_HEADER;
});

// Default CHECKUP_TRUSTED_PROXY_HOPS=0 (topologia viva: ALB-direto, 1 hop; o IP real é a
// ÚLTIMA entrada do XFF, que o ALB anexou).
describe("getClientIp — anti XFF-spoof (default ALB-direto, HOPS=0)", () => {
  it("XFF forjado à esquerda → retorna a ÚLTIMA entrada (a que o ALB anexou = viewer real)", () => {
    expect(getClientIp(req({ "x-forwarded-for": "9.9.9.9, 203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("várias entradas forjadas à esquerda não movem o resultado", () => {
    expect(getClientIp(req({ "x-forwarded-for": "a, b, c, 203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("entrada única (sem proxy) → retorna ela", () => {
    expect(getClientIp(req({ "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("HOPS não-numérico cai no default 0 (não reabre o spoof lendo o [0])", () => {
    process.env.CHECKUP_TRUSTED_PROXY_HOPS = "abc";
    expect(getClientIp(req({ "x-forwarded-for": "9.9.9.9, 203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("HOPS=1 (topologia CloudFront→ALB) → retorna o penúltimo (o que o CF anexou)", () => {
    process.env.CHECKUP_TRUSTED_PROXY_HOPS = "1";
    expect(getClientIp(req({ "x-forwarded-for": "9.9.9.9, 203.0.113.7, 198.51.100.2" }))).toBe("203.0.113.7");
  });
});

describe("getClientIp — CloudFront-Viewer-Address gated por flag", () => {
  it("IGNORADO por padrão (flag off) — atacante não forja a chave por esse header", () => {
    const ip = getClientIp(
      req({ "cloudfront-viewer-address": "1.2.3.4:443", "x-forwarded-for": "9.9.9.9" })
    );
    expect(ip).toBe("9.9.9.9"); // caiu no XFF, ignorou o header forjável
  });

  it("flag on + IPv4 → tira a porta e tem prioridade", () => {
    process.env.CHECKUP_TRUST_CF_VIEWER_HEADER = "true";
    const ip = getClientIp(
      req({ "cloudfront-viewer-address": "203.0.113.7:53124", "x-forwarded-for": "9.9.9.9" })
    );
    expect(ip).toBe("203.0.113.7");
  });

  it("flag on + IPv6 entre colchetes → sem porta, sem colchetes", () => {
    process.env.CHECKUP_TRUST_CF_VIEWER_HEADER = "true";
    expect(getClientIp(req({ "cloudfront-viewer-address": "[2001:db8::1]:443" }))).toBe("2001:db8::1");
  });

  it("flag on + IPv6 SEM colchetes (formato real AWS) → tira só a porta", () => {
    process.env.CHECKUP_TRUST_CF_VIEWER_HEADER = "true";
    expect(getClientIp(req({ "cloudfront-viewer-address": "2600:1f18:abcd::1:36567" }))).toBe("2600:1f18:abcd::1");
  });
});

describe("getClientIp — fallbacks", () => {
  it("sem XFF nem CF header → x-real-ip", () => {
    expect(getClientIp(req({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("sem nenhum header → 'unknown'", () => {
    expect(getClientIp(req({}))).toBe("unknown");
  });
});
