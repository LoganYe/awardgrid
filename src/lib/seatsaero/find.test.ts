import { describe, expect, it } from "vitest";
import { QueryObject, type QueryObjectInput } from "@/lib/query/schema";
import { SeatsAeroClient, SeatsAeroHttpError } from "@/lib/seatsaero/client";
import { InMemoryAvailabilityCache } from "@/lib/seatsaero/cache";
import { ASSUMED_ROUTES_PER_PROGRAM, ROW_DENSITY, planFind, runFind } from "@/lib/seatsaero/find";
import { InMemoryQuotaStore, Quota, QuotaExceededError } from "@/lib/seatsaero/quota";
import { RoutesCatalog } from "@/lib/seatsaero/routes";
import { SEATS_SOURCES, SearchResponse, type Route } from "@/lib/seatsaero/types";
import { fakeFetch, jsonResponse, loadFixture, textResponse } from "../../../test/fixtures/seatsaero/helpers";
import {
  SYNTHETIC_ORIGINS,
  SYNTHETIC_PROGRAMS,
  generateSynthetic,
} from "../../../test/fixtures/seatsaero/generate-synthetic";

const KEY = "pro_key_for_find_tests_SECRET";
const NOW = new Date("2026-10-01T12:00:00Z");

function query(overrides: Partial<QueryObjectInput> = {}): QueryObject {
  return QueryObject.parse({
    origins: [...SYNTHETIC_ORIGINS],
    destinations: ["SEA"],
    date_from: "2026-10-01",
    date_to: "2026-10-30",
    cabins: ["J", "F"],
    raw_text: "test",
    language: "en",
    ...overrides,
  });
}

/** Routes per program derived from the synthetic fixture (GMP is monitored by nobody). */
function syntheticRoutes(source: string): Route[] {
  return SYNTHETIC_ORIGINS.filter((o) => o !== "GMP").map((o) => ({
    ID: `${source}-${o}`,
    OriginAirport: o,
    OriginRegion: "Asia",
    DestinationAirport: "SEA",
    DestinationRegion: "North America",
    NumDaysOut: 330,
    Distance: 5000,
    Source: source,
  }));
}

