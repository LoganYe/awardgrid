/**
 * Get Trips without a database: the two helpers ported unchanged from the web facade, and
 * runGetTrips' reservation and settlement.
 *
 * The web's cases (src/lib/server/find.test.ts:235-548) run over SQLite and a seeded user; these hold
 * the same rules over the in-memory stores a client shell uses. The trips payload is the recorded Get
 * Trips fixture (test/fixtures/seatsaero/trips__id.json). No network: every request goes to a fake
 * fetch, and the only clock this flow reads, the Quota's, is injected.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AvailabilityRow } from "../grid/types";
import { InMemoryAvailabilityCache, type RowScope } from "./cache";
import { SeatsAeroError, SeatsAeroHttpError, SeatsAeroNetworkError } from "./client";
import { tripsToFees } from "./normalize";
import { InMemoryQuotaStore, Quota, QuotaExceededError } from "./quota";
import { cacheFeesFromTrips, runGetTrips, summarizeTrip } from "./trips";
import type { TripsResponse } from "./types";
import { fakeFetch, jsonResponse, loadFixture, textResponse } from "../../../test/fixtures/seatsaero/helpers";

const KEY = "pro_key_for_trips_tests_SECRET";
const USER = "local";
const NOW = new Date("2026-10-01T12:00:00Z");
const BOOKING_URL = "https://example.test/book";
const DEFAULT_SCOPE: RowScope = { include_filtered: false, min_cabin_pct: 100 };

/** Three business trips for one availability, all 70,000 miles, taxes 1290 / 4174 / 1290, currency "". */
const tripsFixture = loadFixture<TripsResponse>("trips__id.json");
const ID = tripsFixture.data[0]!.AvailabilityID;
const PRIMARY_LINK = tripsFixture.booking_links.find((l) => l.primary)!.link;

/** A cached row for the fixture's availability, as a grid search would have stored it. */
function row(over: Partial<AvailabilityRow> = {}): AvailabilityRow {
  return {
    program: "lifemiles",
    origin: "CUN",
    dest: "IST",
    date: "2024-05-01",
    cabin: "J",
    miles: 70_000,
    fees_cents: null,
    currency: null,
    seats_left: 2,
    direct: false,
    airlines: ["CM", "TK"],
    computed_last_seen: "2026-10-01T11:00:00Z",
    source_id: ID,
    booking_url: null,
    fetched_at: "2026-10-01T11:00:00Z",
    ...over,
  };
}

async function cacheWith(rows: AvailabilityRow[]): Promise<InMemoryAvailabilityCache> {
  const cache = new InMemoryAvailabilityCache();
  await cache.putRows(USER, rows);
  return cache;
}

