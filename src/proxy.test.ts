/**
 * The Next.js proxy applies the origin guard to /api/* only, and its 403 body is a code —
 * never the offending header values.
 */
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";

function req(path: string, init: { method?: string; headers?: Record<string, string> } = {}): NextRequest {
  return new NextRequest(`http://app.local:3000${path}`, {
    method: init.method ?? "POST",
    headers: { host: "app.local:3000", ...init.headers },
  });
}

describe("proxy", () => {
  it("matches only the API namespace", () => {
    expect(config.matcher).toEqual(["/api/:path*"]);
  });

  it("403s a cross-site POST to an API route without echoing the headers", async () => {
    const res = proxy(req("/api/auth/login", { headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" } }));
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "forbidden_origin" });
    expect(text).not.toContain("evil.example");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("passes same-origin and header-less API requests, and every GET", () => {
    expect(proxy(req("/api/auth/login", { headers: { origin: "http://app.local:3000", "sec-fetch-site": "same-origin" } })).status).toBe(200);
    expect(proxy(req("/api/keys", { method: "PUT" })).status).toBe(200);
    expect(proxy(req("/api/auth/me", { method: "GET", headers: { origin: "https://evil.example" } })).status).toBe(200);
  });

  it("leaves non-API paths alone even when the guard would fail", () => {
    expect(proxy(req("/grid", { headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" } })).status).toBe(200);
  });
});