describe("planFind", () => {
  it("chooses one Cached Search page by default with the documented parameters", () => {
    const plan = planFind(query());
    expect(plan.mode).toBe("cached");
    expect(plan.pairs).toHaveLength(7);
    expect(plan.days).toBe(30);
    // 7 pairs × 30 days × 26 programs × 2 cabins × 0.15 = 1638 rows → 2 pages
    expect(plan.expected_rows).toBe(Math.round(7 * 30 * SEATS_SOURCES.length * 2 * ROW_DENSITY));
    expect(plan.cached_calls).toBe(2);
    expect(plan.estimated_calls).toBe(2);
    expect(plan.bulk_calls).toBeNull();
    expect(plan.requests).toHaveLength(1);
    const req = plan.requests[0]!;
    expect(req.kind).toBe("search");
    if (req.kind === "search") {
      expect(req.params).toEqual({
        origin_airport: [...SYNTHETIC_ORIGINS],
        destination_airport: ["SEA"],
        start_date: "2026-10-01",
        end_date: "2026-10-30",
        take: 1000,
        order_by: "lowest_mileage",
        cabins: ["business", "first"],
      });
    }
  });

  it("passes sources and only_direct_flights when the query asks for them", () => {
    const plan = planFind(query({ programs: ["american", "alaska"], direct_only: true, cabins: ["J"] }));
    expect(plan.mode).toBe("cached");
    const req = plan.requests[0]!;
    if (req.kind === "search") {
      expect(req.params.sources).toEqual(["american", "alaska"]);
      expect(req.params.only_direct_flights).toBe(true);
      expect(req.params.cabins).toEqual(["business"]);
    }
    // bulk without a catalog assumes the whole program (2,700 routes) → far more pages than cached
    expect(plan.bulk_calls).toBe(2 * Math.ceil((ASSUMED_ROUTES_PER_PROGRAM * 30 * 1 * ROW_DENSITY) / 1000));
    expect(plan.bulk_calls!).toBeGreaterThan(plan.cached_calls);
  });

  it("forwards include_filtered (the §4.3 UI toggle) to Cached Search and Bulk Availability", () => {
    const off = planFind(query());
    expect(off.requests[0]!.params.include_filtered).toBeUndefined();
    const on = planFind(query({ include_filtered: true, programs: ["alaska"] }));
    expect(on.requests[0]!.params.include_filtered).toBe(true);
    // A wide query where the region-sliced bulk pull (1 page) beats cached (2 pages).
    const wide = query({
      include_filtered: true,
      programs: ["alaska"],
      date_to: "2026-12-31",
      destinations: ["SEA", "SFO", "LAX", "PDX", "SAN", "LAS", "PHX", "DEN"],
    });
    const bulk = planFind(wide, { routesKnown: { routesFor: () => syntheticRoutes("alaska") } });
    expect(bulk.mode).toBe("bulk");
    expect(bulk.requests[0]!.params.include_filtered).toBe(true);
  });

  it("chooses Bulk Availability when programs are named, the catalog is known, and it is cheaper", () => {
    // 20 × 20 pairs over 92 days in J: cached ≈ 400×92×1×1×0.15 = 5520 rows → 6 pages.
    const origins = Array.from({ length: 20 }, (_, i) => `A${String(i).padStart(2, "0")}`.slice(0, 3).toUpperCase());
    const dests = Array.from({ length: 20 }, (_, i) => `B${String(i).padStart(2, "0")}`.slice(0, 3).toUpperCase());
    const q = QueryObject.parse({
      origins: origins.map((o) => o.replace(/\d/g, (d) => "ABCDEFGHIJ"[Number(d)]!)),
      destinations: dests.map((o) => o.replace(/\d/g, (d) => "ABCDEFGHIJ"[Number(d)]!)),
      date_from: "2026-10-01",
      date_to: "2026-12-31",
      cabins: ["J"],
      programs: ["united"],
      raw_text: "",
      language: "en",
    });
    // The catalog says united monitors only 30 Asia → North America routes among these airports.
    const routes: Route[] = q.origins.slice(0, 5).flatMap((o) =>
      q.destinations.slice(0, 6).map((d) => ({
        ID: `${o}${d}`, OriginAirport: o, OriginRegion: "Asia", DestinationAirport: d, DestinationRegion: "North America",
        NumDaysOut: 300, Distance: 5000, Source: "united",
      })),
    );
    const plan = planFind(q, { routesKnown: { routesFor: (s) => (s === "united" ? routes : undefined) } });
    expect(plan.cached_calls).toBe(6);
    expect(plan.bulk_calls).toBe(1);
    expect(plan.mode).toBe("bulk");
    expect(plan.estimated_calls).toBe(1);
    const req = plan.requests[0]!;
    expect(req.kind).toBe("availability");
    if (req.kind === "availability") {
      expect(req.params).toEqual({
        source: "united",
        start_date: "2026-10-01",
        end_date: "2026-12-31",
        take: 1000,
        cabin: "business",
        origin_region: "Asia",
        destination_region: "North America",
      });
    }
    // Same query without the catalog: bulk is not cheaper → cached.
    expect(planFind(q).mode).toBe("cached");
  });
});

