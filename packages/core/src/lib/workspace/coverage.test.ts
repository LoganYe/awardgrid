/**
 * T03 — coverage evidence survives the cache (plan 01 T03; acceptance A05).
 *
 * "Complete" is only ever a claim with proof behind it: every pair, day, cabin and program of the scope checked,
 * or explicitly not monitored. A page cap, a quota stop, a legacy cache entry without evidence, or evidence for a
 * different scope never becomes complete — not on the fetch that produced it, not on a later cache hit, and not
 * after a save and reload.
 */
import { describe, expect, it } from "vitest";
import { QueryObject, type QueryObjectInput } from "../query/schema";
import { CACHE_SNAPSHOT_VERSION, InMemoryAvailabilityCache, type CoverageRecord } from "../seatsaero/cache";
import { runFind } from "../seatsaero/find";
import { InMemoryQuotaStore, Quota } from "../seatsaero/quota";
import { RoutesCatalog } from "../seatsaero/routes";
import { fakeFetch, jsonResponse, textResponse } from "../../../test/fixtures/seatsaero/helpers";
import { restoreCoverage, runEvidence } from "./coverage";
import { scopeKey } from "./identity";
import type { CoverageEvidence } from "./types";

it("legacy and wrong-scope evidence stay unknown", () => {
  expect(restoreCoverage(undefined, "scope-a").state).toBe("unknown");
  expect(restoreCoverage({ state: "complete", scopeKey: "scope-b", slices: [] }, "scope-a").state).toBe("unknown");
});
it("a saved page cap is still partial after reload", () => {
  const proof = {
    state: "partial",
    scopeKey: "scope-a",
    slices: [
      {
        origin: "HKG",
        destination: "SEA",
        dateFrom: "2026-10-01",
        dateTo: "2026-10-30",
        cabins: ["J"],
        programs: ["aeroplan"],
        state: "partial",
        reason: "page_cap",
      },
    ],
  };
  expect(restoreCoverage(JSON.parse(JSON.stringify(proof)), "scope-a").state).toBe("partial");
});

// ---- restoreCoverage: never trusts a stored "complete" it cannot re-prove -----------------------------------

const KEY = "fixture-not-a-real-key";
const NOW = new Date("2026-10-18T08:30:00Z");

function query(overrides: Partial<QueryObjectInput> = {}): QueryObject {
  return QueryObject.parse({
    origins: ["HKG"],
    destinations: ["SEA"],
    date_from: "2026-10-01",
    date_to: "2026-10-30",
    cabins: ["J", "F"],
    programs: ["aeroplan"],
    raw_text: "synthetic",
    language: "en",
    ...overrides,
  });
}

function slice(overrides: Record<string, unknown> = {}) {
  return {
    origin: "HKG",
    destination: "SEA",
    dateFrom: "2026-10-01",
    dateTo: "2026-10-30",
    cabins: ["J", "F"],
    programs: ["aeroplan"],
    state: "complete",
    reason: "exhausted",
    ...overrides,
  };
}

