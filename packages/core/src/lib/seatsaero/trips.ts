/**
 * Get Trips for one Availability ID, with no database behind it.
 *
 * Ported from the web facade (src/lib/server/find.ts:431-618). A client shell prices a cell the way
 * the web drawer does, so it needs the same three pieces:
 *
 *   summarizeTrip       Trip → the flat shape a drawer or a tool result renders    (unchanged)
 *   cacheFeesFromTrips  write a learned fee back onto its one cached row (#52)     (unchanged)
 *   runGetTrips         getTripsForUser without the database: the caller injects the key, the
 *                       transport, the Quota and the cache store the web resolves per user
 *
 * The web file is not edited in this phase, so it keeps its own copy. The doc comments travel with
 * the code on purpose: they are the reasons the rules exist, and a port that dropped them would
 * invite someone to "simplify" a rule that took an incident to learn.
 */
import { DEFAULT_MIN_CABIN_PCT, type Cabin } from "../query/schema";
import type { AvailabilityCacheStore } from "./cache";
import { SeatsAeroClient } from "./client";
import { tripsToFees, type TripFees } from "./normalize";
import type { Quota } from "./quota";
import type { Trip } from "./types";

export interface TripSegmentSummary {
  flight_number: string;
  origin: string;
  dest: string;
  departs_at: string; // airport-local, "Z" suffix is NOT UTC (ARCHITECTURE §2.3)
  arrives_at: string;
  aircraft: string | null;
  fare_class: string | null;
}

export interface TripSummary {
  id: string;
  cabin: string;
  miles: number;
  fees_cents: number;
  currency: string | null;
  seats: number;
  stops: number;
  carriers: string;
  flight_numbers: string;
  departs_at: string;
  arrives_at: string;
  duration: number | null;
  mixed_cabin_pct: number | null;
  segments: TripSegmentSummary[];
}

/**
 * The web's TripsForUserResult (src/lib/server/find.ts:458-468) less its `quota` snapshot, which is
 * built by a helper local to that file (:329-331). A caller here already holds the Quota it passed
 * in and reads `used` / `remaining` from it directly.
 */
export interface GetTripsResult {
  availability_id: string;
  trips: TripSummary[];
  /** Cheapest trip's taxes (minor units) for the requested cabin, else null. */
  fees_cents: number | null;
  currency: string | null;
  booking_url: string | null;
  booking_links: { label: string; link: string; primary: boolean }[];
  /** Requests that reached the transport (the client's call listener), failed ones included. */
  api_calls_used: number;
}

export function summarizeTrip(t: Trip): TripSummary {
  return {
    id: t.ID,
    cabin: t.Cabin,
    miles: t.MileageCost,
    fees_cents: t.TotalTaxes,
    currency: t.TaxesCurrency ? t.TaxesCurrency : null,
    seats: t.RemainingSeats,
    stops: t.Stops,
    carriers: t.Carriers,
    flight_numbers: t.FlightNumbers,
    departs_at: t.DepartsAt,
    arrives_at: t.ArrivesAt,
    duration: t.TotalDuration ?? null,
    mixed_cabin_pct: t.MixedCabinPct ?? null,
    segments: [...t.AvailabilitySegments]
      .sort((a, b) => (a.Order ?? 0) - (b.Order ?? 0))
      .map((s) => ({
        flight_number: s.FlightNumber,
        origin: s.OriginAirport,
        dest: s.DestinationAirport,
        departs_at: s.DepartsAt,
        arrives_at: s.ArrivesAt,
        aircraft: s.AircraftName ?? s.AircraftCode ?? null,
        fare_class: s.FareClass ?? null,
      })),
  };
}

/**
 * Persist what Get Trips priced onto the cached row it belongs to (issue #52). Get Trips is the
 * only source of real fees, currency and booking link; before this they were returned to the one
 * open drawer and dropped, so a cell's fee lasted exactly as long as the render did.
 *
 * The rules, in the order they bite:
 *
 *  - WHICH ROW. `fees` is `tripsToFees(res, cabin)` — the cheapest trip IN THAT CABIN, which is
 *    the number the drawer shows for that cabin's row. So the write goes to that one row: the
 *    cached row with this Availability ID and this cabin, nothing else. Without a cabin the
 *    caller asked for the cheapest trip in ANY cabin, which is not the fee of any single cell —
 *    there is no row it may be attributed to, and nothing is written.
 *  - WHICH SCOPE. The lookup carries the request's own include_filtered / min_cabin_pct, so the
 *    fee lands in the scope the drawer asked in and never leaks into the neighbouring one (a
 *    100 % row must not inherit a 70 % answer). Per user, like every other cache write.
 *  - EVIDENCE. Everything written is evidence about THIS cabin, so the whole write is gated on
 *    having priced a trip in it. A response with no trip in this cabin still carries the
 *    availability-level `booking_links[]`, and writing that link alone would permanently
 *    re-point the cell's deeplink (`resolveDeeplink` prefers `booking_url` over every program
 *    builder) on the strength of a call that found no itinerary to book.
 *  - CURRENCY. The currency of the fee just learned, verbatim — null included. seats.aero sends
 *    `TaxesCurrency: ""` for USD, which `tripsToFees` normalizes to null, and null already means
 *    the recorded USD assumption everywhere else (`formatFees`, `availabilityToRows`). Inheriting
 *    the row's old currency instead would label a USD amount "EUR".
 *  - FRESHNESS. `computed_last_seen` and `fetched_at` are never touched: they say how old the
 *    AVAILABILITY is, and a fresh fee does not make a three-day-old row newly seen. See
 *    DECISIONS.md (#52).
 *  - ATOMICITY. The write is a targeted `updateRowFees`, not a re-upsert of the row that was
 *    read: between the read and the write a Cached Search refresh may have rewritten or deleted
 *    this row, and an upsert would roll its columns back or resurrect a retired award.
 *
 * Returns true when a row was updated (false = nothing to learn, or no such row cached).
 */
