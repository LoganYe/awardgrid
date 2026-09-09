/**
 * Per-user availability cache (kickoff §3 `availability_cache`, §0.2 #2: cache is per user
 * key, never global). The userId is part of EVERY key; nothing here can read across users.
 *
 * Two things are cached:
 *   - rows      : normalized AvailabilityRow, PK (user, program, origin, dest, date, cabin)
 *   - coverage  : "for pair X we fetched date range D, cabins C, programs P at time T", so an
 *                 EMPTY result is also remembered and does not trigger a refetch within the TTL.
 *
 * The in-memory store is for tests and the CLI; the web app supplies a SQLite-backed store
 * implementing the same interface.
 */
import { DEFAULT_MIN_CABIN_PCT, type Cabin } from "../query/schema";
import type { AvailabilityRow } from "../grid/types";

export const DEFAULT_CACHE_TTL_MINUTES = 45;

export interface CacheQuery {
  origins: readonly string[];
  dests: readonly string[];
  date_from: string;
  date_to: string; // inclusive
  cabins: readonly Cabin[];
  /** undefined = every program. */
  programs?: readonly string[];
  /** When true only rows with a direct flight match (and only direct-only coverage counts). */
  direct_only?: boolean;
  /**
   * Rows/coverage fetched with include_filtered=true are a DIFFERENT scope, not a superset:
   * the API adds dynamically-priced results without marking them, so nothing can be filtered
   * locally in either direction. Exact match only. Absent = false.
   */
  include_filtered?: boolean;
  /**
   * seats.aero `min_cabin_pct`. Like include_filtered this is an EXACT-MATCH scope in both
   * directions, not a superset relation: at 100 the API drops every itinerary with mixed-cabin
   * distance, so a 100 pull is missing rows a 70 pull returns, and a 70 pull carries rows a 100
   * query must not be shown. Absent = 100 (the API default), which is what every row and record
   * written before issue #18 is.
   */
  min_cabin_pct?: number;
}

export interface CoverageRecord {
  origin: string;
  dest: string;
  date_from: string;
  date_to: string;
  cabins: Cabin[];
  /** null = the fetch covered every program the key can access. */
  programs: string[] | null;
  /** True when the fetch asked seats.aero for direct flights only (covers only direct queries). */
  direct_only: boolean;
  /** True when the fetch carried include_filtered=true (see CacheQuery). Absent = false. */
  include_filtered?: boolean;
  /** The min_cabin_pct the fetch carried (see CacheQuery). Absent = 100. */
  min_cabin_pct?: number;
  fetched_at: string; // ISO
}

export interface CachedRows {
  rows: AvailabilityRow[];
  /** Oldest fetched_at among `rows`, null when there are none. */
  fetched_at_min: string | null;
}

/**
 * The half of a CacheQuery that is row IDENTITY rather than a filter: two rows for the same
 * (program, pair, date, cabin) fetched at different include_filtered / min_cabin_pct are
 * DIFFERENT rows, stored side by side (see the SQLite store's `encodeProgram`). Anything that
 * writes to a row it did not read through a full CacheQuery has to carry this, or it writes
 * across scopes.
 */
export interface RowScope {
  /** Absent = false. */
  include_filtered?: boolean;
  /** Absent = 100 (the API default). */
  min_cabin_pct?: number;
}

/** True when `r` belongs to exactly `scope` — both flags, in both directions, never a superset. */
export function rowInScope(r: Pick<AvailabilityRow, "include_filtered" | "min_cabin_pct">, scope: RowScope): boolean {
  return (
    (scope.include_filtered ?? false) === (r.include_filtered ?? false) &&
    (scope.min_cabin_pct ?? DEFAULT_MIN_CABIN_PCT) === (r.min_cabin_pct ?? DEFAULT_MIN_CABIN_PCT)
  );
}

/**
 * The row identity a fee write addresses: the availability_cache PK (program + its scope
 * suffixes, pair, date, cabin) PLUS `source_id`. The id is part of the address on purpose — a
 * fee describes one seats.aero Availability, so if a refresh has meanwhile replaced the cell
 * with a different availability the write must miss rather than mislabel the new one.
 */
export type RowFeesKey = Pick<
  AvailabilityRow,
  "program" | "origin" | "dest" | "date" | "cabin" | "source_id" | "include_filtered" | "min_cabin_pct"
