/**
 * Ask's wiring at launch (design §1.2, §10.1): nothing Anthropic happens at launch, Anthropic gets a second native
 * adapter with no rate-limit observer, and a question spends seats.aero calls through the grid lane's observed
 * transport.
 *
 * Two modules are wrapped, not replaced. `../native/http` keeps its real functions, but createNativeFetch is
 * watched so its arguments can be read, and assertNativeHttpAvailable passes, since the test runner is not an iOS
 * WebView. Core's createAskClient is watched so its calls can be counted and read. A question runs the real SDK over
 * scripted Anthropic streams and core's real tools over a fake seats.aero. No network, no Keychain, a fixed clock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../native/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../native/http")>();
  return {
    ...actual,
    // Each adapter built is itself watched, so a test can show it was never called.
    createNativeFetch: vi.fn((options?: Parameters<typeof actual.createNativeFetch>[0]) => vi.fn(actual.createNativeFetch(options))),
    assertNativeHttpAvailable: vi.fn(),
  };
});

vi.mock("@awardgrid/core/ask/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@awardgrid/core/ask/client")>();
  return { ...actual, createAskClient: vi.fn(actual.createAskClient) };
});

import { newConversation } from "@awardgrid/core/ask/conversation";
import { createAskClient } from "@awardgrid/core/ask/client";
import { ANTHROPIC_IDLE_TIMEOUT_MS } from "@awardgrid/core/ask/limits";
import type { Watch } from "@awardgrid/core/watch";
import { type StreamEvent, toSse } from "@awardgrid/core/test-fixtures/ask/sse";
import streams from "@awardgrid/core/test-fixtures/ask/streams.json";
import { type FakeHandler, fakeFetch } from "@awardgrid/core/test-fixtures/seatsaero/helpers";
import { createNativeFetch } from "../native/http";
import { type KeyStore, MemoryKeyStore } from "../native/keychain";
import { LOCAL_USER } from "../search/search";
import { ASK_FILE, AskStore } from "../store/ask-store";
import { CACHE_FILE, MemoryFileStore, QUOTA_FILE, SnapshotStore } from "../store/persistence";
import { bootstrap } from "./bootstrap";

const NOW = new Date("2026-10-01T00:00:00.000Z");
const SEATS_KEY = "pro_bootstrap_ask_test_key_DO_NOT_LEAK";
const ANTHROPIC_KEY = "sk-ant-api03-bootstrap-ask-test-key-DO_NOT_LEAK";
const QUESTION = "Cheapest business class from SEA to Tokyo in October?";

type ScriptName = Exclude<keyof typeof streams, `_${string}`>;

beforeEach(() => {
  // The SDK folds this variable into every request's headers (core client.ts); the tests must not depend on the shell.
  vi.stubEnv("ANTHROPIC_CUSTOM_HEADERS", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function availability(origin: string, dest: string, date: string) {
  return {
    ID: `id-${origin}-${dest}-${date}`,
    RouteID: `r-${origin}-${dest}`,
    Route: { ID: `r-${origin}-${dest}`, OriginAirport: origin, DestinationAirport: dest, Source: "alaska" },
    Date: date,
    ParsedDate: `${date}T00:00:00Z`,
    Source: "alaska",
    JAvailable: true,
    JMileageCost: "75000",
    JRemainingSeats: 2,
    JAirlines: "JL",
    JDirect: true,
    YAvailable: false,
    WAvailable: false,
    FAvailable: false,
  };
}

/**
 * seats.aero, saying 400 calls are left today. Searches answer rows for every pair Ask's and the grid's searches ask
 * about (SEA to NRT and HND; HKG to SEA), so no pair is empty and no Get Routes call follows.
 */
function seatsAero(hold?: Promise<void>): FakeHandler {
  return async (req) => {
    if (hold) await hold;
    const body = req.url.pathname.endsWith("/routes")
      ? []
      : { data: [availability("SEA", "NRT", "2026-10-05"), availability("SEA", "HND", "2026-10-06"), availability("HKG", "SEA", "2026-10-07")], hasMore: false };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", "X-RateLimit-Remaining": "400" } });
  };
}