describe("runFind (end to end over the synthetic fixture, no network)", () => {
  const synthetic = generateSynthetic();

  /** Mirrors the documented `only_direct_flights` semantics: keep objects with a direct flight. */
  function directOnly(fixture: typeof synthetic): typeof synthetic {
    const data = fixture.data.filter((a) => a.YDirect === true || a.WDirect === true || a.JDirect === true || a.FDirect === true);
    return { ...fixture, data, count: data.length };
  }

  function harness() {
    const fetch = fakeFetch((req) => {
      if (req.url.pathname === "/partnerapi/search") {
        const direct = req.url.searchParams.get("only_direct_flights") === "true";
        return jsonResponse(direct ? directOnly(synthetic) : synthetic);
      }
      if (req.url.pathname === "/partnerapi/routes") return jsonResponse(syntheticRoutes(req.url.searchParams.get("source")!));
      return textResponse("not found", 404);
    });
    const quotaStore = new InMemoryQuotaStore();
    const quota = new Quota({ store: quotaStore, now: () => NOW });
    const cache = new InMemoryAvailabilityCache();
    const routes = new RoutesCatalog({ now: () => NOW });
    return { fetch, quota, quotaStore, cache, routes };
  }

  it("the committed synthetic fixture is deterministic and parses as a SearchResponse", () => {
    const onDisk = loadFixture<{ _synthetic: boolean; _derived_from: string; data: unknown[] }>("synthetic-example-query.json");
    expect(onDisk._synthetic).toBe(true);
    expect(onDisk._derived_from).toBe("official cached-search example shape");
    expect(onDisk).toEqual(JSON.parse(JSON.stringify(synthetic)));
    expect(SearchResponse.safeParse(onDisk).success).toBe(true);
    expect(synthetic.data.some((a) => a.FAvailable === null)).toBe(true);
  });

  it("first run spends calls, caches rows + coverage, reports unmonitored pairs; second run is free", async () => {
    const h = harness();
    const q = query({ programs: [...SYNTHETIC_PROGRAMS] });
    const first = await runFind({ query: q, userId: "alice", apiKey: KEY, ...h, now: () => NOW });

    expect(first.served_from_cache).toBe(false);
    expect(first.plan?.mode).toBe("cached");
    // 1 search page + 6 Get Routes calls (GMP→SEA came back empty)
    expect(first.api_calls_used).toBe(1 + SYNTHETIC_PROGRAMS.length);
    expect(h.fetch.calls).toHaveLength(7);
    expect(await h.quota.used("alice")).toBe(7);
    expect(first.unmonitored_pairs).toEqual([{ origin: "GMP", dest: "SEA", key: "GMP-SEA" }]);
    expect(first.warnings).toEqual([]);
    expect(first.rows.length).toBeGreaterThan(200);
    expect(first.rows.every((r) => r.cabin === "J" || r.cabin === "F")).toBe(true);
    expect(first.rows.every((r) => r.fetched_at === NOW.toISOString())).toBe(true);
    expect(first.rows.every((r) => r.date >= "2026-10-01" && r.date <= "2026-10-30")).toBe(true);
    const search = h.fetch.calls[0]!.url;
    expect(search.searchParams.get("origin_airport")).toBe(SYNTHETIC_ORIGINS.join(","));
    expect(search.searchParams.get("cabins")).toBe("business,first");
    expect(search.searchParams.get("sources")).toBe(SYNTHETIC_PROGRAMS.join(","));

    const second = await runFind({ query: q, userId: "alice", apiKey: KEY, ...h, now: () => new Date(NOW.getTime() + 30 * 60_000) });
    expect(second.served_from_cache).toBe(true);
    expect(second.api_calls_used).toBe(0);
    expect(h.fetch.calls).toHaveLength(7);
    expect(second.rows).toHaveLength(first.rows.length);
    expect(second.unmonitored_pairs).toEqual(first.unmonitored_pairs);
    expect(second.fetched_at_min).toBe(NOW.toISOString());

    // A narrower query (subset of dates/cabins) is covered too.
    const narrower = await runFind({ query: query({ programs: ["american"], cabins: ["J"], date_to: "2026-10-10" }), userId: "alice", apiKey: KEY, ...h, now: () => NOW });
    expect(narrower.served_from_cache).toBe(true);
    expect(narrower.rows.every((r) => r.program === "american" && r.cabin === "J" && r.date <= "2026-10-10")).toBe(true);

    // Past the TTL the search runs again (routes are still cached for 7 days → 1 call).
    const third = await runFind({ query: q, userId: "alice", apiKey: KEY, ...h, now: () => new Date(NOW.getTime() + 46 * 60_000) });
    expect(third.served_from_cache).toBe(false);
    expect(third.api_calls_used).toBe(1);

    // Bob shares nothing with alice: his run pays again, and every one of his requests goes
    // out under HIS key — never alice's (§0.2 #2).
    const before = h.fetch.calls.length;
    const bob = await runFind({ query: q, userId: "bob", apiKey: "bobs_own_key", ...h, now: () => NOW });
    expect(bob.served_from_cache).toBe(false);
    expect(await h.quota.used("bob")).toBe(bob.api_calls_used);
    const bobsCalls = h.fetch.calls.slice(before);
    expect(bobsCalls.length).toBe(bob.api_calls_used);
    expect(bobsCalls.every((c) => c.headers["partner-authorization"] === "bobs_own_key")).toBe(true);
    expect(h.fetch.calls.slice(0, before).every((c) => c.headers["partner-authorization"] === KEY)).toBe(true);
  });

  it("runFind has no injectable client: the only way in is the caller's own key", () => {
    // Type-level guard: a `client` option would let a caller route one user's search through
    // another user's key. If this line ever compiles, that door has been reopened.
    const opts = { query: query(), userId: "x", apiKey: KEY, quota: harness().quota, cache: harness().cache };
    // @ts-expect-error — RunFindOptions must not accept a prebuilt client
    const withClient: Parameters<typeof runFind>[0] = { ...opts, client: new SeatsAeroClient({ apiKey: "other" }) };
    expect(withClient).toBeDefined();
  });

  it("caches an empty result via coverage", async () => {
    const h = harness();
    const q = query({ origins: ["GMP"], programs: ["alaska"] });
    const first = await runFind({ query: q, userId: "u", apiKey: KEY, ...h, now: () => NOW });
    expect(first.rows).toEqual([]);
    expect(first.api_calls_used).toBe(2); // search + alaska routes
    expect(first.unmonitored_pairs).toEqual([{ origin: "GMP", dest: "SEA", key: "GMP-SEA" }]);
    const again = await runFind({ query: q, userId: "u", apiKey: KEY, ...h, now: () => NOW });
    expect(again.served_from_cache).toBe(true);
    expect(again.api_calls_used).toBe(0);
    expect(again.unmonitored_pairs).toEqual(first.unmonitored_pairs);
    expect(h.fetch.calls).toHaveLength(2);
  });

  it("direct_only: sends only_direct_flights=true, records subset coverage, and filters locally", async () => {
    const h = harness();
    const searches = () => h.fetch.calls.filter((c) => c.url.pathname === "/partnerapi/search");
    const programs = [...SYNTHETIC_PROGRAMS];

    // 1. A direct-only query goes upstream with the documented flag.
    const direct = await runFind({ query: query({ direct_only: true, programs }), userId: "d", apiKey: KEY, ...h, now: () => NOW });
    expect(direct.served_from_cache).toBe(false);
    expect(direct.rows.length).toBeGreaterThan(0);
    expect(direct.rows.every((r) => r.direct)).toBe(true);
    expect(searches()).toHaveLength(1);
    expect(searches()[0]!.url.searchParams.get("only_direct_flights")).toBe("true");
    // 1 search + 6 Get Routes (GMP→SEA is empty) — nothing borrowed from user "u" above.
    expect(direct.api_calls_used).toBe(1 + programs.length);

    // 2. A direct-only fetch is a subset: it never satisfies an all-flights query.
    const all = await runFind({ query: query({ programs }), userId: "d", apiKey: KEY, ...h, now: () => NOW });
    expect(all.served_from_cache).toBe(false);
    expect(searches()).toHaveLength(2);
    expect(searches()[1]!.url.searchParams.has("only_direct_flights")).toBe(false);
    expect(all.rows.length).toBeGreaterThan(direct.rows.length);
    expect(all.rows.some((r) => !r.direct)).toBe(true);

    // 3. An all-flights fetch is a superset: a direct-only query is now served from cache,
    //    filtered locally, with exactly the rows the upstream filter produced.
    const again = await runFind({ query: query({ direct_only: true, programs }), userId: "d", apiKey: KEY, ...h, now: () => NOW });
    expect(again.served_from_cache).toBe(true);
    expect(again.api_calls_used).toBe(0);
    expect(again.rows.every((r) => r.direct)).toBe(true);
    expect(again.rows).toHaveLength(direct.rows.length);
    expect(searches()).toHaveLength(2);
  });

  it("include_filtered: sends the documented flag and never shares cache with the default scope", async () => {
    const h = harness();
    const searches = () => h.fetch.calls.filter((c) => c.url.pathname === "/partnerapi/search");
    const programs = [...SYNTHETIC_PROGRAMS];
    const plain = await runFind({ query: query({ programs }), userId: "f", apiKey: KEY, ...h, now: () => NOW });
    expect(searches()[0]!.url.searchParams.has("include_filtered")).toBe(false);
    expect(plain.rows.every((r) => r.include_filtered === undefined)).toBe(true);

    const filtered = await runFind({ query: query({ programs, include_filtered: true }), userId: "f", apiKey: KEY, ...h, now: () => NOW });
    expect(filtered.served_from_cache).toBe(false);
    expect(searches()).toHaveLength(2);
    expect(searches()[1]!.url.searchParams.get("include_filtered")).toBe("true");
    expect(filtered.rows.length).toBe(plain.rows.length);
    expect(filtered.rows.every((r) => r.include_filtered === true)).toBe(true);

    // Both scopes are now cached independently; neither refetches, neither leaks into the other.
    const plainAgain = await runFind({ query: query({ programs }), userId: "f", apiKey: KEY, ...h, now: () => NOW });
    const filteredAgain = await runFind({ query: query({ programs, include_filtered: true }), userId: "f", apiKey: KEY, ...h, now: () => NOW });
    expect(plainAgain.served_from_cache).toBe(true);
    expect(filteredAgain.served_from_cache).toBe(true);
    expect(plainAgain.rows.every((r) => r.include_filtered === undefined)).toBe(true);
    expect(filteredAgain.rows.every((r) => r.include_filtered === true)).toBe(true);
    expect(searches()).toHaveLength(2);
  });

  it("a direct-only fetch does not evict the all-flights rows cached for the same scope", async () => {
    const h = harness();
    const programs = [...SYNTHETIC_PROGRAMS];
    const all = await runFind({ query: query({ programs }), userId: "e", apiKey: KEY, ...h, now: () => NOW });
    // A wider date range is not covered, so this direct-only query really goes upstream
    // (a narrower one would be served from the all-flights coverage instead).
    const wider = query({ programs, direct_only: true, date_to: "2026-10-31" });
    const direct = await runFind({ query: wider, userId: "e", apiKey: KEY, ...h, now: () => NOW });
    expect(direct.served_from_cache).toBe(false);
    expect(direct.rows.length).toBeLessThan(all.rows.length);
    // The all-flights rows fetched first are still there and still served without a call.
    const allAgain = await runFind({ query: query({ programs }), userId: "e", apiKey: KEY, ...h, now: () => NOW });
    expect(allAgain.served_from_cache).toBe(true);
    expect(allAgain.rows).toHaveLength(all.rows.length);
    expect(allAgain.rows.some((r) => !r.direct)).toBe(true);
  });

  it("caps pages per run (cursor + skip forwarded), warns, and still caches what it got", async () => {
    const endless = { ...synthetic, hasMore: true };
    const fetch = fakeFetch((req) => (req.url.pathname === "/partnerapi/search" ? jsonResponse(endless) : textResponse("nf", 404)));
    const quota = new Quota({ store: new InMemoryQuotaStore(), now: () => NOW });
    const cache = new InMemoryAvailabilityCache();
    const q = query({ origins: ["HKG"], programs: ["alaska"] });
    const res = await runFind({ query: q, userId: "p", apiKey: KEY, fetch, quota, cache, now: () => NOW, maxPages: 3 });
    expect(res.api_calls_used).toBe(3);
    expect(await quota.used("p")).toBe(3);
    expect(res.warnings).toEqual([expect.stringMatching(/stopped after 3 page\(s\) of Cached Search/)]);
    const params = fetch.calls.map((c) => c.url.searchParams);
    expect(params[0]!.get("cursor")).toBeNull();
    expect(params[0]!.get("skip")).toBeNull();
    expect(params[1]!.get("cursor")).toBe(String(synthetic.cursor));
    expect(params[1]!.get("skip")).toBe(String(synthetic.count));
    expect(params[2]!.get("skip")).toBe(String(2 * synthetic.count));
    expect(params.every((p) => p.get("take") === "1000")).toBe(true);
    expect(res.rows.length).toBeGreaterThan(0);
    // The partial result is cached like any other and served on the next call.
    const again = await runFind({ query: q, userId: "p", apiKey: KEY, fetch, quota, cache, now: () => NOW });
    expect(again.served_from_cache).toBe(true);
    expect(again.rows).toHaveLength(res.rows.length);
  });

  it("refuses to start when the quota store reports 950 used, without any HTTP call", async () => {
    const h = harness();
    await h.quotaStore.increment("alice", "2026-10-01", 950);
    const err = await runFind({ query: query(), userId: "alice", apiKey: KEY, ...h, now: () => NOW }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(QuotaExceededError);
    expect((err as Error).message).toMatch(/0 calls left.*2026-10-02T00:00:00.000Z/);
    expect(h.fetch.calls).toHaveLength(0);
  });

  it("two overlapping runs for one user share the soft-limit headroom instead of each spending it", async () => {
    // 5 calls left; an endless search would spend all 5 per run. Without atomic reservation both
    // runs read `remaining = 5`, spend 5 pages each, and the day ends at 955 > 950.
    const endless = { ...synthetic, hasMore: true };
    const fetch = fakeFetch((req) => (req.url.pathname === "/partnerapi/search" ? jsonResponse(endless) : textResponse("nf", 404)));
    const store = new InMemoryQuotaStore();
    await store.increment("u", "2026-10-01", 945);
    const quota = new Quota({ store, now: () => NOW });
    const cache = new InMemoryAvailabilityCache();
    const q = query({ origins: ["HKG"], programs: ["alaska"] });
    const run = () => runFind({ query: q, userId: "u", apiKey: KEY, fetch, quota, cache, now: () => NOW });
    const results = await Promise.allSettled([run(), run()]);
    const ok = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof runFind>>> => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.reason).toBeInstanceOf(QuotaExceededError);
    expect(ok[0]!.value.api_calls_used).toBe(5);
    expect(fetch.calls).toHaveLength(5);
    expect(await quota.used("u")).toBe(950);
  });

  it("refunds the unused reservation so a short run leaves the quota exactly as spent", async () => {
    const h = harness();
    const res = await runFind({ query: query({ origins: ["HKG"], programs: ["alaska"] }), userId: "r", apiKey: KEY, ...h, now: () => NOW });
    expect(res.api_calls_used).toBe(1); // one page, no empty pair
    expect(await h.quota.used("r")).toBe(1);
    expect(await h.quota.remaining("r")).toBe(949);
  });

  it("skips route lookups it cannot afford and says so in warnings", async () => {
    const h = harness();
    await h.quotaStore.increment("alice", "2026-10-01", 946); // 4 left: 1 search + 3 routes
    const res = await runFind({ query: query({ programs: [...SYNTHETIC_PROGRAMS] }), userId: "alice", apiKey: KEY, ...h, now: () => NOW });
    expect(res.api_calls_used).toBe(4);
    expect(res.unmonitored_pairs).toEqual([]);
    expect(res.warnings[0]).toMatch(/skipped to stay within today's quota/);
    expect(await h.quota.used("alice")).toBe(950);
  });

  it("counts failed calls against the quota and never leaks the key", async () => {
    const fetch = fakeFetch(() => textResponse(`bad key ${KEY}`, 401));
    const quota = new Quota({ store: new InMemoryQuotaStore(), now: () => NOW });
    const err = await runFind({
      query: query(),
      userId: "alice",
      apiKey: KEY,
      fetch,
      quota,
      cache: new InMemoryAvailabilityCache(),
      now: () => NOW,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SeatsAeroHttpError);
    expect((err as SeatsAeroHttpError).kind).toBe("invalid_key");
    expect(String(err)).not.toContain(KEY);
    expect(JSON.stringify(err)).not.toContain(KEY);
    expect(await quota.used("alice")).toBe(1);
    expect(fetch.calls[0]!.headers["partner-authorization"]).toBe(KEY);
  });

  it("requires the calling user's key — there is no default", async () => {
    const h = harness();
    await expect(runFind({ query: query(), userId: "alice", apiKey: "", ...h })).rejects.toThrow(/API key/);
    expect(h.fetch.calls).toHaveLength(0);
  });
});