describe("restoreCoverage", () => {
  const q = query({ origins: ["HKG", "PVG"] });
  const scope = scopeKey(q);
  const both = [slice(), slice({ origin: "PVG" })];

  it("keeps a complete claim whose slices cover every pair, day, cabin and program of the scope", () => {
    expect(restoreCoverage({ state: "complete", scopeKey: scope, slices: both }, scope).state).toBe("complete");
    // A wider slice (more days, more cabins, every program) also proves it; an explicit unmonitored pair counts.
    const wide = [slice({ dateFrom: "2026-09-01", dateTo: "2026-11-30", cabins: ["J", "F", "W"], programs: null }), slice({ origin: "PVG", state: "unmonitored", reason: "not_monitored" })];
    expect(restoreCoverage({ state: "complete", scopeKey: scope, slices: wide }, scope).state).toBe("complete");
  });

  it.each<[string, unknown[]]>([
    ["a pair with no slice", [slice()]],
    ["a slice short of the dates", [slice({ dateTo: "2026-10-29" }), slice({ origin: "PVG" })]],
    ["a slice missing a cabin", [slice({ cabins: ["J"] }), slice({ origin: "PVG" })]],
    ["a slice for another program", [slice({ programs: ["united"] }), slice({ origin: "PVG" })]],
    ["no slices at all", []],
  ])("does not keep 'complete' with %s", (_why, slices) => {
    expect(restoreCoverage({ state: "complete", scopeKey: scope, slices }, scope).state).toBe("unknown");
  });

  it("derives partial from a partial slice, whatever the stored state says", () => {
    const slices = [slice(), slice({ origin: "PVG", state: "partial", reason: "page_cap" })];
    expect(restoreCoverage({ state: "complete", scopeKey: scope, slices }, scope).state).toBe("partial");
  });

  it("never upgrades a stored partial or unknown, even when its slices look complete", () => {
    expect(restoreCoverage({ state: "partial", scopeKey: scope, slices: both }, scope).state).toBe("partial");
    expect(restoreCoverage({ state: "unknown", scopeKey: scope, slices: both }, scope).state).toBe("unknown");
  });

  it.each<[string, unknown]>([
    ["an impossible date", slice({ dateFrom: "2026-02-30" })],
    ["a reversed range", slice({ dateFrom: "2026-10-30", dateTo: "2026-10-01" })],
    ["an unknown cabin", slice({ cabins: ["X"] })],
    ["no cabins", slice({ cabins: [] })],
    ["an unknown reason", slice({ reason: "because" })],
    ["a state that does not match its reason", slice({ state: "complete", reason: "page_cap" })],
    ["a non-string program", slice({ programs: [1] })],
    ["a missing field", { origin: "HKG" }],
  ])("treats evidence with %s as no evidence", (_why, bad) => {
    expect(restoreCoverage({ state: "complete", scopeKey: scope, slices: [bad, slice({ origin: "PVG" })] }, scope)).toEqual({
      state: "unknown",
      scopeKey: scope,
      slices: [],
    });
  });

  it("cannot prove completeness against a scope key it cannot read", () => {
    expect(restoreCoverage({ state: "complete", scopeKey: "scope-a", slices: [slice()] }, "scope-a").state).toBe("unknown");
  });

  it("returns fresh objects, never the caller's", () => {
    const input = { state: "partial", scopeKey: scope, slices: [slice({ state: "partial", reason: "quota" })] };
    const out = restoreCoverage(input, scope);
    expect(out.slices[0]).not.toBe(input.slices[0]);
    expect(out.slices[0]!.cabins).not.toBe(input.slices[0]!.cabins);
  });
});

describe("runEvidence: what one fetch proves", () => {
  it.each<[string, Array<{ truncated: boolean; skipped: boolean }>, { state: string; reason: string }]>([
    ["every request ran to its end", [{ truncated: false, skipped: false }], { state: "complete", reason: "exhausted" }],
    ["a request hit the page cap", [{ truncated: true, skipped: false }, { truncated: false, skipped: false }], { state: "partial", reason: "page_cap" }],
    ["a request was skipped for quota", [{ truncated: false, skipped: false }, { truncated: false, skipped: true }], { state: "partial", reason: "quota" }],
    ["no request ran", [], { state: "partial", reason: "quota" }],
    ["the API said more but sent an empty page", [{ truncated: false, skipped: false, incomplete: true } as never], { state: "partial", reason: "upstream_error" }],
  ])("%s", (_why, outcomes, expected) => {
    expect(runEvidence(outcomes)).toEqual(expected);
  });

  it("calls a stop set by the day's remaining quota a quota stop, not a page cap", () => {
    expect(runEvidence([{ truncated: true, skipped: false }], { quotaBound: true })).toEqual({ state: "partial", reason: "quota" });
  });
});

// ---- runFind: evidence on the fetch and on every later cache hit --------------------------------------------

