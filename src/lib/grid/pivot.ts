/**
 * Pivot normalized AvailabilityRow[] into the Grid (kickoff §4.4).
 * Default orientation: rows = dates, cols = origin→dest pairs; "routes" transposes.
 * One cell = best row across programs for the selected cabins, per `query.sort_by`.
 *
 * Cell status (Phase 6 §3.4):
 *   ok           at least one row the query asked for
 *   filtered     every row is `dynamic` (appended from the include_filtered scope) and the
 *                query hides dynamic pricing — `best` is the best dynamic row so the UI can
 *                draw the muted anatomy; with include_filtered=true dynamic rows are plain "ok"
 *   unmonitored  no rows and seats.aero does not track the pair (Get Routes)
 *   not_fetched  no rows and the pair's fetch did not complete (`reason` = i18n key)
 *   none         no rows, fetched, nothing available
 */
import { CABIN_ORDER, type Cabin, type QueryObject } from "@/lib/query/schema";
import { compareRows } from "@/lib/grid/ranking";
import type {
  AvailabilityRow,
  CabinSlot,
  CellStatus,
  Grid,
  GridCell,
  GridMeta,
  NotFetchedPair,
  Orientation,
  RoutePair,
} from "@/lib/grid/types";

const DAY_MS = 86_400_000;

export interface BuildGridOptions {
  orientation?: Orientation;
  /** Clock for `meta.generated_at`; inject in tests. */
  now?: Date | string;
  /** Pairs seats.aero reported as not monitored (Get Routes); empty cells there say so. */
  unmonitored_pairs?: readonly { origin: string; dest: string }[];
  /** Pairs whose fetch did not complete (quota headroom, truncation); empty cells there say why. */
  not_fetched_pairs?: readonly NotFetchedPair[];
  api_calls_used?: number;
  served_from_cache?: boolean;
}

export function pairKey(origin: string, dest: string): string {
  return `${origin}-${dest}`;
}

/** Every origin × destination in query order (origins outer, destinations inner). */
export function enumeratePairs(query: Pick<QueryObject, "origins" | "destinations">): RoutePair[] {
  const pairs: RoutePair[] = [];
  for (const origin of query.origins) {
    for (const dest of query.destinations) {
      pairs.push({ origin, dest, key: pairKey(origin, dest) });
    }
  }
  return pairs;
}

