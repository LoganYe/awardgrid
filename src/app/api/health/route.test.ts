import { describe, expect, it } from "vitest";
import { healthPayload } from "@/lib/server/health";
import { GET } from "./route";

describe("GET /api/health", () => {
  it("returns ok, a semver version and an ISO time", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { ok: boolean; version: string; time: string };
    expect(body.ok).toBe(true);
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);
    expect(Object.keys(body).sort()).toEqual(["ok", "time", "version"]);
  });

  it("healthPayload uses the injected clock", () => {
    const at = new Date("2026-09-06T00:00:00.000Z");
    expect(healthPayload(at).time).toBe("2026-09-06T00:00:00.000Z");
  });
});
