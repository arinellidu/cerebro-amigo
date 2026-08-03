import { describe, it, expect } from "vitest";
import type { NextRequest } from "next/server";
import { GET } from "./route";

function get(url: string): NextRequest {
  return new Request(url) as unknown as NextRequest;
}

describe("GET /api/tracking/series — portões", () => {
  it("sem token → 400", async () => {
    expect((await GET(get("http://localhost/api/tracking/series"))).status).toBe(400);
  });
  it("com token mas sem DB (vitest) → 503", async () => {
    expect((await GET(get("http://localhost/api/tracking/series?t=abc"))).status).toBe(503);
  });
});
