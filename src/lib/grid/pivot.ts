/**
 * Pivot normalized AvailabilityRow[] into the Grid (kickoff §4.4).
 * Default orientation: rows = dates, cols = origin→dest pairs; "routes" transposes.
 * One cell = best row across programs for the selected cabins, per `query.sort_by`.
 */
import type { QueryObject } from "@/lib/query/schema";
import { compareRows } from "@/lib/grid/ranking";
import type {
  AvailabilityRow,
  Grid,
  GridCell,
  GridMeta,
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

  let oldest: string | null = null;
  let newest: string | null = null;
  const cells: GridCell[][] = dates.map((date) =>
    pairs.map((pair) => {
      const all = [...(byCell.get(cellKey(pair.origin, pair.dest, date)) ?? [])].sort(cmp);
      for (const r of all) {
        if (oldest === null || r.computed_last_seen < oldest) oldest = r.computed_last_seen;
        if (newest === null || r.computed_last_seen > newest) newest = r.computed_last_seen;
      }
      const status = all.length > 0 ? "ok" : unmonitored.has(pair.key) ? "unmonitored" : "none";
      return { origin: pair.origin, dest: pair.dest, date, status, best: all[0] ?? null, all };
    }),
  );

  const now = opts.now === undefined ? new Date() : new Date(opts.now);
  const meta: GridMeta = {
    generated_at: now.toISOString(),
    unmonitored_pairs: pairs.filter((p) => unmonitored.has(p.key)),
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
    if (cell.best && (cheapestBest === null || cmp(cell.best, cheapestBest) < 0)) {
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
