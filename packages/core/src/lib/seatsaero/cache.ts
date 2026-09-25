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
import { isRealDate, parseInstant } from "../workspace/semantics";

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
  /**
   * What the fetch that wrote this record proved (UI/UX v1 T03): it ran to its end, or it stopped at the page cap
   * or for quota. Absent on records written before evidence existed — those still satisfy a cache lookup exactly
   * as before, but prove nothing about completeness (workspace/coverage.ts recordEvidence → unknown).
   */
  evidence?: CoverageRecordEvidence;
}

export type CoverageRecordEvidence = { state: "complete"; reason: "exhausted" } | { state: "partial"; reason: "page_cap" | "quota" | "upstream_error" };

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
  /**
   * deleteRows(scope) + putRows(rows) + markPairsFetched(records) as ONE unit: either all of it happens or none
   * of it does (UI/UX v1 T03). Without this, a failure after the delete leaves an earlier fetch's "complete"
   * record standing over rows that are gone. Optional so existing stores and test doubles keep compiling; runFind
   * uses it when present and falls back to the three calls otherwise.
   */
  replaceScope?(userId: string, scope: CacheQuery, rows: readonly AvailabilityRow[], records: readonly CoverageRecord[]): Promise<void>;
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
    this.#mark(userId, records);
  }

  /**
   * The same three public calls runFind used to make, started back to back with no await between them. Each body
   * runs to completion synchronously (none of them awaits anything), so nothing can interleave between the delete
   * and the mark; and anything observing the store (tests spy on deleteRows) still sees the calls it expects.
   */
  async replaceScope(userId: string, scope: CacheQuery, rows: readonly AvailabilityRow[], records: readonly CoverageRecord[]): Promise<void> {
    const steps = [this.deleteRows(userId, scope), this.putRows(userId, rows), this.markPairsFetched(userId, records)];
    await Promise.all(steps);
  }

  #mark(userId: string, records: readonly CoverageRecord[]): void {
    const list = this.#coverage.get(userId) ?? [];
    list.push(...records.map((r) => ({ ...r, cabins: [...r.cabins], programs: r.programs ? [...r.programs] : null })));
    this.#coverage.set(userId, list);
  }

  /**
   * Plain-object view of everything held, for a client shell that has to survive being closed
   * (docs/PIVOT.md §6 Phase 2: "in-memory cache with a JSON snapshot"). Pure — it does no I/O
   * and knows nothing about where the bytes go; the shell owns that.
   *
   * This lives here rather than in the shell so that persistence cannot drift from the scope
   * algebra. A shell that kept its own parallel copy of the rows would be re-deriving
   * `rowKey`/`rowMatches` semantics by hand, and the include_filtered / min_cabin_pct scopes are
   * exactly where that goes quietly wrong.
   */
  snapshot(): CacheSnapshot {
    return {
      version: CACHE_SNAPSHOT_VERSION,
      users: [...this.#rows.keys(), ...this.#coverage.keys()]
        .filter((id, i, all) => all.indexOf(id) === i)
        .map((userId) => ({
          userId,
          rows: [...(this.#rows.get(userId)?.values() ?? [])],
          coverage: this.#coverage.get(userId) ?? [],
        })),
    };
  }

  /**
   * Replace the contents with a snapshot. Returns the number of rows restored. A snapshot whose
   * version does not match is DISCARDED rather than migrated: the cost of throwing it away is one
   * cold search, and the cost of misreading an old shape is serving rows under the wrong scope.
   */
  restore(snapshot: CacheSnapshot | null | undefined): number {
    this.#rows.clear();
    this.#coverage.clear();
    if (!snapshot || snapshot.version !== CACHE_SNAPSHOT_VERSION || !Array.isArray(snapshot.users)) return 0;
    let restored = 0;
    for (const entry of snapshot.users) {
      if (!entry || typeof entry.userId !== "string") continue;
      const m = this.#rowsOf(entry.userId);
      // Entry by entry: one damaged row or record is dropped (a cold search for that scope at worst) instead of
      // throwing here, which would stop the app launching (UI/UX v1 T03, "损坏新entry隔离后保留旧有效内容").
      for (const r of Array.isArray(entry.rows) ? entry.rows : []) {
        if (!isRestorableRow(r)) continue;
        m.set(rowKey(r), { ...r, airlines: [...r.airlines] });
        restored += 1;
      }
      const coverage = (Array.isArray(entry.coverage) ? entry.coverage : []).flatMap((c) => restorableRecord(c) ?? []);
      if (coverage.length) this.#coverage.set(entry.userId, coverage);
    }
    return restored;
  }
}

/** Bump when the shape of a persisted row or coverage record changes; old snapshots are dropped. */
export const CACHE_SNAPSHOT_VERSION = 1;

const RESTORE_CABINS: ReadonlySet<unknown> = new Set(["Y", "W", "J", "F"]);
const isStr = (v: unknown): v is string => typeof v === "string";

/**
 * What a restored row needs so that restoring it cannot throw or file it under a garbage key: the identity fields
 * rowKey reads, a real cabin, finite miles and an airlines list. Deliberately no stricter than the snapshot contract
 * the pinned cache-snapshot tests hold (they restore rows without computed_last_seen): damage is dropped, older
 * shapes are not.
 */
function isRestorableRow(r: unknown): r is AvailabilityRow {
  if (typeof r !== "object" || r === null) return false;
  const v = r as Record<string, unknown>;
  return (
    isStr(v.program) &&
    isStr(v.origin) &&
    isStr(v.dest) &&
    isStr(v.date) &&
    RESTORE_CABINS.has(v.cabin) &&
    typeof v.miles === "number" &&
    Number.isFinite(v.miles) &&
    Array.isArray(v.airlines) &&
    v.airlines.every(isStr)
  );
}

/** A copy of a persisted coverage record, or null when damaged. Malformed evidence is dropped, not the record. */
function restorableRecord(c: unknown): CoverageRecord | null {
  if (typeof c !== "object" || c === null) return null;
  const v = c as Record<string, unknown>;
  if (!isStr(v.origin) || !isStr(v.dest)) return null;
  // Real calendar days in order, and a real fetch instant: a record with junk dates would satisfy any range.
  if (!isRealDate(v.date_from) || !isRealDate(v.date_to) || v.date_from > v.date_to || parseInstant(v.fetched_at) === null) return null;
  if (!Array.isArray(v.cabins) || v.cabins.length === 0 || !v.cabins.every((cab) => RESTORE_CABINS.has(cab))) return null;
  if (v.programs !== null && !(Array.isArray(v.programs) && v.programs.every(isStr))) return null;
  if (v.direct_only !== undefined && typeof v.direct_only !== "boolean") return null;
  if (v.include_filtered !== undefined && typeof v.include_filtered !== "boolean") return null;
  if (v.min_cabin_pct !== undefined && typeof v.min_cabin_pct !== "number") return null;
  const record = { ...(c as CoverageRecord), cabins: [...(v.cabins as Cabin[])], programs: v.programs === null ? null : [...(v.programs as string[])] };
  const evidence = readRecordEvidence(v.evidence);
  if (evidence) record.evidence = evidence;
  else delete record.evidence;
  return record;
}

/** A coverage record's evidence only if it is one of the shapes a run writes; anything else proves nothing. */
export function readRecordEvidence(value: unknown): CoverageRecordEvidence | null {
  if (typeof value !== "object" || value === null) return null;
  const { state, reason } = value as Record<string, unknown>;
  if (state === "complete" && reason === "exhausted") return { state, reason };
  if (state === "partial" && (reason === "page_cap" || reason === "quota" || reason === "upstream_error")) return { state, reason };
  return null;
}

export interface CacheSnapshotUser {
  userId: string;
  rows: AvailabilityRow[];
  coverage: CoverageRecord[];
}

export interface CacheSnapshot {
  version: number;
  users: CacheSnapshotUser[];
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