>;

/** The three columns Get Trips can learn — the only ones `updateRowFees` may touch. */
export interface RowFees {
  fees_cents: number | null;
  currency: string | null;
  booking_url: string | null;
}

export interface AvailabilityCacheStore {
  getRows(userId: string, q: CacheQuery): Promise<CachedRows>;
  /**
   * The cached rows for ONE seats.aero Availability ID (`source_id`) inside ONE scope — up to
   * one per cabin, since availabilityToRows stamps every cabin's row with the same ID. This is
   * the lookup for Get Trips, which knows the availability id and nothing else about the cell
   * (issue #52). `scope` is mandatory: without it the same availability's filtered / mixed-cabin
   * rows would be returned too, and a caller could write a fee across a scope boundary.
   */
  getRowsBySourceId(userId: string, sourceId: string, scope: RowScope): Promise<AvailabilityRow[]>;
  /**
   * Set ONLY `fees_cents`, `currency` and `booking_url` on the one row `key` addresses, and
   * NEVER insert (issue #52). Get Trips learns a fee by reading the row and writing it back;
   * re-upserting the whole row would roll back anything a Cached Search refresh wrote in the
   * gap between the two, and would resurrect a row that refresh had deleted because the award
   * is gone. A targeted UPDATE cannot: every other column keeps whatever the refresh put there,
   * and a deleted or re-identified row simply matches nothing. Returns true when a row matched.
   */
  updateRowFees(userId: string, key: RowFeesKey, fees: RowFees): Promise<boolean>;
  /** Upsert by PK. */
  putRows(userId: string, rows: readonly AvailabilityRow[]): Promise<void>;
  /** Remove every row matching `q` (used before re-inserting a freshly fetched scope). */
  deleteRows(userId: string, q: CacheQuery): Promise<void>;
  /** Coverage records for these pairs, any age. */
  getCoverage(userId: string, pairs: ReadonlyArray<{ origin: string; dest: string }>): Promise<CoverageRecord[]>;
  markPairsFetched(userId: string, records: readonly CoverageRecord[]): Promise<void>;
}

export function rowKey(
  r: Pick<AvailabilityRow, "program" | "origin" | "dest" | "date" | "cabin" | "include_filtered" | "min_cabin_pct">,
): string {
  const pct = r.min_cabin_pct ?? DEFAULT_MIN_CABIN_PCT;
  return [r.program, r.origin, r.dest, r.date, r.cabin, r.include_filtered ? "filtered" : "", pct === DEFAULT_MIN_CABIN_PCT ? "" : `pct${pct}`].join("|");
}

export function rowMatches(r: AvailabilityRow, q: CacheQuery): boolean {
  return (
    q.origins.includes(r.origin) &&
    q.dests.includes(r.dest) &&
    r.date >= q.date_from &&
    r.date <= q.date_to &&
    q.cabins.includes(r.cabin) &&
    (q.programs === undefined || q.programs.includes(r.program)) &&
    (!q.direct_only || r.direct) &&
    (q.include_filtered ?? false) === (r.include_filtered ?? false) &&
    (q.min_cabin_pct ?? DEFAULT_MIN_CABIN_PCT) === (r.min_cabin_pct ?? DEFAULT_MIN_CABIN_PCT)
  );
}

export class InMemoryAvailabilityCache implements AvailabilityCacheStore {
  readonly #rows = new Map<string, Map<string, AvailabilityRow>>();
  readonly #coverage = new Map<string, CoverageRecord[]>();