function parseUtcDay(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`invalid ISO date: ${iso}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function formatUtcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Every calendar day from `from` to `to` inclusive. Pure UTC epoch arithmetic, so local DST
 * transitions can never produce a duplicated or skipped day. Empty when `to < from`.
 */
export function enumerateDates(from: string, to: string): string[] {
  const start = parseUtcDay(from);
  const end = parseUtcDay(to);
  const out: string[] = [];
  for (let t = start; t <= end; t += DAY_MS) out.push(formatUtcDay(t));
  return out;
}

/** The query's row-level filters (cabin, programs, max_miles, direct_only). Pair/date matching is separate. */
export function rowMatchesQuery(row: AvailabilityRow, query: QueryObject): boolean {
  if (!query.cabins.includes(row.cabin)) return false;
  if (query.programs !== undefined && !query.programs.includes(row.program)) return false;
  if (query.max_miles !== undefined && row.miles > query.max_miles) return false;
  if (query.direct_only && !row.direct) return false;
  return true;
}

function cellKey(origin: string, dest: string, date: string): string {
  return `${origin}|${dest}|${date}`;
}

/** True when the row is dynamic pricing the query did not ask for (hidden by the toggle). */
export function isHiddenDynamic(row: AvailabilityRow, query: Pick<QueryObject, "include_filtered">): boolean {
  return row.dynamic === true && !query.include_filtered;
}

/**
 * The per-cabin view of one cell (docs/UI_PLAN.md §6.2b): one slot per selected cabin, in the
 * canonical J F W Y order, each holding that cabin's own best row under the query's `sort_by`.
 *
 * The rule mirrors buildGrid's exactly, one cabin at a time: hidden dynamic rows only win a
 * slot that has nothing else, and that slot is marked `filtered` so the line can be drawn muted
 * with the `dyn` tag. A cabin with no rows at all yields `row: null` — the line says so rather
 * than disappearing, so the reader learns WHICH cabin is missing.
 *
 * Pure: `cell.all` is never mutated (the sort runs on a copy), and no memoization — it runs
 * inside the already-memoized Cell over an array that is typically one to six rows.
 */
export function bestPerCabin(
  cell: GridCell,
  cabins: readonly Cabin[],
  query: Pick<QueryObject, "include_filtered" | "sort_by">,
): CabinSlot[] {
  const cmp = compareRows(query.sort_by);
  return CABIN_ORDER.filter((c) => cabins.includes(c)).map((cabin) => {
    // buildGrid already sorted `all`, but bestPerCabin must not assume its input came from there.
    const mine = cell.all.filter((r) => r.cabin === cabin).sort(cmp);
    const shown = mine.filter((r) => !isHiddenDynamic(r, query));
    const row = shown[0] ?? mine[0] ?? null;
    return { cabin, row, filtered: shown.length === 0 && mine.length > 0 };
  });
}

export function buildGrid(
  rows: readonly AvailabilityRow[],
  query: QueryObject,
  opts: BuildGridOptions = {},
): Grid {
  const pairs = enumeratePairs(query);
  const dates = enumerateDates(query.date_from, query.date_to);
  const cmp = compareRows(query.sort_by);

  const byCell = new Map<string, AvailabilityRow[]>();
  for (const row of rows) {
    if (!rowMatchesQuery(row, query)) continue;
    const k = cellKey(row.origin, row.dest, row.date);
    const bucket = byCell.get(k);
    if (bucket) bucket.push(row);
    else byCell.set(k, [row]);
  }

  const unmonitored = new Set((opts.unmonitored_pairs ?? []).map((p) => pairKey(p.origin, p.dest)));
  const notFetched = new Map<string, string>();
  for (const nf of opts.not_fetched_pairs ?? []) {
    const key = pairKey(nf.pair.origin, nf.pair.dest);
    if (!notFetched.has(key)) notFetched.set(key, nf.reason);
  }

  let oldest: string | null = null;
  let newest: string | null = null;
  const cells: GridCell[][] = dates.map((date) =>
    pairs.map((pair) => {
      const all = [...(byCell.get(cellKey(pair.origin, pair.dest, date)) ?? [])].sort(cmp);
      for (const r of all) {
        if (oldest === null || r.computed_last_seen < oldest) oldest = r.computed_last_seen;
        if (newest === null || r.computed_last_seen > newest) newest = r.computed_last_seen;
      }
      // The best row is the best of what the query asked for; hidden dynamic rows only win a
      // cell that has nothing else (the "filtered" state).
      const shown = all.filter((r) => !isHiddenDynamic(r, query));
      let status: CellStatus;
      let best: AvailabilityRow | null;
      if (shown.length > 0) {
        status = "ok";
        best = shown[0] ?? null;
      } else if (all.length > 0) {
        status = "filtered";
        best = all[0] ?? null;
      } else if (unmonitored.has(pair.key)) {
        status = "unmonitored";
        best = null;
      } else if (notFetched.has(pair.key)) {
        status = "not_fetched";
        best = null;
      } else {
        status = "none";
        best = null;
      }
      const cell: GridCell = { origin: pair.origin, dest: pair.dest, date, status, best, all };
      if (status === "not_fetched") cell.reason = notFetched.get(pair.key);
      return cell;
    }),
  );

  const now = opts.now === undefined ? new Date() : new Date(opts.now);
  const meta: GridMeta = {
    generated_at: now.toISOString(),
    unmonitored_pairs: pairs.filter((p) => unmonitored.has(p.key)),
    not_fetched_pairs: pairs
      .filter((p) => !unmonitored.has(p.key) && notFetched.has(p.key))
      .map((p) => ({ pair: { origin: p.origin, dest: p.dest }, reason: notFetched.get(p.key) ?? "" })),
    oldest_seen: oldest,
    newest_seen: newest,
    api_calls_used: opts.api_calls_used ?? 0,
    served_from_cache: opts.served_from_cache ?? false,
  };

  const grid: Grid = {
    orientation: "dates",
    rows: dates,
    cols: pairs.map((p) => p.key),
    cells,
    pairs,
    dates,
    query,
    meta,
  };
  return (opts.orientation ?? "dates") === "routes" ? transposeGrid(grid) : grid;
}

/** Flip rows/cols (dates ↔ routes). Cells are shared, not copied. */
export function transposeGrid(grid: Grid): Grid {
  const cells: GridCell[][] = grid.cols.map((_, c) =>
    grid.rows.map((_, r) => {
      const cell = grid.cells[r]?.[c];
      if (!cell) throw new Error(`grid is ragged: no cell at [${r}][${c}]`);
      return cell;
    }),
  );
  return {
    ...grid,
    orientation: grid.orientation === "dates" ? "routes" : "dates",
    rows: grid.cols,
    cols: grid.rows,
    cells,
  };
}

/** Cell lookup independent of orientation; undefined when the pair or date is not in the grid. */
export function cellAt(
  grid: Grid,
  pairKeyOrPair: string | RoutePair,
  date: string,
): GridCell | undefined {
  const key = typeof pairKeyOrPair === "string" ? pairKeyOrPair : pairKeyOrPair.key;
  const pairIdx = grid.pairs.findIndex((p) => p.key === key);
  const dateIdx = grid.dates.indexOf(date);
  if (pairIdx < 0 || dateIdx < 0) return undefined;
  return grid.orientation === "dates"
    ? grid.cells[dateIdx]?.[pairIdx]
    : grid.cells[pairIdx]?.[dateIdx];
}

/** Iterate cells in canonical (date, pair) order regardless of orientation. */
export function* iterateCells(grid: Grid): Generator<GridCell> {
  for (const date of grid.dates) {
    for (const pair of grid.pairs) {
      const cell = cellAt(grid, pair, date);
      if (cell) yield cell;
    }
  }
}

export interface GridStats {
  /** Cell whose best row has the fewest miles (fees tiebreaker), or null when nothing is available. */
  cheapest: GridCell | null;
  ok_cells: number;
  none_cells: number;
  unmonitored_cells: number;
  not_fetched_cells: number;
  /** Cells whose only rows are hidden dynamic pricing (the toggle would reveal them). */
  filtered_cells: number;
  total_cells: number;
  oldest_seen: string | null;
  newest_seen: string | null;
}

export function gridStats(grid: Grid): GridStats {
  const cmp = compareRows("miles_asc");
  const stats: GridStats = {
    cheapest: null,
    ok_cells: 0,
    none_cells: 0,
    unmonitored_cells: 0,
    not_fetched_cells: 0,
    filtered_cells: 0,
    total_cells: 0,
    oldest_seen: null,
    newest_seen: null,
  };
  let cheapestBest: AvailabilityRow | null = null;
  for (const cell of iterateCells(grid)) {
    stats.total_cells += 1;
    if (cell.status === "ok") stats.ok_cells += 1;
    else if (cell.status === "none") stats.none_cells += 1;
    else if (cell.status === "unmonitored") stats.unmonitored_cells += 1;
    else if (cell.status === "not_fetched") stats.not_fetched_cells += 1;
    else if (cell.status === "filtered") stats.filtered_cells += 1;
    // "cheapest" is what the user can act on: hidden dynamic rows are not counted.
    if (cell.status === "ok" && cell.best && (cheapestBest === null || cmp(cell.best, cheapestBest) < 0)) {
      cheapestBest = cell.best;
      stats.cheapest = cell;
    }
    for (const r of cell.all) {
      if (stats.oldest_seen === null || r.computed_last_seen < stats.oldest_seen)
        stats.oldest_seen = r.computed_last_seen;
      if (stats.newest_seen === null || r.computed_last_seen > stats.newest_seen)
        stats.newest_seen = r.computed_last_seen;
    }
  }
  return stats;
}
