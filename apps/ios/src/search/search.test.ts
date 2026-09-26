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
import { SEATS_SOURCES } from "@awardgrid/core/seatsaero/types";
import { DeviceQuotaStore } from "../store/quota-store";
import { LOCAL_USER, SearchEngine, routesFailedWarning } from "./search";

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
    if (!res.ok) expect(res.message).toMatch(/Pro account/i);
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

  it("tells the grid which pairs seats.aero does not monitor, so their cells do not read as empty", async () => {
    // Rows for HKG only, and Get Routes answers an empty list for every program: runFind reports
    // the pair with no rows as not monitored (packages/core/src/lib/seatsaero/find.ts:360-377).
    const fetchImpl = fakeSeatsAero({ data: [availability("2026-10-05")], hasMore: false });
    const res = await engine(fetchImpl).search("HKG, PVG to SEA next 30 days business", KEY);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { grid } = res.value;
    const statuses = (origin: string) => new Set(grid.cells.flat().filter((c) => c.origin === origin).map((c) => c.status));
    expect(grid.meta.unmonitored_pairs.map((p) => p.key)).toEqual(["PVG-SEA"]);
    expect(statuses("PVG")).toEqual(new Set(["unmonitored"]));
    // A pair with rows is never "not monitored": its other dates were checked and had nothing.
    expect(statuses("HKG")).toEqual(new Set(["ok", "none"]));
  });

  it("marks the pairs a truncated pull may never have reached as not fetched, not as empty", async () => {
    // Every Cached Search page claims there is more, so runFind stops at its page cap and warns
    // (find.ts:418-424). Get Routes says every pair IS monitored, so the gap cannot be explained as
    // "not monitored": for the pairs with no rows the only honest state is not fetched.
    const fetchImpl = fakeFetch((req) =>
      req.url.pathname.endsWith("/routes")
        ? jsonResponse(monitoredRoutes(req.url.searchParams.get("source")!, ["HKG", "PVG", "SHA"]))
        : jsonResponse({ data: [availability("2026-10-05")], hasMore: true, cursor: 1 }),
    );
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
  });
});

describe("SearchEngine: one program's route list failing (#89)", () => {
  /** Rows for HKG only; every program's list monitors HKG to SEA, and aeroplan's answers 500 (E2's demo-key-partial). */
  function partial() {
    return fakeFetch((req) => {
      if (!req.url.pathname.endsWith("/routes")) return jsonResponse({ data: [availability("2026-10-05")], hasMore: false });
      const source = req.url.searchParams.get("source")!;
      return source === "aeroplan" ? textResponse("{}", 500) : jsonResponse(monitoredRoutes(source, ["HKG"]));
    });
  }

  it("keeps the grid it paid for, names the failed list, and claims nothing about the pair it may cover", async () => {
    const fetchImpl = partial();
    const store = new DeviceQuotaStore();
    const res = await engine(fetchImpl, store).search("HKG, PVG to SEA next 30 days business", KEY);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { grid, notices, warnings, rows, coverage } = res.value;
    expect(rows?.length).toBe(1);
    expect(notices.map((n) => n.code)).toEqual(["find.routes_failed"]);
    // Said the way this screen draws it: PVG to SEA was searched to the end; only its monitoring is unknown.
    expect(warnings).toEqual([
      "Couldn't load the route list for Air Canada Aeroplan: seats.aero returned an error. PVG → SEA was searched to the end, but whether seats.aero monitors it is unknown.",
    ]);
    expect(warnings.join(" ")).not.toMatch(/quota|unchecked/i);
    expect(grid.meta.unmonitored_pairs).toEqual([]);
    expect(coverage?.slices.find((s) => s.origin === "PVG")?.state).toBe("complete");
    // One search page and every program's list, the failed one included: all counted against today's calls.
    expect(res.value.api_calls_used).toBe(1 + SEATS_SOURCES.length);
    expect(res.value.quota.used).toBe(1 + SEATS_SOURCES.length);
    expect(JSON.stringify(res)).not.toContain(KEY);
  });

  it("was the whole search's failure on the plain catalog, after the calls were spent", async () => {
    const fetchImpl = partial();
    const plain = new SearchEngine({ fetchImpl, quota: new Quota({ store: new DeviceQuotaStore(), now: () => NOW }), routes: new RoutesCatalog(), now: () => NOW });
    const res = await plain.search("HKG, PVG to SEA next 30 days business", KEY);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("seatsaero");
  });

  it("says when the failed list changes nothing, and names every pair it leaves open", () => {
    expect(routesFailedWarning({ routes_failed: ["aeroplan", "united"], monitoring_unknown: [] })).toBe(
      "Couldn't load the route lists for Air Canada Aeroplan, United MileagePlus: seats.aero returned an error. It does not change these results.",
    );
    expect(
      routesFailedWarning({
        routes_failed: ["aeroplan"],
        monitoring_unknown: [
          { origin: "PVG", dest: "SEA", key: "PVG-SEA" },
          { origin: "SHA", dest: "SEA", key: "SHA-SEA" },
        ],
      }),
    ).toBe("Couldn't load the route list for Air Canada Aeroplan: seats.aero returned an error. PVG → SEA, SHA → SEA were searched to the end, but whether seats.aero monitors them is unknown.");
  });
});
