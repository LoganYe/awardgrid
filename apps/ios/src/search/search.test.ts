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
});
