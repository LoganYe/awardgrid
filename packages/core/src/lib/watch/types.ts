/**
 * Snapshot + diff types, extracted verbatim from `src/lib/scheduler/types.ts` so that the diff
 * logic can live in the core where every shell can reach it (docs/PIVOT.md §3: "`diff.ts` ports
 * with one change").
 *
 * Only these four moved. The rest of the scheduler's types — `Transport`, `DigestFormatter`,
 * `RunDeps`, `SkippedReason` — describe a cron, a database and a Telegram bot, none of which
 * exist in a client app. `src/lib/scheduler/types.ts` re-exports these four so nothing in the web
 * app changed shape.
 */

/** One award cell as stored in `query_runs.cells_json` — the diff basis. */
export interface CellSnapshot {
  /** "program|origin|dest|date|cabin" */
  key: string;
  miles: number;
  fees_cents: number | null;
  seats_left: number;
  computed_last_seen: string;
}

export interface PriceDrop {
  key: string;
  before: CellSnapshot;
  after: CellSnapshot;
  /** Percent decrease in miles, rounded to 2 decimals (e.g. 12.5). */
  pct: number;
}

export interface SnapshotDiff {
  /** Present now, absent in the baseline. */
  new: CellSnapshot[];
  /** Present in the baseline, absent now. */
  dropped: CellSnapshot[];
  /** Same key, miles decreased by at least the threshold. */
  price_drops: PriceDrop[];
  /** Cells present in both with no qualifying change. */
  unchanged: number;
}

export interface DiffOptions {
  /** Minimum miles decrease (percent of the baseline) that counts as a price drop. */
  dropThresholdPct: number;
}
