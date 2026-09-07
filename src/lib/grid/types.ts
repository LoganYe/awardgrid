import type { Cabin, QueryObject } from "@/lib/query/schema";

/**
 * One normalized award row = one (program, origin, dest, date, cabin). This is exactly the
 * shape persisted in the `availability_cache` table (kickoff §3), so the grid never depends
 * on raw seats.aero payloads.
 */
export interface AvailabilityRow {
  program: string; // seats.aero source code, e.g. "american"
  origin: string; // IATA
  dest: string; // IATA
  date: string; // YYYY-MM-DD
  cabin: Cabin;
  miles: number; // > 0
  fees_cents: number | null; // null until known (Get Trips, or observed *TotalTaxes field)
  currency: string | null; // ISO code; "" from the API is normalized to null
  seats_left: number; // 0 = unknown / not provided by the program
  direct: boolean;
  airlines: string[]; // ["AA", "B6"]
  computed_last_seen: string; // ISO timestamp used for freshness (ComputedLastSeen ?? UpdatedAt ?? fetched_at)
  source_id: string; // seats.aero Availability ID (for Get Trips on expand)
  booking_url: string | null; // seats.aero primary booking link when known
  fetched_at: string; // ISO timestamp when awardgrid pulled it
  /** True when fetched with include_filtered=true (a separate cache scope); absent = false. */
  include_filtered?: boolean;
  /**
   * The seats.aero min_cabin_pct the fetch carried (a separate cache scope, exactly like
   * include_filtered). Absent = 100, the API's own default — which is what every row written
   * before issue #18 is, so nothing had to be migrated.
   */
  min_cabin_pct?: number;
  /**
   * True for a dynamically priced row that the query (include_filtered=false) did NOT ask
   * for: it was appended from the cached include_filtered scope so the UI can render the
   * "filtered" cell state and explain the "Show dynamic pricing" toggle. Absent = false.
   */
  dynamic?: boolean;
}

/**
 * Cell states (Phase 6 §3.4). "loading" is never produced by buildGrid — the skeleton grid
 * the UI renders while a query runs uses it. "filtered" = every row in the cell is dynamic
 * and the query hides dynamic pricing.
 */
export type CellStatus = "ok" | "none" | "unmonitored" | "not_fetched" | "filtered" | "loading";

/** A pair whose fetch did not complete; `reason` is an i18n key (never English text). */
export interface NotFetchedPair {
  pair: { origin: string; dest: string };
  reason: string;
}

export interface GridCell {
  origin: string;
  dest: string;
  date: string;
  status: CellStatus;
  /** Best row across programs for the selected cabins, per sort_by. */
  best: AvailabilityRow | null;
  /** Every row for this (pair, date) across programs and selected cabins, sorted. */
  all: AvailabilityRow[];
  /** i18n key explaining a "not_fetched" cell; absent for every other status. */
  reason?: string;
}

/**
 * How a multi-cabin cell renders (docs/UI_PLAN.md §6.2b): "best" is the shipped anatomy — the
 * best row across the selected cabins with a J/F tag — and "per_cabin" draws one line per
 * selected cabin. It is view state, not part of the query: the grid's shape is identical either
 * way, only the inside of the cell changes.
 */
export type CellLayout = "best" | "per_cabin";

/** One cabin's line in a per-cabin cell; `row` is null when that cabin has nothing for this (pair, date). */
export interface CabinSlot {
  cabin: Cabin;
  row: AvailabilityRow | null;
  /** That cabin's only rows are hidden dynamic pricing (the cell "filtered" state, per cabin). */
  filtered: boolean;
}

export type Orientation = "dates" | "routes";

export interface RoutePair {
  origin: string;
  dest: string;
  key: string; // "HKG-SEA"
}

export interface Grid {
  orientation: Orientation;
  /** Row labels: dates when orientation === "dates", pair keys otherwise. */
  rows: string[];
  /** Column labels: pair keys when orientation === "dates", dates otherwise. */
  cols: string[];
  cells: GridCell[][]; // cells[rowIndex][colIndex]
  pairs: RoutePair[];
  dates: string[];
  query: QueryObject;
  meta: GridMeta;
}

export interface GridMeta {
  generated_at: string; // ISO
  /** Pairs seats.aero does not monitor for any requested program (from Get Routes), if known. */
  unmonitored_pairs: RoutePair[];
  /** Pairs whose fetch did not complete (quota headroom, truncation); reasons are i18n keys. */
  not_fetched_pairs: NotFetchedPair[];
  /** Oldest computed_last_seen across shown cells, for the header freshness badge. */
  oldest_seen: string | null;
  newest_seen: string | null;
  /** seats.aero API calls this render consumed (0 when served from cache). */
  api_calls_used: number;
  served_from_cache: boolean;
}

/** fresh < 2 h · aging 2–6 h · stale > 6 h · unknown = missing/unparseable timestamp. */
export type FreshnessTier = "fresh" | "aging" | "stale" | "unknown";