  #rowsOf(userId: string): Map<string, AvailabilityRow> {
    let m = this.#rows.get(userId);
    if (!m) {
      m = new Map();
      this.#rows.set(userId, m);
    }
    return m;
  }

  async getRows(userId: string, q: CacheQuery): Promise<CachedRows> {
    const rows = [...this.#rowsOf(userId).values()].filter((r) => rowMatches(r, q));
    return { rows, fetched_at_min: minFetchedAt(rows) };
  }

  async getRowsBySourceId(userId: string, sourceId: string, scope: RowScope): Promise<AvailabilityRow[]> {
    return [...this.#rowsOf(userId).values()].filter((r) => r.source_id === sourceId && rowInScope(r, scope));
  }

  async updateRowFees(userId: string, key: RowFeesKey, fees: RowFees): Promise<boolean> {
    const m = this.#rowsOf(userId);
    const existing = m.get(rowKey(key));
    if (!existing || existing.source_id !== key.source_id) return false;
    m.set(rowKey(key), { ...existing, fees_cents: fees.fees_cents, currency: fees.currency, booking_url: fees.booking_url });
    return true;
  }

  async putRows(userId: string, rows: readonly AvailabilityRow[]): Promise<void> {
    const m = this.#rowsOf(userId);
    for (const r of rows) m.set(rowKey(r), { ...r, airlines: [...r.airlines] });
  }

  async deleteRows(userId: string, q: CacheQuery): Promise<void> {
    const m = this.#rowsOf(userId);
    for (const [k, r] of m) if (rowMatches(r, q)) m.delete(k);
  }

  async getCoverage(userId: string, pairs: ReadonlyArray<{ origin: string; dest: string }>): Promise<CoverageRecord[]> {
    const all = this.#coverage.get(userId) ?? [];
    return all.filter((c) => pairs.some((p) => p.origin === c.origin && p.dest === c.dest));
  }

  async markPairsFetched(userId: string, records: readonly CoverageRecord[]): Promise<void> {
    const list = this.#coverage.get(userId) ?? [];
    list.push(...records.map((r) => ({ ...r, cabins: [...r.cabins], programs: r.programs ? [...r.programs] : null })));
    this.#coverage.set(userId, list);
  }
}

export function minFetchedAt(rows: readonly AvailabilityRow[]): string | null {
  let min: string | null = null;
  for (const r of rows) if (min === null || r.fetched_at < min) min = r.fetched_at;
  return min;
}

/** True when every row was fetched within `ttlMinutes` of `now`; false for an empty list. */
export function isFresh(rows: readonly AvailabilityRow[], ttlMinutes: number, now: Date): boolean {
  if (rows.length === 0) return false;
  const cutoff = now.getTime() - ttlMinutes * 60_000;
  return rows.every((r) => Date.parse(r.fetched_at) >= cutoff);
}

export function isFreshTimestamp(iso: string, ttlMinutes: number, now: Date): boolean {
  return Date.parse(iso) >= now.getTime() - ttlMinutes * 60_000;
}

/**
 * Does a coverage record fully cover `q` for its pair? Superset on dates/cabins/programs;
 * a record with programs=null (all programs) covers any program list.
 */
export function coverageSatisfies(c: CoverageRecord, q: CacheQuery, ttlMinutes: number, now: Date): boolean {
  if (!isFreshTimestamp(c.fetched_at, ttlMinutes, now)) return false;
  if (c.direct_only && !q.direct_only) return false;
  if ((c.include_filtered ?? false) !== (q.include_filtered ?? false)) return false;
  if ((c.min_cabin_pct ?? DEFAULT_MIN_CABIN_PCT) !== (q.min_cabin_pct ?? DEFAULT_MIN_CABIN_PCT)) return false;
  if (c.date_from > q.date_from || c.date_to < q.date_to) return false;
  if (!q.cabins.every((cab) => c.cabins.includes(cab))) return false;
  if (c.programs === null) return true;
  if (q.programs === undefined) return false;
  return q.programs.every((p) => c.programs!.includes(p));
}

/** Pairs of `q` that have NO fresh covering record. Empty array = fully covered. */
export function uncoveredPairs(
  q: CacheQuery,
  coverage: readonly CoverageRecord[],
  ttlMinutes: number,
  now: Date,
): Array<{ origin: string; dest: string }> {
  const out: Array<{ origin: string; dest: string }> = [];
  for (const origin of q.origins) {
    for (const dest of q.dests) {
      const ok = coverage.some(
        (c) => c.origin === origin && c.dest === dest && coverageSatisfies(c, q, ttlMinutes, now),
      );
      if (!ok) out.push({ origin, dest });
    }
  }
  return out;
}

/** Parse CACHE_TTL_MINUTES, falling back to 45 on garbage. */
export function cacheTtlMinutesFromEnv(env: Record<string, string | undefined> = process.env): number {
  const raw = env.CACHE_TTL_MINUTES;
  const n = raw === undefined ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CACHE_TTL_MINUTES;
}