function av(id: string, date: string, origin = "HKG", program = "aeroplan") {
  return {
    ID: id,
    Route: { ID: `${program}-${origin}-SEA`, OriginAirport: origin, DestinationAirport: "SEA", Source: program },
    Date: date,
    JAvailable: true,
    JMileageCost: "75000",
    JRemainingSeats: 2,
    Source: program,
    ComputedLastSeen: "2026-10-17T06:00:00Z",
  };
}

function route(origin: string, program = "aeroplan") {
  return { ID: `${program}-${origin}-SEA`, OriginAirport: origin, OriginRegion: "Asia", DestinationAirport: "SEA", DestinationRegion: "North America", Source: program };
}

interface Upstream {
  pages?: unknown[][];
  endless?: boolean;
  routes?: string[];
  status?: number;
}

function harness(up: Upstream = {}) {
  const pages = up.pages ?? [[av("synthetic-1", "2026-10-18")]];
  const fetch = fakeFetch((req, i) => {
    if (up.status) return textResponse("upstream", up.status);
    if (req.url.pathname === "/partnerapi/search") {
      const page = pages[Math.min(i, pages.length - 1)] ?? [];
      return jsonResponse({ data: page, count: page.length, hasMore: up.endless ?? false, cursor: 1_700_000_000 });
    }
    if (req.url.pathname === "/partnerapi/routes") return jsonResponse((up.routes ?? ["HKG"]).map((o) => route(o, req.url.searchParams.get("source") ?? "")));
    return textResponse("nf", 404);
  });
  return {
    fetch,
    quota: new Quota({ store: new InMemoryQuotaStore(), now: () => NOW }),
    cache: new InMemoryAvailabilityCache(),
    routes: new RoutesCatalog(),
  };
}

async function find(h: ReturnType<typeof harness>, q: QueryObject, extra: { maxPages?: number } = {}) {
  return runFind({ query: q, userId: "u", apiKey: KEY, ...h, now: () => NOW, ttlMinutes: 45, ...extra });
}

const states = (c: CoverageEvidence | undefined) => c?.slices.map((s) => `${s.origin}-${s.destination}:${s.state}/${s.reason}`);