export async function cacheFeesFromTrips(
  cache: AvailabilityCacheStore,
  userId: string,
  availabilityId: string,
  fees: TripFees,
  scope: { cabin?: Cabin; include_filtered?: boolean; min_cabin_pct?: number },
): Promise<boolean> {
  if (scope.cabin === undefined) return false;
  // No trip in this cabin = nothing was learned ABOUT this cabin, booking link included.
  if (fees.fees_cents === null) return false;
  const rows = await cache.getRowsBySourceId(userId, availabilityId, {
    include_filtered: scope.include_filtered ?? false,
    min_cabin_pct: scope.min_cabin_pct ?? DEFAULT_MIN_CABIN_PCT,
  });
  const row = rows.find((r) => r.cabin === scope.cabin);
  if (!row) return false;
  // A response with a priced trip but no booking link keeps the stored link: a missing link is
  // not a contradiction of a good one, unlike the currency, which belongs to the fee itself.
  const bookingUrl = fees.booking_url ?? row.booking_url;
  if (fees.fees_cents === row.fees_cents && fees.currency === row.currency && bookingUrl === row.booking_url) return false;
  return cache.updateRowFees(userId, row, {
    fees_cents: fees.fees_cents,
    currency: fees.currency,
    booking_url: bookingUrl,
  });
}

export interface RunGetTripsOptions {
  availabilityId: string;
  /** The cabin of the cell being priced. Without one the fee is returned but written nowhere (see cacheFeesFromTrips). */
  cabin?: Cabin;
  userId: string;
  /**
   * The caller's own seats.aero key. Required, with no fallback, exactly as runFind's (find.ts:211-217):
   * every request here is made by a client built from THIS key.
   */
  apiKey: string;
  /**
   * Transport; a shell injects its native adapter, tests a fake. Required: left out, SeatsAeroClient would
   * fall back to globalThis.fetch (client.ts:227), which in the iOS shell is the WebView's.
   */
  fetch: typeof fetch;
  /** Carries its own clock (quota.ts:91-96), which is the only time this flow reads. */
  quota: Quota;
  cache: AvailabilityCacheStore;
  /** The scope the priced cell was fetched in. Absent = false, the grid lane's scope. */
  include_filtered?: boolean;
  /** Absent = 100, the API's own default and the grid lane's scope. */
  min_cabin_pct?: number;
}

/**
 * Get Trips for one Availability ID — costs exactly one seats.aero call, reserved before the
 * request and charged whether it succeeds or fails (seats.aero charged for it either way).
 *
 * One ordering differs from getTripsForUser: the client is built BEFORE the reservation. Its
 * constructor makes no request and throws on an empty key (client.ts:222-225). The web resolved the
 * key from its database first (src/lib/server/find.ts:570) and so never reached the reservation
 * without one; here the key is an argument, and building the client after reserving would leave a
 * reservation that nothing settles.
 */
export async function runGetTrips(opts: RunGetTripsOptions): Promise<GetTripsResult> {
  const { availabilityId, cabin, userId, quota, cache } = opts;
  const client = new SeatsAeroClient({ apiKey: opts.apiKey, fetch: opts.fetch });

  const day = quota.today();
  await quota.reserve(userId, 1, day); // throws QuotaExceededError with the reset time
  let calls = 0;
  const unsubscribe = client.subscribe(() => {
    calls += 1;
  });
  try {
    const pct = opts.min_cabin_pct ?? 100;
    const res = await client.getTrips(availabilityId, {
      ...(opts.include_filtered ? { include_filtered: true } : {}),
      // 100 is the API's own default: omitted so the request is unchanged from before #18.
      ...(pct < 100 ? { min_cabin_pct: pct } : {}),
    });
    const fees = tripsToFees(res, cabin);
    // The only place a real fee, currency or booking link is ever learned: write it back to the
    // cell's own cached row (issue #52). A store failure must not cost the user the answer they
    // just paid a call for, so it is logged by NAME ONLY (kickoff §10) and the response stands.
    try {
      await cacheFeesFromTrips(cache, userId, availabilityId, fees, {
        ...(cabin ? { cabin } : {}),
        ...(opts.include_filtered ? { include_filtered: true } : {}),
        ...(opts.min_cabin_pct !== undefined ? { min_cabin_pct: opts.min_cabin_pct } : {}),
      });
    } catch (err) {
      console.error("trips fee writeback failed", err instanceof Error ? err.name : typeof err);
    }
    const trips = res.data.map(summarizeTrip).sort((a, b) => a.miles - b.miles || a.fees_cents - b.fees_cents);
    return {
      availability_id: availabilityId,
      trips,
      fees_cents: fees.fees_cents,
      currency: fees.currency,
      booking_url: fees.booking_url,
      booking_links: res.booking_links.map((l) => ({ label: l.label, link: l.link, primary: l.primary })),
      api_calls_used: calls,
    };
  } finally {
    unsubscribe();
    // The reservation covered one call; refund it only if no request reached the server.
    if (calls === 0) await quota.release(userId, 1, day);
    else if (calls > 1) await quota.increment(userId, calls - 1, day);
  }
}
