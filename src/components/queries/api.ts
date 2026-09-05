/**
 * Browser-side calls for saved queries and Telegram linking. Thin wrappers over the settings
 * apiJson helper: errors are `{ error: code, resetAt? }`, never raw response text.
 */
import { apiJson, type ApiResult } from "@/components/settings/api";
import type { QueryObject } from "@/lib/query/schema";
import type { RunSummary, SavedQuerySummary, TelegramStatus } from "@/lib/server/queries";

export type { ApiResult, RunSummary, SavedQuerySummary, TelegramStatus };

export interface SaveQueryBody {
  name: string;
  query: QueryObject;
  schedule_cron: string;
  notify_on: "new_cells" | "price_drop" | "both";
  drop_threshold_pct: number;
}

export type PatchQueryBody = Partial<Omit<SaveQueryBody, "query"> & { enabled: boolean }>;

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
