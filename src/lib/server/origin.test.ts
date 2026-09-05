import { describe, expect, it } from "vitest";
import { checkOrigin, isApiPath, originHost, requestHost } from "./origin";

const NO_PROXY = {};
const PROXY = { TRUST_PROXY_HEADERS: "1" };

function h(init: Record<string, string>): Headers {
  return new Headers(init);
}

describe("checkOrigin", () => {
  it("lets safe methods through regardless of headers", () => {
    for (const m of ["GET", "HEAD", "OPTIONS", "get"]) {
      expect(checkOrigin(m, h({ origin: "https://evil.example", "sec-fetch-site": "cross-site" }), NO_PROXY)).toEqual({ ok: true });
    }
  });

  it("rejects cross-site and same-site Sec-Fetch-Site on state-changing methods", () => {
    expect(checkOrigin("POST", h({ host: "app.local", "sec-fetch-site": "cross-site" }), NO_PROXY)).toEqual({ ok: false, reason: "sec_fetch_site" });
    expect(checkOrigin("PUT", h({ host: "app.local", "sec-fetch-site": "same-site" }), NO_PROXY)).toEqual({ ok: false, reason: "sec_fetch_site" });
    expect(checkOrigin("DELETE", h({ host: "app.local", "sec-fetch-site": "same-origin" }), NO_PROXY)).toEqual({ ok: true });
    expect(checkOrigin("POST", h({ host: "app.local", "sec-fetch-site": "none" }), NO_PROXY)).toEqual({ ok: true });
  });

  it("rejects an Origin whose host differs from the request Host", () => {
    expect(checkOrigin("POST", h({ host: "app.local:3000", origin: "https://evil.example" }), NO_PROXY)).toEqual({ ok: false, reason: "origin_mismatch" });
    expect(checkOrigin("POST", h({ host: "app.local:3000", origin: "http://app.local:3000" }), NO_PROXY)).toEqual({ ok: true });
    expect(checkOrigin("POST", h({ host: "App.Local:3000", origin: "http://app.local:3000" }), NO_PROXY)).toEqual({ ok: true });
    // Port matters: a different port is a different origin.
    expect(checkOrigin("POST", h({ host: "app.local:3000", origin: "http://app.local:4000" }), NO_PROXY)).toEqual({ ok: false, reason: "origin_mismatch" });
    // "null" and garbage origins are rejected, and so is a missing Host.
    expect(checkOrigin("POST", h({ host: "app.local", origin: "null" }), NO_PROXY)).toEqual({ ok: false, reason: "origin_mismatch" });
    expect(checkOrigin("POST", h({ host: "app.local", origin: "not a url" }), NO_PROXY)).toEqual({ ok: false, reason: "origin_mismatch" });
    expect(checkOrigin("POST", h({ origin: "http://app.local" }), NO_PROXY)).toEqual({ ok: false, reason: "origin_mismatch" });
  });

  it("allows requests with neither header (non-browser clients); readJson's content-type rule is the second line", () => {
    expect(checkOrigin("POST", h({ host: "app.local" }), NO_PROXY)).toEqual({ ok: true });
  });

  it("uses X-Forwarded-Host only behind a declared proxy", () => {
    const headers = h({ host: "internal:3000", "x-forwarded-host": "grid.example", origin: "https://grid.example" });
    expect(checkOrigin("POST", headers, NO_PROXY)).toEqual({ ok: false, reason: "origin_mismatch" });
    expect(checkOrigin("POST", headers, PROXY)).toEqual({ ok: true });
    // …and a spoofed X-Forwarded-Host without the flag cannot make a cross-site origin match.
    expect(checkOrigin("POST", h({ host: "internal:3000", "x-forwarded-host": "evil.example", origin: "https://evil.example" }), NO_PROXY)).toEqual({
      ok: false,
      reason: "origin_mismatch",
    });
  });
});

describe("helpers", () => {
  it("requestHost / originHost normalise case and handle garbage", () => {
    expect(requestHost(h({ host: " Grid.Example " }), NO_PROXY)).toBe("grid.example");
    expect(requestHost(h({}), NO_PROXY)).toBeNull();
    expect(originHost("https://Grid.Example:8443/path")).toBe("grid.example:8443");
    expect(originHost("")).toBeNull();
    expect(originHost("null")).toBeNull();
  });

  it("isApiPath", () => {
    expect(isApiPath("/api")).toBe(true);
    expect(isApiPath("/api/find")).toBe(true);
    expect(isApiPath("/apis")).toBe(false);
    expect(isApiPath("/grid")).toBe(false);
  });
});
