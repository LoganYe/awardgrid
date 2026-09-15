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

  it("sends a per-instance timeoutMs as both native timeouts, and other instances keep their own", async () => {
    const request = vi.fn(deps().request);
    const f = createNativeFetch({ deps: deps({ request }), timeoutMs: 90_000 });
    await f("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const sent = request.mock.calls[0]![0] as Record<string, unknown>;
    // iOS reads connectTimeout ?? readTimeout into one idle interval (HttpRequestHandler.swift:203-205).
    // Sending the same value as both keeps this adapter's meaning independent of that precedence.
    expect(sent.connectTimeout).toBe(90_000);
    expect(sent.readTimeout).toBe(90_000);

    // A second adapter does not share the first one's value: seats.aero keeps its 20 s.
    const other = vi.fn(deps().request);
    await createNativeFetch({ deps: deps({ request: other }) })("https://seats.aero/partnerapi/search");
    const seats = other.mock.calls[0]![0] as Record<string, unknown>;
    expect([seats.connectTimeout, seats.readTimeout]).toEqual([DEFAULT_NATIVE_TIMEOUT_MS, DEFAULT_NATIVE_TIMEOUT_MS]);
  });

  it("passes a string POST body with a lower-case content-type through unchanged", async () => {
    const request = vi.fn(deps().request);
    const f = createNativeFetch({ deps: deps({ request }) });
    // What the Anthropic SDK hands a fetch: JSON already serialised, under a lower-case header name.
    const body = JSON.stringify({ model: "claude-opus-5", messages: [{ role: "user", content: "Tōkyō — 東京   \"quoted\"" }] });
    await f("https://api.anthropic.com/v1/messages", { method: "post", headers: { "content-type": "application/json" }, body });

    const sent = request.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent.method).toBe("POST");
    // The very string, not a re-serialisation of it: Capacitor turns a string body into its UTF-8 bytes
    // before any JSON handling (CapacitorUrlRequest.swift:184-186) ...
    expect(sent.data).toBe(body);
    // ... but only sets httpBody when it finds a Content-Type (:215-221). Its lookup lower-cases the
    // stored keys and the key it asks for (:118-124), so this header is found as sent.
    expect(sent.headers).toEqual({ "content-type": "application/json" });
  });

  it("turns a Headers instance into a plain record, because a Headers crosses the bridge as {}", async () => {
    const request = vi.fn(deps().request);
    const f = createNativeFetch({ deps: deps({ request }) });
    const headers = new Headers({ "X-Api-Key": "test-key-not-real", "anthropic-version": "2023-06-01", "Content-Type": "application/json" });
    // The failure this prevents: a Headers object has no own enumerable properties.
    expect(JSON.stringify(headers)).toBe("{}");

    await f("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: "{}" });
    const sent = request.mock.calls[0]![0] as { headers: Record<string, string> };
    expect(Object.getPrototypeOf(sent.headers)).toBe(Object.prototype);
    expect(sent.headers).toEqual({ "x-api-key": "test-key-not-real", "anthropic-version": "2023-06-01", "content-type": "application/json" });
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
