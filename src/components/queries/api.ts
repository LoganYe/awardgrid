/**
 * Browser-side calls for saved queries and Telegram linking. Thin wrappers over the settings
 * apiJson helper: errors are `{ error: code, resetAt? }`, never raw response text.
 */
import { apiJson, type ApiResult } from "@/components/settings/api";
import { toDiffRow } from "@/components/queries/format";
import type { AvailabilityRow } from "@awardgrid/core/grid/types";
import type { QueryObject } from "@awardgrid/core/query/schema";
import type { RunSummary, SavedQuerySummary, TelegramStatus } from "@/lib/server/queries";

export type { ApiResult, RunSummary, SavedQuerySummary, TelegramStatus };

export interface SaveQueryBody {
  name: string;
  query: QueryObject;
  schedule_cron: string;
  notify_on: "new_cells" | "price_drop" | "both";
  drop_threshold_pct: number;
}

export type PatchQueryBody = Partial<SaveQueryBody & { enabled: boolean }>;

/**
 * A saved query as the Queries page reads it. `SavedQuerySummary` already carries `next_run_at`
 * and `schedule_label`, so this is an alias rather than an extension; it exists so the page and
 * its row components name one type.
 */
export type QueryRowSummary = SavedQuerySummary;

/** One recorded run. `calls_used` is null until `query_runs` records a call count. */
export type RunRow = RunSummary;

/** One cell that got cheaper, at its new price, with what it cost before. */
export interface RunDiffPriceDrop {
  row: AvailabilityRow;
  before_miles: number;
  pct: number;
}

/** The last run's cell changes, ready for the real grid cell component. */
export interface RunDiff {
  new: AvailabilityRow[];
  dropped: AvailabilityRow[];
  /** Cells present in both runs at a lower price — the third thing the scheduler notifies on. */
  price_drops: RunDiffPriceDrop[];
}

/** What the expanded row shows: the last 20 runs and the last run's diff. */
export interface QueryDetails {
  runs: RunRow[];
  diff: RunDiff | null;
}

/**
 * GET /api/queries/[id]/runs → `{ runs, diff }`, normalized. The diff is accepted at the top
 * level (where the route puts it) or on the newest run, and entries that are still raw
 * `cells_json` snapshots are expanded into availability rows here, so the panel renders the
 * same way whichever shape arrives.
 */
export function normalizeDetails(payload: unknown): QueryDetails {
  const o = (typeof payload === "object" && payload !== null ? payload : {}) as Record<string, unknown>;
  const runs = Array.isArray(o.runs) ? (o.runs as RunRow[]) : [];
  const newest = runs[0];
  const rawDiff = (o.diff ?? (newest as unknown as { diff?: unknown } | undefined)?.diff) as
    | { new?: unknown; dropped?: unknown; price_drops?: unknown }
    | undefined;
  const seen = newest?.ran_at ?? new Date().toISOString();
  if (!rawDiff) return { runs, diff: null };
  const expand = (list: unknown): AvailabilityRow[] =>
    Array.isArray(list)
      ? list.flatMap((raw) => {
          const row = toDiffRow(raw, seen);
          return row ? [row] : [];
        })
      : [];
  const drops = Array.isArray(rawDiff.price_drops)
    ? rawDiff.price_drops.flatMap((raw) => {
        const o2 = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
        const row = toDiffRow(o2.row, seen);
        if (!row) return [];
        const before = typeof o2.before_miles === "number" ? o2.before_miles : 0;
        const pct = typeof o2.pct === "number" ? o2.pct : 0;
        return [{ row, before_miles: before, pct }];
      })
    : [];
  return { runs, diff: { new: expand(rawDiff.new), dropped: expand(rawDiff.dropped), price_drops: drops } };
}

export function apiListQueries(): Promise<ApiResult<{ queries: SavedQuerySummary[] }>> {
  return apiJson("/api/queries");
}

export function apiCreateQuery(body: SaveQueryBody): Promise<ApiResult<{ query: SavedQuerySummary }>> {
  return apiJson("/api/queries", { method: "POST", body });
}

export function apiPatchQuery(id: string, body: PatchQueryBody): Promise<ApiResult<{ query: SavedQuerySummary }>> {
  return apiJson(`/api/queries/${encodeURIComponent(id)}`, { method: "PATCH", body });
}

export function apiDeleteQuery(id: string): Promise<ApiResult<undefined>> {
  return apiJson(`/api/queries/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function apiRunQuery(id: string): Promise<ApiResult<{ run: RunSummary }>> {
  return apiJson(`/api/queries/${encodeURIComponent(id)}/run`, { method: "POST" });
}

export function apiListRuns(id: string): Promise<ApiResult<{ runs: RunSummary[] }>> {
  return apiJson(`/api/queries/${encodeURIComponent(id)}/runs`);
}

export interface TelegramLinkResult {
  deepLink: string | null;
  mock: boolean;
  expiresAt?: string;
}

export function apiTelegramLink(): Promise<ApiResult<TelegramLinkResult>> {
  return apiJson("/api/telegram/link", { method: "POST" });
}

export function apiTelegramUnlink(): Promise<ApiResult<undefined>> {
  return apiJson("/api/telegram/link", { method: "DELETE" });
}

export function apiTelegramStatus(): Promise<ApiResult<TelegramStatus>> {
  return apiJson("/api/telegram/status");
}