describe("runFind coverage evidence", () => {
  it("a fetch that ran to its end is complete, and so is the cache hit that follows", async () => {
    const h = harness();
    const q = query();
    const first = await find(h, q);
    expect(first.coverage).toMatchObject({ state: "complete", scopeKey: scopeKey(q) });
    expect(states(first.coverage)).toEqual(["HKG-SEA:complete/exhausted"]);
    const again = await find(h, q);
    expect(again.served_from_cache).toBe(true);
    expect(again.coverage).toEqual(first.coverage);
  });

  it("a page cap is partial on the fetch and stays partial on a cache hit (never upgraded)", async () => {
    const h = harness({ endless: true, pages: [[av("a", "2026-10-18")], [av("b", "2026-10-19")]] });
    const q = query();
    const first = await find(h, q, { maxPages: 2 });
    expect(first.coverage?.state).toBe("partial");
    expect(states(first.coverage)).toEqual(["HKG-SEA:partial/page_cap"]);
    const again = await find(h, q);
    expect(again.served_from_cache).toBe(true);
    expect(again.coverage?.state).toBe("partial");
    expect(states(again.coverage)).toEqual(["HKG-SEA:partial/page_cap"]);
  });

  it("an empty but finished search is complete; an unmonitored pair is said so; both are complete coverage", async () => {
    const empty = await find(harness({ pages: [[]], routes: ["HKG"] }), query());
    expect(empty.rows).toEqual([]);
    expect(states(empty.coverage)).toEqual(["HKG-SEA:complete/exhausted"]);
    const unmonitored = await find(harness({ pages: [[]], routes: [] }), query());
    expect(unmonitored.unmonitored_pairs.map((p) => p.key)).toEqual(["HKG-SEA"]);
    expect(states(unmonitored.coverage)).toEqual(["HKG-SEA:unmonitored/not_monitored"]);
    expect(unmonitored.coverage?.state).toBe("complete");
  });

  it("a legacy cache entry without evidence is served, but its completeness is unknown", async () => {
    const h = harness();
    const q = query();
    const legacy: CoverageRecord = {
      origin: "HKG",
      dest: "SEA",
      date_from: q.date_from,
      date_to: q.date_to,
      cabins: [...q.cabins],
      programs: ["aeroplan"],
      direct_only: false,
      include_filtered: false,
      min_cabin_pct: 100,
      fetched_at: "2026-10-18T08:00:00.000Z",
    };
    await h.cache.markPairsFetched("u", [legacy]);
    const res = await find(h, q);
    expect(res.served_from_cache).toBe(true);
    expect(res.coverage?.state).toBe("unknown");
    expect(states(res.coverage)).toEqual(["HKG-SEA:unknown/missing_evidence"]);
    expect(h.fetch.calls).toHaveLength(0);
  });

  it("a broader record answers a narrower query with the broader record's evidence", async () => {
    const complete = harness();
    await find(complete, query());
    const narrow = await find(complete, query({ date_from: "2026-10-05", date_to: "2026-10-10", cabins: ["J"] }));
    expect(narrow.served_from_cache).toBe(true);
    expect(narrow.coverage?.state).toBe("complete");

    const capped = harness({ endless: true });
    await find(capped, query(), { maxPages: 1 });
    const narrowCapped = await find(capped, query({ date_from: "2026-10-05", date_to: "2026-10-10" }));
    expect(narrowCapped.served_from_cache).toBe(true);
    expect(narrowCapped.coverage?.state).toBe("partial");
  });

  it("an upstream error fails the run, records nothing, and the next run fetches again", async () => {
    const h = harness({ status: 500 });
    await expect(find(h, query())).rejects.toThrow();
    expect(await h.cache.getCoverage("u", [{ origin: "HKG", dest: "SEA" }])).toEqual([]);
    const healthy = { ...harness(), cache: h.cache };
    const next = await find(healthy, query());
    expect(next.served_from_cache).toBe(false);
    expect(next.coverage?.state).toBe("complete");
  });

  it("evidence survives the in-memory cache's JSON snapshot (the iOS cache.json)", async () => {
    const h = harness({ endless: true });
    await find(h, query(), { maxPages: 1 });
    const reloaded = new InMemoryAvailabilityCache();
    reloaded.restore(JSON.parse(JSON.stringify(h.cache.snapshot())));
    const res = await find({ ...harness(), cache: reloaded }, query());
    expect(res.served_from_cache).toBe(true);
    expect(states(res.coverage)).toEqual(["HKG-SEA:partial/page_cap"]);
  });
});

describe("InMemoryAvailabilityCache.restore isolates damaged entries", () => {
  it("keeps valid rows and records, drops damaged ones, and never throws", async () => {
    const good = { program: "aeroplan", origin: "HKG", dest: "SEA", date: "2026-10-18", cabin: "J", miles: 75000, fees_cents: null, currency: null, seats_left: 0, direct: true, airlines: ["ZZ"], computed_last_seen: "2026-10-17T06:00:00Z", source_id: "s1", booking_url: null, fetched_at: "2026-10-18T08:00:00Z" };
    const record = { origin: "HKG", dest: "SEA", date_from: "2026-10-01", date_to: "2026-10-30", cabins: ["J"], programs: null, direct_only: false, fetched_at: "2026-10-18T08:00:00Z", evidence: { state: "complete", reason: "exhausted" } };
    const snapshot = {
      version: CACHE_SNAPSHOT_VERSION,
      users: [
        {
          userId: "u",
          rows: [good, { ...good, date: "2026-10-19", airlines: null }, { ...good, date: "2026-10-20", miles: "lots" }, null],
          coverage: [record, { ...record, cabins: "J" }, { ...record, origin: "PVG", evidence: { state: "complete", reason: "page_cap" } }, 7],
        },
      ],
    };
    const cache = new InMemoryAvailabilityCache();
    expect(() => cache.restore(snapshot as never)).not.toThrow();
    const rows = (await cache.getRows("u", { origins: ["HKG"], dests: ["SEA"], date_from: "2026-10-01", date_to: "2026-10-30", cabins: ["J"] })).rows;
    expect(rows.map((r) => r.date)).toEqual(["2026-10-18"]);
    const coverage = await cache.getCoverage("u", [{ origin: "HKG", dest: "SEA" }, { origin: "PVG", dest: "SEA" }]);
    expect(coverage.map((c) => c.origin)).toEqual(["HKG", "PVG"]);
    // A record whose evidence is malformed is kept as a record, without the evidence: it proves nothing.
    expect(coverage[0]!.evidence).toEqual({ state: "complete", reason: "exhausted" });
    expect("evidence" in coverage[1]!).toBe(false);
  });
});

