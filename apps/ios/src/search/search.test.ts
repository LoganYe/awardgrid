/**
 * The whole client pipeline, end to end, with no device and no network: free text → deterministic
 * parse → runFind → grid, plus the failure mapping every empty state branches on.
 *
 * The fixtures come from `@awardgrid/core/test-fixtures/*`, which Phase 1 exposed as a package
 * subpath precisely so a shell could test against the same recorded seats.aero payloads the core
 * does. Nothing here reaches the network, and TZ is pinned by vitest.config.ts, so no assertion
 * depends on what time it runs.
 */
import { describe, expect, it } from "vitest";
import { fakeFetch, jsonResponse, textResponse } from "@awardgrid/core/test-fixtures/seatsaero/helpers";
import { Quota } from "@awardgrid/core/seatsaero/quota";
import { RoutesCatalog } from "@awardgrid/core/seatsaero/routes";
import { DeviceQuotaStore } from "../store/quota-store";
import { LOCAL_USER, SearchEngine } from "./search";

const NOW = new Date("2026-10-01T00:00:00.000Z");
const KEY = "pro_test_key_ABC123xyz_DO_NOT_LEAK";

/** One availability row shaped like the API's, for a date inside the parsed window. */
function availability(date: string) {
  return {
    ID: `id-${date}`,
    RouteID: "r1",
    Route: { ID: "r1", OriginAirport: "HKG", DestinationAirport: "SEA", Source: "alaska" },
    Date: date,
    ParsedDate: `${date}T00:00:00Z`,
    Source: "alaska",
    JAvailable: true,
    JMileageCost: "80000",
    JRemainingSeats: 2,
    JAirlines: "AS",
    JDirect: true,
    YAvailable: false,
    WAvailable: false,
    FAvailable: false,
  };
}

/**
 * A fake seats.aero. It dispatches on the path because the endpoints have DIFFERENT response
 * shapes: Cached Search returns `{data, hasMore, cursor}` while Get Routes returns a BARE ARRAY
 * (`RoutesResponse = z.array(Route)`). A fake that answers both with an envelope makes runFind's
 * unmonitored-pair detection fail schema validation, which surfaces as a confusing
 * "seats.aero returned an error (response)" rather than as the fixture bug it is.
 */
function fakeSeatsAero(searchBody: unknown) {
  return fakeFetch((req) => (req.url.pathname.endsWith("/routes") ? jsonResponse([]) : jsonResponse(searchBody)));
}

/** Get Routes for one program, monitoring each origin to SEA. A bare array, as the real endpoint sends. */
function monitoredRoutes(source: string, origins: readonly string[]) {
  return origins.map((origin) => ({
    ID: `${source}-${origin}`,
    OriginAirport: origin,
    OriginRegion: "Asia",
    DestinationAirport: "SEA",
    DestinationRegion: "North America",
    NumDaysOut: 330,
    Distance: 5000,
    Source: source,
  }));
}

function engine(fetchImpl: typeof fetch, store = new DeviceQuotaStore()) {
  return new SearchEngine({
    fetchImpl,
    quota: new Quota({ store, now: () => NOW }),
    now: () => NOW,
  });
}