/** [cabin, fees_cents, currency, booking_url] of the availability's rows in one scope, by cabin. */
async function feesOf(cache: InMemoryAvailabilityCache, scope: RowScope = DEFAULT_SCOPE) {
  const rows = await cache.getRowsBySourceId(USER, ID, scope);
  return rows.map((r) => [r.cabin, r.fees_cents, r.currency, r.booking_url]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

function tripsFetch() {
  return fakeFetch((req) => (req.url.pathname === `/partnerapi/trips/${ID}` ? jsonResponse(tripsFixture) : textResponse("not found", 404)));
}

/** A Quota on NOW's UTC day with `used` calls already counted. */
async function seededQuota(used = 0): Promise<Quota> {
  const store = new InMemoryQuotaStore();
  await store.increment(USER, "2026-10-01", used);
  return new Quota({ store, now: () => NOW });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("summarizeTrip", () => {
  it("orders segments by Order, whatever order the response lists them in", () => {
    const trip = tripsFixture.data[0]!;
    const s = summarizeTrip({ ...trip, AvailabilitySegments: [...trip.AvailabilitySegments].reverse() });
    expect(s.segments.map((x) => x.flight_number)).toEqual(["CM326", "TK800"]);
  });

  it("normalises an empty currency to null and keeps a real one", () => {
    const trip = tripsFixture.data[0]!;
    expect(summarizeTrip({ ...trip, TaxesCurrency: "" }).currency).toBeNull();
    expect(summarizeTrip({ ...trip, TaxesCurrency: "EUR" }).currency).toBe("EUR");
  });
});

describe("cacheFeesFromTrips", () => {
  it("writes nothing without a cabin: the cheapest trip across cabins is no one cell's fee", async () => {
    const cache = await cacheWith([row({ cabin: "J" }), row({ cabin: "F" })]);
    const fees = tripsToFees(tripsFixture);
    expect(fees.fees_cents).toBe(1_290);
    expect(await cacheFeesFromTrips(cache, USER, ID, fees, DEFAULT_SCOPE)).toBe(false);
    expect(await feesOf(cache)).toEqual([
      ["F", null, null, null],
      ["J", null, null, null],
    ]);
  });

  it("writes nothing, booking link included, when no trip was priced in that cabin", async () => {
    const cache = await cacheWith([row({ cabin: "F" })]);
    // Every fixture trip is business: first has no price, but the response still carries links.
    const fees = tripsToFees(tripsFixture, "F");
    expect([fees.fees_cents, fees.booking_url]).toEqual([null, PRIMARY_LINK]);
    expect(await cacheFeesFromTrips(cache, USER, ID, fees, { cabin: "F", ...DEFAULT_SCOPE })).toBe(false);
    expect(await feesOf(cache)).toEqual([["F", null, null, null]]);
  });

  it("writes only the matching cabin's row, and only in the scope it was asked in", async () => {
    const cache = await cacheWith([
      row({ cabin: "J" }),
      row({ cabin: "F" }),
      row({ cabin: "J", include_filtered: true }),
      row({ cabin: "J", min_cabin_pct: 70 }),
    ]);
    const fees = tripsToFees(tripsFixture, "J");
    // An absent scope is the grid lane's own: include_filtered false, min_cabin_pct 100.
    expect(await cacheFeesFromTrips(cache, USER, ID, fees, { cabin: "J" })).toBe(true);
    expect(await feesOf(cache)).toEqual([
      ["F", null, null, null],
      ["J", 1_290, null, PRIMARY_LINK],
    ]);
    expect(await feesOf(cache, { include_filtered: true })).toEqual([["J", null, null, null]]);
    expect(await feesOf(cache, { min_cabin_pct: 70 })).toEqual([["J", null, null, null]]);
  });

  it("keeps a stored booking link when the response has none, but always takes the fee's own currency", async () => {
    const cache = await cacheWith([row({ cabin: "J", fees_cents: 12_000, currency: "EUR", booking_url: BOOKING_URL })]);
    const usd = { fees_cents: 5_000, currency: null, booking_url: null };
    expect(await cacheFeesFromTrips(cache, USER, ID, usd, { cabin: "J" })).toBe(true);
    expect(await feesOf(cache)).toEqual([["J", 5_000, null, BOOKING_URL]]);
    // Learning the same thing twice is not a second write.
    expect(await cacheFeesFromTrips(cache, USER, ID, usd, { cabin: "J" })).toBe(false);
  });

  it("adds its columns to a row a refresh rewrote mid-write, and never resurrects one a refresh deleted", async () => {
    /** A Cached Search refresh landing in the await gap between the read and the write. */
    class RefreshInTheGap extends InMemoryAvailabilityCache {
      refresh: (cache: InMemoryAvailabilityCache) => Promise<void> = async () => {};
      override async getRowsBySourceId(userId: string, sourceId: string, scope: RowScope): Promise<AvailabilityRow[]> {
        const rows = await super.getRowsBySourceId(userId, sourceId, scope);
        await this.refresh(this);
        return rows;
      }
    }
    const fees = { fees_cents: 4_200, currency: "USD", booking_url: BOOKING_URL };
    const original = row({ cabin: "J" });

    const rewritten = new RefreshInTheGap();
    await rewritten.putRows(USER, [original]);
    rewritten.refresh = (c) => c.putRows(USER, [{ ...original, miles: 55_000, seats_left: 9, computed_last_seen: "2026-10-01T11:59:00Z" }]);
    expect(await cacheFeesFromTrips(rewritten, USER, ID, fees, { cabin: "J" })).toBe(true);
    const [after] = await rewritten.getRowsBySourceId(USER, ID, DEFAULT_SCOPE);
    expect([after!.miles, after!.seats_left, after!.computed_last_seen, after!.fees_cents, after!.booking_url]).toEqual([
      55_000,
      9,
      "2026-10-01T11:59:00Z",
      4_200,
      BOOKING_URL,
    ]);

    const deleted = new RefreshInTheGap();
    await deleted.putRows(USER, [original]);
    deleted.refresh = (c) =>
      c.deleteRows(USER, { origins: [original.origin], dests: [original.dest], date_from: original.date, date_to: original.date, cabins: ["J"] });
    expect(await cacheFeesFromTrips(deleted, USER, ID, fees, { cabin: "J" })).toBe(false);
    expect(await deleted.getRowsBySourceId(USER, ID, DEFAULT_SCOPE)).toEqual([]);
  });
});

describe("runGetTrips", () => {
  it("reserves one call before the request, spends exactly one, and writes the fee to that cabin's row", async () => {
    const quota = await seededQuota();
    const cache = await cacheWith([row({ cabin: "J" }), row({ cabin: "F" })]);
    const usedWhenSent: number[] = [];
    const fetch = fakeFetch(async (req) => {
      usedWhenSent.push(await quota.used(USER));
      return req.url.pathname === `/partnerapi/trips/${ID}` ? jsonResponse(tripsFixture) : textResponse("not found", 404);
    });

    const res = await runGetTrips({ availabilityId: ID, cabin: "J", userId: USER, apiKey: KEY, fetch, quota, cache });

    // The reservation was already on the books when the request left.
    expect(usedWhenSent).toEqual([1]);
    expect(fetch.calls.map((c) => c.url.pathname + c.url.search)).toEqual([`/partnerapi/trips/${ID}`]);
    expect(fetch.calls[0]!.headers["partner-authorization"]).toBe(KEY);
    expect(res.api_calls_used).toBe(1);
    expect(await quota.used(USER)).toBe(1);
    // Every trip costs 70,000 miles, so taxes decide the order.
    expect(res.trips.map((t) => [t.miles, t.fees_cents])).toEqual([
      [70_000, 1_290],
      [70_000, 1_290],
      [70_000, 4_174],
    ]);
    expect([res.fees_cents, res.currency, res.booking_url]).toEqual([1_290, null, PRIMARY_LINK]);
    expect(res.booking_links).toHaveLength(tripsFixture.booking_links.length);
    expect(await feesOf(cache)).toEqual([
      ["F", null, null, null],
      ["J", 1_290, null, PRIMARY_LINK],
    ]);
    expect(JSON.stringify(res)).not.toContain(KEY);
  });

  it("asks in the priced cell's scope, sending only what differs from the API's defaults", async () => {
    const cache = await cacheWith([row({ cabin: "J" }), row({ cabin: "J", include_filtered: true, min_cabin_pct: 70 })]);
    const fetch = tripsFetch();
    await runGetTrips({ availabilityId: ID, cabin: "J", userId: USER, apiKey: KEY, fetch, quota: await seededQuota(), cache, include_filtered: true, min_cabin_pct: 70 });

    expect([...fetch.calls[0]!.url.searchParams.keys()].sort()).toEqual(["include_filtered", "min_cabin_pct"]);
    expect(await feesOf(cache, { include_filtered: true, min_cabin_pct: 70 })).toEqual([["J", 1_290, null, PRIMARY_LINK]]);
    expect(await feesOf(cache)).toEqual([["J", null, null, null]]);
  });

  it("refunds the reservation when no request went out", async () => {
    const fetch = tripsFetch();
    const quota = await seededQuota();
    const cache = await cacheWith([row({ cabin: "J" })]);
    // The client refuses a malformed id before any request (client.ts:299) ...
    await expect(runGetTrips({ availabilityId: "not an id", cabin: "J", userId: USER, apiKey: KEY, fetch, quota, cache })).rejects.toBeInstanceOf(
      SeatsAeroError,
    );
    // ... and an empty key before anything is reserved at all.
    await expect(runGetTrips({ availabilityId: ID, cabin: "J", userId: USER, apiKey: "", fetch, quota, cache })).rejects.toBeInstanceOf(SeatsAeroError);
    expect(fetch.calls).toHaveLength(0);
    expect(await quota.used(USER)).toBe(0);
  });

  it("charges a failed request, because seats.aero counted it, and leaves the row as it was", async () => {
    const cases = [
      { fetch: fakeFetch(() => textResponse("upstream is down", 502)), error: SeatsAeroHttpError },
      {
        fetch: fakeFetch(() => {
          throw new TypeError("Load failed");
        }),
        error: SeatsAeroNetworkError,
      },
    ];
    for (const { fetch, error } of cases) {
      const quota = await seededQuota();
      const cache = await cacheWith([row({ cabin: "J" })]);
      await expect(runGetTrips({ availabilityId: ID, cabin: "J", userId: USER, apiKey: KEY, fetch, quota, cache })).rejects.toBeInstanceOf(error);
      expect(fetch.calls).toHaveLength(1);
      expect(await quota.used(USER)).toBe(1);
      expect(await feesOf(cache)).toEqual([["J", null, null, null]]);
    }
  });

  it("refuses before any request once the soft limit is reached, and charges nothing", async () => {
    const fetch = tripsFetch();
    const quota = await seededQuota(950);
    const err = await runGetTrips({ availabilityId: ID, cabin: "J", userId: USER, apiKey: KEY, fetch, quota, cache: await cacheWith([]) }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(QuotaExceededError);
    expect((err as QuotaExceededError).resetAt.toISOString()).toBe("2026-10-02T00:00:00.000Z");
    expect(fetch.calls).toHaveLength(0);
    expect(await quota.used(USER)).toBe(950);
  });

  it("a failed fee write does not cost the answer the call paid for, and is logged by name only", async () => {
    class BrokenWrites extends InMemoryAvailabilityCache {
      override async updateRowFees(): Promise<boolean> {
        throw new Error(`write failed for ${KEY}`);
      }
    }
    const cache = new BrokenWrites();
    await cache.putRows(USER, [row({ cabin: "J" })]);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const quota = await seededQuota();

    const res = await runGetTrips({ availabilityId: ID, cabin: "J", userId: USER, apiKey: KEY, fetch: tripsFetch(), quota, cache });

    expect(res.fees_cents).toBe(1_290);
    expect(await quota.used(USER)).toBe(1);
    expect(log).toHaveBeenCalledWith("trips fee writeback failed", "Error");
    expect(JSON.stringify(log.mock.calls)).not.toContain(KEY);
  });
});
