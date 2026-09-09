/**
 * Typed browser-side calls to the grid API. Every failure becomes an `ApiFailure` value
 * (never a throw) so the page can render the matching empty state.
 */
import type { Grid, Orientation } from "@awardgrid/core/grid/types";
import { isNotice, type Notice } from "@awardgrid/core/notices";
import type { QueryObject } from "@awardgrid/core/query/schema";
import type { Provenance } from "@awardgrid/core/query/deterministic";
import type { QuotaSnapshot, TripsForUserResult } from "@/lib/server/find";

export type ApiFailureCode = "unauthorized" | "invalid_body" | "no_key" | "quota" | "parse" | "seatsaero" | "internal" | "network";

export interface ApiFailure {
  ok: false;
  status: number;
  error: ApiFailureCode;
  /** parse: missing field names */
  missing?: string[];
  /** parse / seatsaero: safe, key-free message (English) */
  message?: string;
  /** parse: the structured form of `message`, translated by the UI */
  notice?: Notice;
  /** quota */
  resetAt?: string;
  remaining?: number;
  requested?: number;
  /** seatsaero */
  kind?: string;
}

export type ApiResult<T> = { ok: true; value: T } | ApiFailure;

export interface ParseResponse {
  query: QueryObject;
  provenance: Record<string, Provenance>;
  /** English fallbacks; the UI prefers `notices`. */
  warnings: string[];
  notices?: Notice[];
  used_llm: boolean;
}

export interface FindResponse {
  grid: Grid;
  warnings: string[];
  notices?: Notice[];
  quota: QuotaSnapshot;
  /** Phase 6 additive: the dynamic-pricing scope is cached, so the toggle costs no calls. */
  dynamic_rows_available?: boolean;
  /** Phase 6 additive: programs whose Get Routes call failed this run. */
  programs_failed?: string[];
  /** Phase 6 additive: programs monitoring each pair (pair key → count) when the routes catalog knows every requested program; null otherwise. */
  programs_by_pair?: Record<string, number> | null;
  /** Phase 6 additive: programs the run checked for these pairs (the empty-results sentence). */
  programs_checked?: number;
}

/** A warning as the UI renders it: translated when structured, the server's English otherwise. */
export type UiNotice = { kind: "notice"; notice: Notice } | { kind: "text"; text: string };

/** Pair `notices` with their English `warnings`; entries without a valid notice fall back to text. */
export function uiNotices(res: { warnings: string[]; notices?: Notice[] }): UiNotice[] {
  const notices = Array.isArray(res.notices) ? res.notices : [];
  if (notices.length === res.warnings.length && notices.every(isNotice)) return notices.map((notice) => ({ kind: "notice", notice }));
  return res.warnings.map((text) => ({ kind: "text", text }));
}

const KNOWN: readonly ApiFailureCode[] = ["unauthorized", "invalid_body", "no_key", "quota", "parse", "seatsaero", "internal"];

async function failureFrom(res: Response): Promise<ApiFailure> {
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const raw = typeof body.error === "string" ? body.error : "";
  const error = (KNOWN as readonly string[]).includes(raw) ? (raw as ApiFailureCode) : res.status === 401 ? "unauthorized" : "internal";
  const out: ApiFailure = { ok: false, status: res.status, error };
  if (Array.isArray(body.missing)) out.missing = body.missing.filter((m): m is string => typeof m === "string");
  if (typeof body.message === "string") out.message = body.message;
  if (isNotice(body.notice)) out.notice = body.notice;
  if (typeof body.resetAt === "string") out.resetAt = body.resetAt;
  if (typeof body.remaining === "number") out.remaining = body.remaining;
  if (typeof body.requested === "number") out.requested = body.requested;
  if (typeof body.kind === "string") out.kind = body.kind;
  return out;
}

async function request<T>(input: string, init: RequestInit, signal?: AbortSignal): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(input, { credentials: "same-origin", ...init, ...(signal ? { signal } : {}) });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return { ok: false, status: 0, error: "network" };
  }
  if (!res.ok) return failureFrom(res);
  return { ok: true, value: (await res.json()) as T };
}

function json(body: unknown): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

export function apiParse(text: string, today: string, signal?: AbortSignal): Promise<ApiResult<ParseResponse>> {
  return request<ParseResponse>("/api/parse", json({ text, today }), signal);
}

export function apiFind(query: QueryObject, orientation: Orientation, signal?: AbortSignal): Promise<ApiResult<FindResponse>> {
  return request<FindResponse>("/api/find", json({ query, orientation }), signal);
}

export function apiTrips(
  availabilityId: string,
  cabin: string,
  includeFiltered: boolean,
  minCabinPct: number,
  signal?: AbortSignal,
): Promise<ApiResult<TripsForUserResult>> {
  // Get Trips must ask in the SAME scope the grid was produced in, or the drawer's flight list
  // contradicts the cell that opened it. 100 is the API default and is left off the wire.
  const qs = new URLSearchParams({
    cabin,
    ...(includeFiltered ? { include_filtered: "true" } : {}),
    ...(minCabinPct < 100 ? { min_cabin_pct: String(minCabinPct) } : {}),
  });
  return request<TripsForUserResult>(`/api/trips/${encodeURIComponent(availabilityId)}?${qs}`, { method: "GET" }, signal);
}

/** CSV export: returns the blob + the server's filename, or a failure. */
export async function apiExport(query: QueryObject, orientation: Orientation): Promise<ApiResult<{ blob: Blob; filename: string }>> {
  let res: Response;
  try {
    res = await fetch("/api/export", { credentials: "same-origin", ...json({ query, orientation }) });
  } catch {
    return { ok: false, status: 0, error: "network" };
  }
  if (!res.ok) return failureFrom(res);
  const disposition = res.headers.get("content-disposition") ?? "";
  const m = /filename="([^"]+)"/.exec(disposition);
  return { ok: true, value: { blob: await res.blob(), filename: m?.[1] ?? "awardgrid.csv" } };
}
