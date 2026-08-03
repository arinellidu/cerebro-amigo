import { describe, it, expect, afterEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { POST } from "./route";

function post(token?: string): NextRequest {
  return new Request("http://localhost/api/tracking/retention", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  }) as unknown as NextRequest;
}

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/tracking/retention — portões", () => {
  it("sem CHECKUP_CRON_TOKEN → 503", async () => {
    vi.stubEnv("CHECKUP_CRON_TOKEN", "");
    expect((await POST(post("x"))).status).toBe(503);
  });
  it("token errado → 401", async () => {
    vi.stubEnv("CHECKUP_CRON_TOKEN", "secret");
    expect((await POST(post("wrong"))).status).toBe(401);
  });
  it("token ok mas sem DB (vitest) → 503", async () => {
    vi.stubEnv("CHECKUP_CRON_TOKEN", "secret");
    expect((await POST(post("secret"))).status).toBe(503);
  });
});