describe("runFind evidence when fetches overlap, race or misbehave (in-memory store: iOS, CLI)", () => {
  const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
  const at = (h: ReturnType<typeof harness>, q: QueryObject, when: Date, extra: { maxPages?: number } = {}) =>
    runFind({ query: q, userId: "u", apiKey: KEY, ...h, now: () => when, ttlMinutes: 45, ...extra });

  /** Upstream that answers the first search in full and every later one capped (hasMore with one page). */
  function completeThenCapped() {
    let searches = 0;
    const fetch = fakeFetch((req) => {
      if (req.url.pathname === "/partnerapi/routes") return jsonResponse([route("HKG", req.url.searchParams.get("source") ?? "")]);
      if (req.url.pathname !== "/partnerapi/search") return textResponse("nf", 404);
      searches += 1;
      const direct = (a: Record<string, unknown>) => ({ ...a, JDirect: true });
      return searches === 1
        ? jsonResponse({ data: [direct(av("a", "2026-10-18")), direct(av("b", "2026-10-19")), direct(av("c", "2026-10-20", "HKG", "united"))], hasMore: false })
        : jsonResponse({ data: [direct(av("a", "2026-10-18"))], hasMore: true, cursor: 1 });
    });
    return { ...harness(), fetch };
  }

  it.each<[string, Partial<QueryObjectInput>, Partial<QueryObjectInput>]>([
    ["S1 wider dates", {}, { date_to: "2026-11-30" }],
    ["S2 more origins", {}, { origins: ["HKG", "PVG"] }],
    ["S3 all programs, then one program over wider dates", { programs: undefined }, { programs: ["aeroplan"], date_from: "2026-09-25" }],
    ["S4 direct only, wider dates", {}, { direct_only: true, date_to: "2026-11-30" }],
  ])("%s: a later capped overlapping fetch makes the earlier complete scope partial", async (_why, first, second) => {
    const h = completeThenCapped();
    const q = query(first);
    expect((await at(h, q, NOW)).coverage?.state).toBe("complete");
    await at(h, query({ ...first, ...second }), later(1), { maxPages: 1 });
    const again = await at(h, q, later(2));
    expect(again.served_from_cache).toBe(true);
    expect(again.coverage?.state).toBe("partial");
  });

  it("a later complete fetch over the same scope restores 'complete' (the partial was superseded)", async () => {
    const h = completeThenCapped();
    await at(h, query(), NOW);
    await at(h, query({ date_to: "2026-11-30" }), later(1), { maxPages: 1 });
    // A fresh full fetch of the original scope after the capped one.
    const full = { ...harness(), cache: h.cache };
    await at(full, query({ date_from: "2026-09-30" }), later(2));
    const again = await at(full, query(), later(3));
    expect(again.served_from_cache).toBe(true);
    expect(again.coverage?.state).toBe("complete");
  });

  it("race: a capped run that STARTED earlier but wrote later downgrades a newer complete one", async () => {
    const h = completeThenCapped();
    // Simulate write order directly: the newer complete record first, then the older capped run's record.
    const q = query();
    await h.cache.markPairsFetched("u", [
      { origin: "HKG", dest: "SEA", date_from: q.date_from, date_to: q.date_to, cabins: ["J", "F"], programs: ["aeroplan"], direct_only: false, fetched_at: "2026-10-18T08:05:00.000Z", evidence: { state: "complete", reason: "exhausted" } },
      { origin: "HKG", dest: "SEA", date_from: q.date_from, date_to: "2026-11-30", cabins: ["J", "F"], programs: ["aeroplan"], direct_only: false, fetched_at: "2026-10-18T08:00:00.000Z", evidence: { state: "partial", reason: "page_cap" } },
    ]);
    const res = await at(h, q, later(1));
    expect(res.served_from_cache).toBe(true);
    expect(res.coverage?.state).toBe("partial");
  });

  it("a later overlapping record with no evidence (an older writer) makes it unknown, not complete", async () => {
    const h = completeThenCapped();
    const q = query();
    await at(h, q, NOW);
    await h.cache.markPairsFetched("u", [{ origin: "HKG", dest: "SEA", date_from: "2026-10-10", date_to: "2026-10-12", cabins: ["J"], programs: null, direct_only: false, fetched_at: later(1).toISOString() }]);
    const res = await at(h, q, later(2));
    expect(res.coverage?.state).toBe("unknown");
  });

  it("a 429 fails the run before any write", async () => {
    const h = harness({ status: 429 });
    await expect(find(h, query())).rejects.toThrow();
    expect(await h.cache.getCoverage("u", [{ origin: "HKG", dest: "SEA" }])).toEqual([]);
  });

  it("a page budget set by the day's remaining quota is reported as a quota stop", async () => {
    const h = harness({ endless: true });
    const tight = { ...h, quota: new Quota({ store: new InMemoryQuotaStore(), now: () => NOW, softLimit: 2 }) };
    const res = await find(tight, query());
    expect(states(res.coverage)).toEqual(["HKG-SEA:partial/quota"]);
  });

  it("an empty page that still says hasMore is not the end: partial, upstream_error", async () => {
    const h = harness({ endless: true, pages: [[av("a", "2026-10-18")], []] });
    const res = await find(h, query());
    expect(states(res.coverage)).toEqual(["HKG-SEA:partial/upstream_error"]);
  });

  it("uses the store's atomic replace when it has one", async () => {
    const h = harness();
    const calls: string[] = [];
    const cache = h.cache;
    const spy = Object.assign(Object.create(Object.getPrototypeOf(cache)), cache);
    for (const m of ["deleteRows", "putRows", "markPairsFetched", "replaceScope", "getCoverage", "getRows"] as const) {
      const original = (cache[m] as (...a: unknown[]) => unknown).bind(cache);
      spy[m] = (...args: unknown[]) => {
        calls.push(m);
        return original(...args);
      };
    }
    await find({ ...h, cache: spy }, query());
    expect(calls).toContain("replaceScope");
    expect(calls).not.toContain("deleteRows");
  });
});

describe("restore drops a coverage record with junk dates", () => {
  it("a record whose dates are not real calendar days, or whose fetch time is not an instant, is dropped", async () => {
    const base = { origin: "HKG", dest: "SEA", date_from: "2026-10-01", date_to: "2026-10-30", cabins: ["J"], programs: null, direct_only: false, fetched_at: "2026-10-18T08:00:00.000Z", evidence: { state: "complete", reason: "exhausted" } };
    const cache = new InMemoryAvailabilityCache();
    cache.restore({
      version: CACHE_SNAPSHOT_VERSION,
      users: [{ userId: "u", rows: [], coverage: [{ ...base, date_from: "", date_to: "~" }, { ...base, date_to: "2026-02-30" }, { ...base, date_from: "2026-10-30", date_to: "2026-10-01" }, { ...base, fetched_at: "yesterday" }, base] }],
    } as never);
    const recs = await cache.getCoverage("u", [{ origin: "HKG", dest: "SEA" }]);
    expect(recs).toHaveLength(1);
    expect(recs[0]!.date_to).toBe("2026-10-30");
  });
});