/** api.anthropic.com replaying scripts in order. Every response also claims 5 calls left, which must reach no quota. */
function anthropic(scripts: ScriptName[]) {
  const queue = [...scripts];
  const calls: Array<{ method: string; url: string; headers: Record<string, string> }> = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => {
      headers[key] = value;
    });
    calls.push({ method: (init.method ?? "GET").toUpperCase(), url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url, headers });
    const name = queue.shift();
    if (name === undefined) throw new Error("no scripted Anthropic response left");
    return new Response(toSse(streams[name] as unknown as StreamEvent[], { pingEvery: 2 }), {
      status: 200,
      headers: { "content-type": "text/event-stream", "request-id": `req_synthetic_${name}`, "x-ratelimit-remaining": "5" },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function watchedKeys(key: string | null): KeyStore & { get: ReturnType<typeof vi.fn> } {
  let value = key;
  return {
    get: vi.fn(async () => value),
    set: vi.fn(async (next: string) => {
      value = next.trim();
    }),
    clear: vi.fn(async () => {
      value = null;
    }),
  };
}

async function seatsKeys(): Promise<MemoryKeyStore> {
  const keys = new MemoryKeyStore();
  await keys.set(SEATS_KEY);
  return keys;
}

/** The adapters createNativeFetch built during this test, each a watched function. */
const builtAdapters = () => vi.mocked(createNativeFetch).mock.results.map((result) => result.value as ReturnType<typeof vi.fn>);

describe("launch", () => {
  it("resolves with no Anthropic key and no Anthropic transport injected, and touches neither", async () => {
    const files = new MemoryFileStore();
    const anthropicKeys = watchedKeys(null);
    const svc = await bootstrap({ keys: await seatsKeys(), anthropicKeys, snapshots: new SnapshotStore(files), now: () => NOW, fetchImpl: fakeFetch(seatsAero()) });

    expect(svc.anthropicKeys).toBe(anthropicKeys);
    expect(anthropicKeys.get).not.toHaveBeenCalled();
    expect(createAskClient).not.toHaveBeenCalled();
    expect(builtAdapters()).toHaveLength(1);
    expect(builtAdapters()[0]).not.toHaveBeenCalled();
    expect(svc.ask.state()).toMatchObject({ entries: [], running: null, notice: null, retryEntryId: null });
    expect(svc.ask.isRunning()).toBe(false);
    expect(files.files.has(ASK_FILE)).toBe(false);
  });

  it("builds Anthropic its own native adapter, with its idle timeout and no response-header observer", async () => {
    await bootstrap({ keys: await seatsKeys(), anthropicKeys: watchedKeys(null), snapshots: new SnapshotStore(new MemoryFileStore()), now: () => NOW });

    expect(ANTHROPIC_IDLE_TIMEOUT_MS).toBe(90_000);
    // The seats.aero adapter (no options, observed by bootstrap's wrapper), then Anthropic's, with nothing but a timeout.
    expect(vi.mocked(createNativeFetch).mock.calls).toEqual([[], [{ timeoutMs: ANTHROPIC_IDLE_TIMEOUT_MS }]]);
    for (const adapter of builtAdapters()) expect(adapter).not.toHaveBeenCalled();
  });

  it("a grid search still spends through the observed fetch, with the Anthropic transport untouched", async () => {
    const seats = fakeFetch(seatsAero());
    const svc = await bootstrap({ keys: await seatsKeys(), anthropicKeys: watchedKeys(ANTHROPIC_KEY), snapshots: new SnapshotStore(new MemoryFileStore()), now: () => NOW, fetchImpl: seats });

    const res = await svc.engine.search("HKG to SEA next 30 days business", SEATS_KEY);
    expect(res.ok).toBe(true);
    expect(seats.calls.length).toBeGreaterThan(0);
    expect(await svc.engine.quota.used(LOCAL_USER)).toBe(600);
    expect(builtAdapters()[0]).not.toHaveBeenCalled();
    expect(createAskClient).not.toHaveBeenCalled();
  });

  it("turns a question the app was closed during into an unfinished entry, reading no key to do it", async () => {
    const files = new MemoryFileStore();
    const left = newConversation({ id: "conv-left", now: () => NOW });
    left.entries.push({
      id: "entry-1",
      question: QUESTION,
      includeSearch: false,
      askedAt: NOW.toISOString(),
      steps: [],
      texts: [],
      usage: { requests: 1, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, lastRequestInputTokens: null, toolCalls: 0, seatsCalls: 0 },
      end: null,
    });
    left.pending = { entryId: "entry-1", startedAt: NOW.toISOString() };
    await new AskStore(files).write(left);
    const anthropicKeys = watchedKeys(ANTHROPIC_KEY);

    const svc = await bootstrap({ keys: await seatsKeys(), anthropicKeys, snapshots: new SnapshotStore(files), now: () => NOW, fetchImpl: fakeFetch(seatsAero()) });

    expect(svc.ask.state().entries[0]!.end?.status).toBe("unfinished");
    expect((await new AskStore(files).read())?.pending).toBeNull();
    expect(anthropicKeys.get).not.toHaveBeenCalled();
  });
});

describe("a question through AppServices", () => {
  async function asked() {
    const files = new MemoryFileStore();
    const seats = fakeFetch(seatsAero());
    const api = anthropic(["tool_use_search", "text"]);
    const keys = await seatsKeys();
    const anthropicKeys = new MemoryKeyStore();
    await anthropicKeys.set(ANTHROPIC_KEY);
    const svc = await bootstrap({ keys, anthropicKeys, snapshots: new SnapshotStore(files), now: () => NOW, fetchImpl: seats, anthropicFetch: api.fetchImpl });
    const state = await svc.ask.ask(QUESTION, false);
    return { files, seats, api, keys, anthropicKeys, svc, state };
  }

  it("sends its requests over the Anthropic transport and its search over the observed seats.aero one", async () => {
    const { seats, api, svc, state } = await asked();

    const entry = state.entries[0]!;
    expect(entry.end).toMatchObject({ status: "answered", committed: true });
    expect(entry.steps).toEqual([{ kind: "tool", step: expect.objectContaining({ tool: "search_awards", outcome: "ok", calls: 1 }) }]);

    expect(api.calls.map((c) => [c.method, c.url])).toEqual([
      ["POST", "https://api.anthropic.com/v1/messages"],
      ["POST", "https://api.anthropic.com/v1/messages"],
    ]);
    for (const call of api.calls) {
      expect(call.headers["x-api-key"]).toBe(ANTHROPIC_KEY);
      expect(JSON.stringify(call)).not.toContain(SEATS_KEY);
    }
    expect(seats.calls.map((c) => c.url.pathname)).toEqual(["/partnerapi/search"]);
    expect(seats.calls[0]!.headers["partner-authorization"]).toBe(SEATS_KEY);
    expect(JSON.stringify(seats.calls)).not.toContain(ANTHROPIC_KEY);

    // One client, built for this question, with the key and no baseURL, over the Anthropic transport itself. That
    // identity is what shows no rate-limit observer wraps Anthropic's responses. The quota below could not show it:
    // the observer reads seats.aero URLs only, so it would pass over Anthropic's "5 left" even if it wrapped them.
    expect(vi.mocked(createAskClient).mock.calls).toEqual([[{ apiKey: ANTHROPIC_KEY, fetch: api.fetchImpl }]]);
    // seats.aero's 400 left means 600 spent: the search's response reached the quota through the observed transport.
    expect(await svc.engine.quota.used(LOCAL_USER)).toBe(600);
  });

  it("saves the cache, the quota and ask.json after the tool that spent, and no key in any file", async () => {
    const { files } = await asked();
    expect(files.files.has(CACHE_FILE)).toBe(true);
    expect(files.files.has(QUOTA_FILE)).toBe(true);
    const saved = await new AskStore(files).read();
    expect(saved?.entries[0]?.end?.status).toBe("answered");
    expect(saved?.pending).toBeNull();
    for (const contents of files.files.values()) {
      expect(contents).not.toContain(ANTHROPIC_KEY);
      expect(contents).not.toContain(SEATS_KEY);
    }
  });

  it("AppServices.persist() writes ask.json too", async () => {
    const { files, svc } = await asked();
    const before = files.files.get(ASK_FILE);
    files.files.delete(ASK_FILE);
    await svc.persist();
    expect(files.files.get(ASK_FILE)).toBe(before);
  });

  it("clearCache leaves both keys and ask.json", async () => {
    const { files, keys, anthropicKeys, svc } = await asked();
    const before = files.files.get(ASK_FILE);
    await svc.clearCache();
    expect(files.files.has(CACHE_FILE)).toBe(false);
    expect(files.files.get(ASK_FILE)).toBe(before);
    expect(await keys.get()).toBe(SEATS_KEY);
    expect(await anthropicKeys.get()).toBe(ANTHROPIC_KEY);
  });
});

describe("whenWatchesIdle and lastSearch", () => {
  function watch(): Watch {
    return { id: "w1", name: "HKG to SEA", text: "HKG to SEA next 30 days business", lastCheckedAt: null, baseline: [], dropThresholdPct: 10, enabled: true, createdAt: "2026-09-01T00:00:00.000Z" };
  }

  const turns = async (n = 20) => {
    for (let i = 0; i < n; i++) await new Promise((resolve) => setImmediate(resolve));
  };

  it("resolves at once with no watch run, and only after the run under way when there is one", async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const svc = await bootstrap({ keys: await seatsKeys(), anthropicKeys: watchedKeys(null), snapshots: new SnapshotStore(new MemoryFileStore()), now: () => NOW, fetchImpl: fakeFetch(seatsAero(hold)) });

    let idleBefore = false;
    void svc.whenWatchesIdle().then(() => {
      idleBefore = true;
    });
    await turns(1);
    expect(idleBefore).toBe(true);

    svc.watches.add(watch());
    const run = svc.checkWatches();
    let idle = false;
    void svc.whenWatchesIdle().then(() => {
      idle = true;
    });
    await turns();
    expect(idle).toBe(false);

    release();
    await run;
    await turns();
    expect(idle).toBe(true);
  });

  it("keeps the last search in memory only: nothing is written, and a relaunch has none", async () => {
    const files = new MemoryFileStore();
    const options = { keys: await seatsKeys(), anthropicKeys: watchedKeys(null), snapshots: new SnapshotStore(files), now: () => NOW, fetchImpl: fakeFetch(seatsAero()) };
    const svc = await bootstrap(options);
    const res = await svc.engine.search("HKG to SEA next 30 days business", SEATS_KEY);
    if (!res.ok) throw new Error("the grid search should have succeeded");

    expect(svc.lastSearch.get()).toBeNull();
    svc.lastSearch.set({ text: "HKG to SEA next 30 days business", value: res.value });
    expect(svc.lastSearch.get()?.value.query.origins).toEqual(["HKG"]);

    await svc.persist();
    for (const contents of files.files.values()) expect(contents).not.toContain("HKG to SEA next 30 days business");
    expect((await bootstrap(options)).lastSearch.get()).toBeNull();
  });
});
