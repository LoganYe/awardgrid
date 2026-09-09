/**
 * The native-HTTP adapter, tested against a fake bridge.
 *
 * These assert the two things Phase 0 measured on a device (docs/PHASE0.md §3, §4), so that a
 * later refactor cannot quietly undo them:
 *
 *   - a native timeout is ALWAYS sent, because `AbortSignal` does not reach URLSession and an
 *     unbounded abandoned request still spends a seats.aero quota call;
 *   - the startup assertion fails loudly off-native rather than falling through to WebView
 *     networking, which seats.aero blocks by CORS.
 */
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_NATIVE_TIMEOUT_MS,
  NativeHttpUnavailableError,
  assertNativeHttpAvailable,
  createNativeFetch,
  type NativeHttpDeps,
} from "./http";

function deps(over: Partial<NativeHttpDeps> = {}): NativeHttpDeps {
  return {
    isNativePlatform: () => true,
    getPlatform: () => "ios",
    isPluginAvailable: () => true,
    request: async () => ({ status: 200, data: '{"ok":true}', headers: { "content-type": "application/json" } }),
    ...over,
  };
}

describe("assertNativeHttpAvailable", () => {
  it("passes on a native platform with the plugin registered", () => {
    expect(() => assertNativeHttpAvailable(deps())).not.toThrow();
  });

  it("fails loudly in a browser rather than falling through to WebView networking", () => {
    expect(() => assertNativeHttpAvailable(deps({ isNativePlatform: () => false, getPlatform: () => "web" }))).toThrow(
      NativeHttpUnavailableError,
    );
  });

  it("fails when CapacitorHttp is not registered", () => {
    expect(() => assertNativeHttpAvailable(deps({ isPluginAvailable: () => false }))).toThrow(/not registered/i);
  });
});

describe("createNativeFetch", () => {
  it("returns a real Response with readable headers", async () => {
    const f = createNativeFetch({
      deps: deps({
        request: async () => ({
          status: 401,
          data: "nope",
          headers: { "x-ratelimit-remaining": "400", "content-type": "text/plain" },
        }),
      }),
    });
    const res = await f("https://seats.aero/partnerapi/search");
    expect(res.status).toBe(401);
    // Readable headers are the whole point: a CORS-blocked request could report neither.
    expect(res.headers.get("x-ratelimit-remaining")).toBe("400");
    expect(await res.text()).toBe("nope");
  });

  it("ALWAYS sends a native timeout, because AbortSignal cannot cancel the request", async () => {
    const request = vi.fn(deps().request);
    const f = createNativeFetch({ deps: deps({ request }) });
    await f("https://seats.aero/partnerapi/search");

    const sent = request.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent.connectTimeout).toBe(DEFAULT_NATIVE_TIMEOUT_MS);
    expect(sent.readTimeout).toBe(DEFAULT_NATIVE_TIMEOUT_MS);
  });

  it("lets a caller tighten the native timeout", async () => {
    const request = vi.fn(deps().request);
    const f = createNativeFetch({ deps: deps({ request }) });
    await f("https://x.test", { connectTimeout: 1500, readTimeout: 1500 } as RequestInit);
    const sent = request.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent.readTimeout).toBe(1500);
  });

  it("refuses an already-aborted signal before crossing the bridge", async () => {
    const request = vi.fn(deps().request);
    const f = createNativeFetch({ deps: deps({ request }) });
    const c = new AbortController();
    c.abort();
    await expect(f("https://x.test", { signal: c.signal })).rejects.toThrow(/abort/i);
    // The only cancellation that actually saves a quota call is the one that never happens.
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects when the signal fires mid-flight, but the request is NOT recalled", async () => {
    let settle: (v: { status: number; data: string; headers: Record<string, string> }) => void = () => {};
    const request = vi.fn(
      () => new Promise<{ status: number; data: string; headers: Record<string, string> }>((r) => (settle = r)),
    );
    const f = createNativeFetch({ deps: deps({ request }) });
    const c = new AbortController();
    const p = f("https://x.test", { signal: c.signal });
    c.abort();
    await expect(p).rejects.toThrow(/abort/i);
    // The bridge call was made and is still outstanding: this is the measured Phase 0 behaviour.
    expect(request).toHaveBeenCalledTimes(1);
    settle({ status: 200, data: "{}", headers: {} });
  });

  it("reports response headers to the quota observer", async () => {
    const seen: Array<[string | null, string]> = [];
    const f = createNativeFetch({
      deps: deps({ request: async () => ({ status: 200, data: "{}", headers: { "X-RateLimit-Remaining": "123" } }) }),
      onResponseHeaders: (h, url) => seen.push([h.get("x-ratelimit-remaining"), url]),
    });
    await f("https://seats.aero/partnerapi/search?x=1");
    expect(seen).toEqual([["123", "https://seats.aero/partnerapi/search?x=1"]]);
  });

  it("does not hand a body to a status that forbids one", async () => {
    const f = createNativeFetch({ deps: deps({ request: async () => ({ status: 204, data: "", headers: {} }) }) });
    const res = await f("https://x.test");
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
  });

  it("re-serialises an eagerly parsed JSON body back to text", async () => {
    const f = createNativeFetch({
      deps: deps({ request: async () => ({ status: 200, data: { data: [{ ID: "a" }] }, headers: {} }) }),
    });
    const res = await f("https://x.test");
    expect(JSON.parse(await res.text())).toEqual({ data: [{ ID: "a" }] });
  });

  it("refuses a Request object rather than silently mishandling it", async () => {
    const f = createNativeFetch({ deps: deps() });
    await expect(f(new Request("https://x.test"))).rejects.toThrow(NativeHttpUnavailableError);
  });
});
