/**
 * seats.aero payloads → the persisted AvailabilityRow shape (kickoff §3 / grid/types.ts).
 * The grid never sees raw seats.aero objects; everything downstream depends on this file.
 */
import { Cabin } from "../query/schema";
import type { AvailabilityRow } from "../grid/types";
import { CABIN_NAME_TO_LETTER, type Availability, type CabinName, type TripsResponse } from "./types";

export interface NormalizeOptions {
  /** ISO timestamp when awardgrid pulled the payload; also the last freshness fallback. */
  fetchedAt: string;
  /** Whether the request carried include_filtered=true; stamped on every row for cache scoping. */
  includeFiltered?: boolean;
  /**
   * The min_cabin_pct the request carried; stamped on every row for cache scoping. 100 (the
   * API's own default) is stamped as ABSENT, so a row is byte-identical to a pre-#18 one.
   */
  minCabinPct?: number;
}

/** "AA, B6" → ["AA","B6"]; null/"" → []. */
export function splitAirlines(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** MileageCost is a string ("12500"; "0" = unavailable). Returns 0 for anything unparsable. */
export function parseMiles(raw: string | null | undefined): number {
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * One row per cabin that is Available with a positive MileageCost. Cabins with null fields
 * (the official example has F* all null on some rows) or a "0" cost are skipped.
 */
export function availabilityToRows(av: Availability, opts: NormalizeOptions): AvailabilityRow[] {
  const rows: AvailabilityRow[] = [];
  const computedLastSeen = av.ComputedLastSeen ?? av.UpdatedAt ?? opts.fetchedAt;
  // Keep WHICH clock that was (T02, docs/uiux-v1): the fallback chain above is what every existing
  // consumer reads, and it makes a row with no provider time look freshly updated.
  const timeBasis = av.ComputedLastSeen != null ? "provider_last_seen" : av.UpdatedAt != null ? "provider_updated" : "local_fallback";
  const currency = av.TaxesCurrency ? av.TaxesCurrency : null;
  for (const cabin of Cabin.options) {
    if (av[`${cabin}Available`] !== true) continue;
    const miles = parseMiles(av[`${cabin}MileageCost`]);
    if (miles <= 0) continue;
    const taxes = av[`${cabin}TotalTaxes`];
    rows.push({
      program: av.Source,
      origin: av.Route.OriginAirport,
      dest: av.Route.DestinationAirport,
      date: av.Date,
      cabin,
      miles,
      fees_cents: typeof taxes === "number" ? taxes : null,
      currency,
      seats_left: av[`${cabin}RemainingSeats`] ?? 0,
      direct: av[`${cabin}Direct`] ?? false,
      airlines: splitAirlines(av[`${cabin}Airlines`]),
      computed_last_seen: computedLastSeen,
      time_basis: timeBasis,
      ...(av.UpdatedAt != null ? { provider_updated_at: av.UpdatedAt } : {}),
      source_id: av.ID,
      booking_url: null,
      fetched_at: opts.fetchedAt,
      ...(opts.includeFiltered ? { include_filtered: true } : {}),
      ...(opts.minCabinPct !== undefined && opts.minCabinPct < 100 ? { min_cabin_pct: opts.minCabinPct } : {}),
    });
  }
  return rows;
}

export function availabilitiesToRows(list: readonly Availability[], opts: NormalizeOptions): AvailabilityRow[] {
  return list.flatMap((av) => availabilityToRows(av, opts));
}

export interface TripFees {
  /** TotalTaxes of the cheapest trip (minor units), or null when there are no trips. */
  fees_cents: number | null;
  currency: string | null;
  /** The `primary` booking link, else the first one, else null. */
  booking_url: string | null;
}

/**
 * Fees + booking link from a Get Trips response, for the cell-expand flow. `cabin` narrows
 * to that cabin's trips (Trip.Cabin uses the API's names); cheapest = lowest MileageCost,
 * then lowest TotalTaxes.
 */
export function tripsToFees(res: TripsResponse, cabin?: Cabin | CabinName): TripFees {
  const wanted = cabin === undefined ? undefined : toLetter(cabin);
  const trips = res.data.filter((t) => wanted === undefined || toLetter(t.Cabin) === wanted);
  const cheapest = [...trips].sort((a, b) => a.MileageCost - b.MileageCost || a.TotalTaxes - b.TotalTaxes)[0];
  const primary = res.booking_links.find((l) => l.primary) ?? res.booking_links[0];
  return {
    fees_cents: cheapest ? cheapest.TotalTaxes : null,
    currency: cheapest?.TaxesCurrency ? cheapest.TaxesCurrency : null,
    booking_url: primary?.link ?? null,
  };
}

function toLetter(cabin: string): Cabin | undefined {
  if (Cabin.safeParse(cabin).success) return cabin as Cabin;
  return CABIN_NAME_TO_LETTER[cabin as CabinName];
}
