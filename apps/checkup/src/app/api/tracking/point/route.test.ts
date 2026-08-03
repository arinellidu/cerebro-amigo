import { describe, it, expect } from "vitest";
import type { NextRequest } from "next/server";
import { POST } from "./route";

const VALID = { token: "TOK_abc", totalScore: 9, band: "mild", crisis: false };

function post(body: unknown): NextRequest {
  return new Request("http://localhost/api/tracking/point", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "9.9.9.9" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe("POST /api/tracking/point — portões", () => {
  it("crise nunca anexa ponto: crisis=true → 409", async () => {
    expect((await POST(post({ ...VALID, crisis: true }))).status).toBe(409);
  });
  it("input inválido (sem token) → 400", async () => {
    expect((await POST(post({ totalScore: 9, band: "mild" }))).status).toBe(400);
  });
  it("sem DB (vitest) → 503", async () => {
    expect((await POST(post(VALID))).status).toBe(503);
  });
});