describe("SearchEngine", () => {
  it("turns free text into a rendered grid over the injected fetch", async () => {
    const fetchImpl = fakeSeatsAero({ data: [availability("2026-10-05")], hasMore: false });
    const res = await engine(fetchImpl).search("HKG to SEA next 30 days business", KEY);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.grid).toBeTruthy();
    expect(res.value.query.origins).toContain("HKG");
    expect(res.value.query.destinations).toContain("SEA");
    expect(res.value.api_calls_used).toBeGreaterThan(0);
    // The key travels only in the documented header, and only to seats.aero.
    expect(fetchImpl.calls[0]!.headers["partner-authorization"]).toBe(KEY);
    expect(fetchImpl.calls[0]!.url.origin).toBe("https://seats.aero");
  });

  it("needs no Anthropic key: the grid lane is deterministic-only (PIVOT §3)", async () => {
    const fetchImpl = fakeSeatsAero({ data: [], hasMore: false });
    // No llmClient is wired anywhere in SearchEngine; a resolvable query must still parse.
    const res = await engine(fetchImpl).search("HKG to SEA next 30 days business", KEY);
    expect(res.ok).toBe(true);
  });

  it("returns no_key as a VALUE rather than throwing when the key is absent", async () => {
    const res = await engine(fakeSeatsAero({ data: [], hasMore: false })).search("HKG to SEA", null);
    expect(res).toMatchObject({ ok: false, error: "no_key" });
  });

  it("maps a seats.aero 401 to no_key, because for this app a rejected key IS the problem", async () => {
    const fetchImpl = fakeFetch(() => textResponse("unauthorized", 401));
    const res = await engine(fetchImpl).search("HKG to SEA next 30 days business", KEY);
    expect(res).toMatchObject({ ok: false, error: "no_key" });
    if (!res.ok) expect(res.message).toBe("seats.aero did not accept the API key. Check it in Settings.");
  });

  it("maps a seats.aero 500 to seatsaero, not to no_key", async () => {
    const fetchImpl = fakeFetch(() => textResponse("boom", 500));
    const res = await engine(fetchImpl).search("HKG to SEA next 30 days business", KEY);
    expect(res).toMatchObject({ ok: false, error: "seatsaero", kind: "http_500" });
  });

  it("maps a malformed body to seatsaero/response rather than crashing the screen", async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ nonsense: true }));
    const res = await engine(fetchImpl).search("HKG to SEA next 30 days business", KEY);
    expect(res).toMatchObject({ ok: false, error: "seatsaero" });
  });

  it("maps a transport failure to network", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("Load failed");
    }) as typeof fetch;
    const res = await engine(fetchImpl).search("HKG to SEA next 30 days business", KEY);
    expect(res).toMatchObject({ ok: false, error: "network" });
  });

  it("refuses to spend the last of the quota and reports when it resets", async () => {
    const store = new DeviceQuotaStore();
    // seats.aero itself says nothing is left today.
    store.observeRateLimitRemaining("0", NOW);
    const fetchImpl = fakeSeatsAero({ data: [], hasMore: false });
    const res = await engine(fetchImpl, store).search("HKG to SEA next 30 days business", KEY);

    expect(res).toMatchObject({ ok: false, error: "quota" });
    if (!res.ok) expect(res.resetAt).toBe("2026-10-02T00:00:00.000Z");
    // The important part: it never reached the network.
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it("rejects an empty query without spending a call", async () => {
    const fetchImpl = fakeSeatsAero({ data: [], hasMore: false });
    const res = await engine(fetchImpl).search("   ", KEY);
    expect(res).toMatchObject({ ok: false, error: "invalid_body" });
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it("reports a quota view the UI can render without a second round trip", async () => {
    const fetchImpl = fakeSeatsAero({ data: [availability("2026-10-05")], hasMore: false });
    const e = engine(fetchImpl);
    const res = await e.search("HKG to SEA next 30 days business", KEY);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.quota.softLimit).toBe(950);
    expect(res.value.quota.used).toBe(res.value.api_calls_used);
    expect(res.value.quota.remaining).toBe(950 - res.value.api_calls_used);
    expect(await e.quota.used(LOCAL_USER)).toBe(res.value.api_calls_used);
  });

  it("serves the second identical search from cache, spending nothing", async () => {
    const fetchImpl = fakeSeatsAero({ data: [availability("2026-10-05")], hasMore: false });
    const e = engine(fetchImpl);
    const first = await e.search("HKG to SEA next 30 days business", KEY);
    const callsAfterFirst = fetchImpl.calls.length;
    const second = await e.search("HKG to SEA next 30 days business", KEY);

    expect(first.ok && second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.served_from_cache).toBe(true);
    expect(second.value.api_calls_used).toBe(0);
    expect(fetchImpl.calls.length).toBe(callsAfterFirst);
  });

  it("asks for no route list when a pair comes back empty: one Cached Search, and the empty pair reads as checked", async () => {
    // Rows for HKG only. The grid search used to fetch every program's route list here, one call each, before the
    // rows were shown, to label PVG to SEA "not monitored" (26 calls for a search of all programs).
    const fetchImpl = fakeSeatsAero({ data: [availability("2026-10-05")], hasMore: false });
    const store = new DeviceQuotaStore();
    const res = await engine(fetchImpl, store).search("HKG, PVG to SEA next 30 days business", KEY);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { grid, notices } = res.value;
    expect(fetchImpl.calls.map((c) => c.url.pathname)).toEqual(["/partnerapi/search"]);
    expect(res.value.api_calls_used).toBe(1);
    expect(res.value.quota.used).toBe(1);
    // No "skipped to preserve today's quota" notice either: nothing was skipped, nothing was asked.
    expect(notices.map((n) => n.code)).toEqual([]);
    const statuses = (origin: string) => new Set(grid.cells.flat().filter((c) => c.origin === origin).map((c) => c.status));
    expect(grid.meta.unmonitored_pairs).toEqual([]);
    expect(statuses("PVG")).toEqual(new Set(["none"]));
    expect(statuses("HKG")).toEqual(new Set(["ok", "none"]));
  });

  it("marks the pairs a truncated pull may never have reached as not fetched, not as empty", async () => {
    // Every Cached Search page claims there is more, so runFind stops at its page cap and warns
    // (find.ts:418-424): for the pairs with no rows the only honest state is not fetched.
    const fetchImpl = fakeSeatsAero({ data: [availability("2026-10-05")], hasMore: true, cursor: 1 });
    // SHA is also the Shanghai metro code, so the parser asks for PVG and SHA as well as HKG.
    const res = await engine(fetchImpl).search("HKG, SHA to SEA next 30 days business", KEY);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { grid, notices } = res.value;
    expect(notices.map((n) => n.code)).toContain("find.truncated_search");
    const cells = grid.cells.flat();
    const statuses = (origin: string) => new Set(cells.filter((c) => c.origin === origin).map((c) => c.status));
    expect(grid.meta.not_fetched_pairs.map((p) => `${p.pair.origin}-${p.pair.dest}`)).toEqual(["PVG-SEA", "SHA-SEA"]);
    expect(statuses("PVG")).toEqual(new Set(["not_fetched"]));
    expect(statuses("SHA")).toEqual(new Set(["not_fetched"]));
    expect(cells.find((c) => c.origin === "SHA")?.reason).toBe("grid.cell.not_fetched");
    expect(statuses("HKG")).toEqual(new Set(["ok", "none"]));
    expect(grid.meta.unmonitored_pairs).toEqual([]);
    expect(fetchImpl.calls.some((c) => c.url.pathname.endsWith("/routes"))).toBe(false);
  });
});

describe("SearchEngine: the route catalog is Ask's alone", () => {
  it("sends no Get Routes call from any grid entry, even with every pair empty and a catalog that could fill", async () => {
    const fetchImpl = fakeFetch((req) =>
      req.url.pathname.endsWith("/routes") ? jsonResponse(monitoredRoutes(req.url.searchParams.get("source")!, ["HKG"])) : jsonResponse({ data: [], hasMore: false }),
    );
    const routes = new RoutesCatalog();
    const e = new SearchEngine({ fetchImpl, quota: new Quota({ store: new DeviceQuotaStore(), now: () => NOW }), routes, now: () => NOW });
    const typed = await e.search("HKG, PVG to SEA next 30 days business", KEY);
    expect(typed.ok).toBe(true);
    if (!typed.ok) return;
    // The structured entry (the query editor, Saved refresh, run again and watches) runs the same executor.
    const structured = await e.searchQuery({ ...typed.value.query, cabins: ["F"] }, KEY);
    expect(structured.ok).toBe(true);
    expect(fetchImpl.calls.filter((c) => c.url.pathname.endsWith("/routes"))).toEqual([]);
    expect(fetchImpl.calls).toHaveLength(2);
    expect(routes.loadedSources(LOCAL_USER)).toEqual([]);
    // Ask still reads the same catalog through the engine (../ask/seats-port.ts).
    expect(e.routes).toBe(routes);
  });
});
