import { describe, expect, it } from "vitest";
import { ASK_DEMO_STORAGE_KEY, askDemoCapRequested, askDemoRequested, askDemoStreamUrl, askDemoUsageUrl, probeAskDemo, resolveAskDemo } from "./demo";

/** Minimal in-memory Storage stand-in (the drawer only ever calls getItem/setItem). */
function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

describe("resolveAskDemo", () => {
  it("remembers the switch for the session, so a URL rewrite cannot lose it", () => {
    const storage = memoryStorage();
    expect(resolveAskDemo("?askdemo=1&askcap=1", storage)).toEqual({ on: true, cap: true, err: null });
    expect(storage.getItem(ASK_DEMO_STORAGE_KEY)).toBe('{"cap":true,"err":null}');
    expect(resolveAskDemo("?q=abc", storage)).toEqual({ on: true, cap: true, err: null });
  });

  it("stays off with no URL switch and nothing stored", () => {
    expect(resolveAskDemo("", memoryStorage())).toEqual({ on: false, cap: false, err: null });
    expect(resolveAskDemo("", null)).toEqual({ on: false, cap: false, err: null });
    expect(resolveAskDemo("", memoryStorage({ [ASK_DEMO_STORAGE_KEY]: "{oops" }))).toEqual({ on: false, cap: false, err: null });
  });

  it("carries a scripted failure and ignores an unknown code", () => {
    expect(resolveAskDemo("?askdemo=1&askerr=no_key", memoryStorage())).toEqual({ on: true, cap: false, err: "no_key" });
    expect(resolveAskDemo("?askdemo=1&askerr=nonsense", memoryStorage())).toEqual({ on: true, cap: false, err: null });
  });
});

describe("demo switches", () => {
  it("is off unless the page asks for it", () => {
    expect(askDemoRequested("")).toBe(false);
    expect(askDemoRequested("?q=abc")).toBe(false);
    expect(askDemoRequested("?askdemo=0")).toBe(false);
    expect(askDemoRequested("?askdemo=1")).toBe(true);
    expect(askDemoRequested("?q=abc&askdemo=1")).toBe(true);
  });

  it("reads the cap switch separately", () => {
    expect(askDemoCapRequested("?askdemo=1")).toBe(false);
    expect(askDemoCapRequested("?askdemo=1&askcap=1")).toBe(true);
  });

  it("builds the stream and usage URLs", () => {
    expect(askDemoStreamUrl({ cap: false, err: null })).toBe("/api/ask/demo");
    expect(askDemoStreamUrl({ cap: true, err: null })).toBe("/api/ask/demo?cap=1");
    expect(askDemoStreamUrl({ cap: false, err: "no_key" })).toBe("/api/ask/demo?err=no_key");
    expect(askDemoUsageUrl(0, false)).toBe("/api/ask/demo?usage=1&after=0");
    expect(askDemoUsageUrl(2, true)).toBe("/api/ask/demo?usage=1&after=2&cap=1");
    expect(askDemoUsageUrl(-3, false)).toBe("/api/ask/demo?usage=1&after=0");
  });
});

describe("probeAskDemo", () => {
  const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));

  it("is true only when the route answers { demo: true }", async () => {
    await expect(probeAskDemo(() => ok({ demo: true }))).resolves.toBe(true);
    await expect(probeAskDemo(() => ok({ demo: false }))).resolves.toBe(false);
    await expect(probeAskDemo(() => Promise.resolve(new Response("", { status: 404 })))).resolves.toBe(false);
    await expect(probeAskDemo(() => Promise.reject(new Error("offline")))).resolves.toBe(false);
  });
});
