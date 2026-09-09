/**
 * Row ranking (kickoff §4.5). v1 sort = miles_asc within cabin with fees as tiebreaker; the
 * other orders exist so the UI's sort control is bound to `sort_by`. Every comparator ends
 * with a stable tail so equal rows still produce deterministic output (grid, CSV, ASCII).
 */
import type { FutureSortBy, SortBy } from "../query/schema";
import { SOURCE_NAMES } from "../seatsaero/types";
import type { AvailabilityRow } from "./types";

export type RowComparator = (a: AvailabilityRow, b: AvailabilityRow) => number;

/** Display name for a seats.aero source code (text only); unknown codes fall back to the code. */
export function programDisplayName(code: string): string {
  return (SOURCE_NAMES as Record<string, string>)[code] ?? code;
}

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const byMilesAsc: RowComparator = (a, b) => a.miles - b.miles;

/** Unknown fees sort after every known fee (we cannot claim they are cheap). */
const byFeesAscNullLast: RowComparator = (a, b) => {
  if (a.fees_cents === null && b.fees_cents === null) return 0;
  if (a.fees_cents === null) return 1;
  if (b.fees_cents === null) return -1;
  return a.fees_cents - b.fees_cents;
};

const bySeatsDesc: RowComparator = (a, b) => b.seats_left - a.seats_left;

const byProgramName: RowComparator = (a, b) =>
  cmpStr(programDisplayName(a.program), programDisplayName(b.program)) ||
  cmpStr(a.program, b.program);

const byDateAsc: RowComparator = (a, b) => cmpStr(a.date, b.date);

/** Final tiebreaker so sorting is total: same pair/date/cabin/program rows differ only by id. */
const stableTail: RowComparator = (a, b) =>
  cmpStr(a.date, b.date) ||
  cmpStr(a.origin, b.origin) ||
  cmpStr(a.dest, b.dest) ||
  cmpStr(a.cabin, b.cabin) ||
  cmpStr(a.source_id, b.source_id);

function chain(...cmps: RowComparator[]): RowComparator {
  return (a, b) => {
    for (const cmp of cmps) {
      const r = cmp(a, b);
      if (r !== 0) return r;
    }
    return 0;
  };
}

const COMPARATORS: Record<SortBy, RowComparator> = {
  miles_asc: chain(byMilesAsc, byFeesAscNullLast, bySeatsDesc, byProgramName, stableTail),
  fees_asc: chain(byFeesAscNullLast, byMilesAsc, bySeatsDesc, byProgramName, stableTail),
  seats_desc: chain(bySeatsDesc, byMilesAsc, byFeesAscNullLast, byProgramName, stableTail),
  date_asc: chain(byDateAsc, byMilesAsc, byFeesAscNullLast, bySeatsDesc, byProgramName, stableTail),
};

/**
 * Sort orders the ranker can actually produce. `cpp_desc` (cents per point) is reserved in
 * `FutureSortBy` but needs a Duffel cash reference fare per cell — see BACKLOG.md. It is
 * deliberately not implemented here: `isImplementedSortBy` lets callers reject it early.
 */
export type ImplementedSortBy = SortBy;
export function isImplementedSortBy(sortBy: FutureSortBy): sortBy is ImplementedSortBy {
  // TODO(BACKLOG.md "cpp_desc"): add a comparator once a cash reference exists on AvailabilityRow.
  return sortBy !== "cpp_desc";
}

/** Comparator for `Array.prototype.sort`; total order for any `sort_by`. */
export function compareRows(sortBy: SortBy): RowComparator {
  return COMPARATORS[sortBy];
}

/** The single best row per `sort_by`, or null for an empty set. Does not mutate `rows`. */
export function bestRow(rows: readonly AvailabilityRow[], sortBy: SortBy): AvailabilityRow | null {
  const cmp = compareRows(sortBy);
  let best: AvailabilityRow | null = null;
  for (const row of rows) {
    if (best === null || cmp(row, best) < 0) best = row;
  }
  return best;
}

/** Cheapest row by miles (fees tiebreaker) regardless of the query's sort — for "cheapest overall". */
export function cheapestRow(rows: readonly AvailabilityRow[]): AvailabilityRow | null {
  return bestRow(rows, "miles_asc");
}
