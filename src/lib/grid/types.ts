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
}

export type CellStatus = "ok" | "none" | "unmonitored" | "not_fetched";

export interface GridCell {
  origin: string;
  dest: string;
  date: string;
  status: CellStatus;
  /** Best row across programs for the selected cabins, per sort_by. */
  best: AvailabilityRow | null;
  /** Every row for this (pair, date) across programs and selected cabins, sorted. */
  all: AvailabilityRow[];
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
  /** Oldest computed_last_seen across shown cells, for the header freshness badge. */
  oldest_seen: string | null;
  newest_seen: string | null;
  /** seats.aero API calls this render consumed (0 when served from cache). */
  api_calls_used: number;
  served_from_cache: boolean;
}

export type FreshnessTier = "fresh" | "aging" | "stale";
