/**
 * SQLite-backed AvailabilityCacheStore over `availability_cache` + `cache_coverage`
 * (kickoff §3; §0.2 #2 — the cache is per user key, never global).
 *
 * Every statement here carries `user_id = ?`. There is no code path that reads or deletes
 * across users; `prune` is the only cross-user operation and it is a time-based sweep.
 *
 * Two impedance mismatches between the Phase-1 interfaces and the migrated schema are bridged
 * here rather than by a schema change:
 *
 *  1. `AvailabilityRow.include_filtered` and `AvailabilityRow.min_cabin_pct` are separate cache
 *     scopes with their own identity (the in-memory store keys on both), but the table PK is
 *     (user, program, origin, dest, date, cabin). Rows fetched with include_filtered=true are
 *     stored with the program suffixed by `#filtered`, and rows fetched with a non-default
 *     min_cabin_pct with a further `#pct<N>` (`encodeProgram`), decoded on the way out, so the
 *     scopes coexist. Both suffixes are written ONLY for the non-default value, so every row
 *     already in the table keeps its exact stored text: that is why neither needed a migration.
 *
 *  2. `CoverageRecord` is a rectangle (date_from..date_to × cabins) tagged with programs,
 *     direct_only, include_filtered and min_cabin_pct, while `cache_coverage` holds one row per
 *     (date, cabin, programs_key). A record is expanded to rows on write; the flags ride in
 *     `programs_key` (`encodeProgramsKey`). On read, rows sharing (pair, programs_key,
 *     fetched_at) are folded back into records — one per (set of cabins with identical dates,
 *     contiguous date run) — so two disjoint fetches that happen to share a fetched_at (frozen
 *     clocks, the CLI, a worker tick) never merge into a bounding box that claims the gap
 *     between them (see `foldRectangles`). Cells later refreshed by a newer fetch are simply
 *     still attributed to the older timestamp as well (conservative: coverage is only ever
 *     claimed for fetched cells).
 */
import { and, asc, eq, gte, inArray, like, lt, lte, notLike, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { availabilityCache, cacheCoverage, type AvailabilityCacheRow } from "@/lib/db/schema";
import type { AvailabilityRow } from "@awardgrid/core/grid/types";
import { Cabin, DEFAULT_MIN_CABIN_PCT } from "@awardgrid/core/query/schema";
import {
  minFetchedAt,
  rowInScope,
  rowMatches,
  type AvailabilityCacheStore,
  type CacheQuery,
  type CachedRows,
  type CoverageRecord,
} from "@awardgrid/core/seatsaero/cache";

// ---------------------------------------------------------------------------
// Encoding helpers (exported for tests and for anyone inspecting the tables)
// ---------------------------------------------------------------------------

/** Suffix appended to `program` for rows fetched with include_filtered=true. */
export const FILTERED_PROGRAM_SUFFIX = "#filtered";
/**
 * Suffix appended to `program` for rows fetched with a NON-DEFAULT min_cabin_pct, e.g.
 * `alaska#pct70` / `alaska#filtered#pct70`. Written only when the value is not 100, so every
 * row already in the table keeps its exact stored text and still decodes to 100 — which is why
 * issue #18 needed no migration.
 */
export const PCT_PROGRAM_PREFIX = "#pct";
const PCT_PROGRAM_RE = /#pct(\d{1,3})$/;
/** `programs_key` marker for "every program the key can access". */
export const ALL_PROGRAMS_KEY = "*";
const KEY_FLAG_DIRECT = "direct";
const KEY_FLAG_FILTERED = "filtered";
const KEY_FLAG_PCT = "pct";
const KEY_FLAG_PCT_RE = /^pct(\d{1,3})$/;

export function encodeProgram(program: string, includeFiltered: boolean | undefined, minCabinPct?: number): string {
  const head = includeFiltered ? `${program}${FILTERED_PROGRAM_SUFFIX}` : program;
  const pct = minCabinPct ?? DEFAULT_MIN_CABIN_PCT;
  return pct === DEFAULT_MIN_CABIN_PCT ? head : `${head}${PCT_PROGRAM_PREFIX}${pct}`;
}

export function decodeProgram(stored: string): { program: string; include_filtered: boolean; min_cabin_pct: number } {
  // `#pct<N>` is the outer suffix, so it is stripped first.
  let rest = stored;
  let pct = DEFAULT_MIN_CABIN_PCT;
  const m = PCT_PROGRAM_RE.exec(rest);
  if (m) {
    pct = Number(m[1]);
    rest = rest.slice(0, -m[0].length);
  }
  if (rest.endsWith(FILTERED_PROGRAM_SUFFIX)) {
    return { program: rest.slice(0, -FILTERED_PROGRAM_SUFFIX.length), include_filtered: true, min_cabin_pct: pct };
  }
  return { program: rest, include_filtered: false, min_cabin_pct: pct };
}

/**
 * `programs_key` = "<programs>[|direct][|filtered][|pct<N>]" where <programs> is "*" (all
 * programs) or the sorted, comma-joined program list. Sorted so the same set always yields the
 * same PK. `pct<N>` is written only for a non-default N, so every key already in
 * `cache_coverage` keeps its exact text and decodes to 100.
 */
export function encodeProgramsKey(
  programs: readonly string[] | null | undefined,
  directOnly: boolean | undefined,
  includeFiltered: boolean | undefined,
  minCabinPct?: number,
): string {
  const head =
    programs === null || programs === undefined ? ALL_PROGRAMS_KEY : [...new Set(programs)].sort().join(",");
  const flags: string[] = [];
  if (directOnly) flags.push(KEY_FLAG_DIRECT);
  if (includeFiltered) flags.push(KEY_FLAG_FILTERED);
  const pct = minCabinPct ?? DEFAULT_MIN_CABIN_PCT;
  if (pct !== DEFAULT_MIN_CABIN_PCT) flags.push(`${KEY_FLAG_PCT}${pct}`);
  return [head, ...flags].join("|");
}

export function decodeProgramsKey(key: string): {
  programs: string[] | null;
  direct_only: boolean;
  include_filtered: boolean;
  min_cabin_pct: number;
} {
  const [head = ALL_PROGRAMS_KEY, ...flags] = key.split("|");
  const pctFlag = flags.map((f) => KEY_FLAG_PCT_RE.exec(f)).find((m) => m !== null);
  return {
    programs: head === ALL_PROGRAMS_KEY ? null : head === "" ? [] : head.split(","),
    direct_only: flags.includes(KEY_FLAG_DIRECT),
    include_filtered: flags.includes(KEY_FLAG_FILTERED),
    min_cabin_pct: pctFlag ? Number(pctFlag[1]) : DEFAULT_MIN_CABIN_PCT,
  };
}

const MAX_SPAN_DAYS = 5 * 366;

/** Inclusive list of YYYY-MM-DD dates; empty when the range is inverted or unparseable. */
export function datesBetween(dateFrom: string, dateTo: string): string[] {
  const from = Date.parse(`${dateFrom}T00:00:00Z`);
  const to = Date.parse(`${dateTo}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return [];
  const days = Math.round((to - from) / 86_400_000) + 1;
  if (days > MAX_SPAN_DAYS) throw new RangeError(`coverage date span of ${days} days is not supported`);
  const out: string[] = [];
  for (let i = 0; i < days; i++) out.push(new Date(from + i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

const CABIN_ORDER: readonly Cabin[] = Cabin.options;

interface CoverageRect {
  date_from: string;
  date_to: string;
  cabins: string[];
}

/** Split a sorted, de-duplicated date list into maximal runs of consecutive calendar days. */
function contiguousRuns(dates: readonly string[]): Array<{ from: string; to: string }> {
  const runs: Array<{ from: string; to: string }> = [];
  let start: string | null = null;
  let prev: string | null = null;
  for (const d of dates) {
    if (start === null || prev === null) {
      start = d;
    } else if (Date.parse(`${d}T00:00:00Z`) - Date.parse(`${prev}T00:00:00Z`) !== 86_400_000) {
      runs.push({ from: start, to: prev });
      start = d;
    }
    prev = d;
  }
  if (start !== null && prev !== null) runs.push({ from: start, to: prev });
  return runs;
}

/**
 * Fold (cabin → dates) rows back into coverage rectangles WITHOUT ever claiming a cell that
 * was not fetched. Cabins that cover exactly the same date set share one record per
 * contiguous date run; the sound-but-lossy alternative (one bounding box per group) would
 * turn two disjoint fetches that share a fetched_at into a rectangle covering the gap.
 */
export function foldRectangles(byCabin: ReadonlyMap<string, ReadonlySet<string>>): CoverageRect[] {
  // Group cabins by their exact date set so identical rectangles stay one record.
  const bySignature = new Map<string, { cabins: string[]; dates: string[] }>();
  for (const [cabin, set] of byCabin) {
    const dates = [...set].sort();
    const sig = dates.join(",");
    const entry = bySignature.get(sig);
    if (entry) entry.cabins.push(cabin);
    else bySignature.set(sig, { cabins: [cabin], dates });
  }
  const out: CoverageRect[] = [];
  for (const { cabins, dates } of bySignature.values()) {
    for (const run of contiguousRuns(dates)) out.push({ date_from: run.from, date_to: run.to, cabins: [...cabins] });
  }
  return out;
}

function sortCabins(cabins: Iterable<string>): Cabin[] {
  const set = new Set(cabins);
  return CABIN_ORDER.filter((c) => set.has(c));
}

function parseAirlines(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function toRow(r: AvailabilityCacheRow): AvailabilityRow {
  const { program, include_filtered, min_cabin_pct } = decodeProgram(r.program);
  const row: AvailabilityRow = {
    program,
    origin: r.origin,
    dest: r.dest,
    date: r.date,
    cabin: r.cabin,
    miles: r.miles,
    fees_cents: r.feesCents,
    currency: r.currency,
    seats_left: r.seatsLeft,
    direct: r.direct,
    airlines: parseAirlines(r.airlines),
    computed_last_seen: r.computedLastSeen,
    source_id: r.sourceId,
    booking_url: r.bookingUrl,
    fetched_at: r.fetchedAt,
  };
  // Only present when true, matching what normalize() produces and what callers compare against.
  if (include_filtered) row.include_filtered = true;
  // Only present when recorded by the write that produced these values (see decodeTimeEvidence).
  const evidence = decodeTimeEvidence(r.timeEvidence, r.fetchedAt);
  if (evidence) {
    row.time_basis = evidence.basis;
    if (evidence.updated !== null) row.provider_updated_at = evidence.updated;
  }
  // Same rule for the default 100: absent, exactly as normalize() leaves it.
  if (min_cabin_pct !== DEFAULT_MIN_CABIN_PCT) row.min_cabin_pct = min_cabin_pct;
  return row;
}

function toInsert(userId: string, r: AvailabilityRow): typeof availabilityCache.$inferInsert {
  return {
    userId,
    program: encodeProgram(r.program, r.include_filtered, r.min_cabin_pct),
    origin: r.origin,
    dest: r.dest,
    date: r.date,
    cabin: r.cabin,
    miles: r.miles,
    feesCents: r.fees_cents,
    currency: r.currency,
    seatsLeft: r.seats_left,
    direct: r.direct,
    airlines: JSON.stringify(r.airlines),
    computedLastSeen: r.computed_last_seen,
    sourceId: r.source_id,
    bookingUrl: r.booking_url,
    fetchedAt: r.fetched_at,
    timeEvidence: encodeTimeEvidence(r),
  };
}

const TIME_BASES: ReadonlySet<string> = new Set(["provider_last_seen", "provider_updated", "local_fallback"]);

/** The time_evidence column: null when the row recorded no provenance (a row from before UI/UX v1 T02). */
export function encodeTimeEvidence(r: Pick<AvailabilityRow, "time_basis" | "provider_updated_at" | "fetched_at">): string | null {
  if (!r.time_basis) return null;
  return JSON.stringify({ basis: r.time_basis, updated: r.provider_updated_at ?? null, at: r.fetched_at });
}

/**
 * Parse the time_evidence column. Anything malformed, or written for a different fetch than the row's current
 * fetched_at (an older build rewrote the values without knowing this column), is no evidence at all.
 */
export function decodeTimeEvidence(
  json: string | null,
  fetchedAt: string,
): { basis: NonNullable<AvailabilityRow["time_basis"]>; updated: string | null } | null {
  if (!json) return null;
  try {
    const v: unknown = JSON.parse(json);
    if (typeof v !== "object" || v === null) return null;
    const { basis, updated, at } = v as Record<string, unknown>;
    if (typeof basis !== "string" || !TIME_BASES.has(basis) || at !== fetchedAt) return null;
    if (updated !== null && typeof updated !== "string") return null;
    return { basis: basis as NonNullable<AvailabilityRow["time_basis"]>, updated };
  } catch {
    return null;
  }
}

/** SQLite's bound-parameter ceiling is 32,766; keep multi-row statements well under it. */
const ROW_CHUNK = 400; // 17 columns
const COVERAGE_CHUNK = 1000; // 7 columns

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function assertUserId(userId: string): void {
  if (typeof userId !== "string" || userId === "") throw new RangeError("cache store requires a non-empty userId");
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface PruneResult {
  /** availability_cache rows removed. */
  rows: number;
  /** cache_coverage rows removed. */
  coverage: number;
}

export interface SqliteAvailabilityCache extends AvailabilityCacheStore {
  /**
   * Delete cached rows and coverage with `fetched_at < olderThanIso` (ISO-8601, compared as
   * text — always pass `Date#toISOString()` output). `userId` null/undefined = every user.
   */
  prune(userId: string | null | undefined, olderThanIso: string): Promise<PruneResult>;
}

export function createSqliteAvailabilityCache(db: Db): SqliteAvailabilityCache {
  const t = availabilityCache;
  const c = cacheCoverage;

  /** WHERE for `getRows`/`deleteRows`; null when the query can match nothing. */
  function scopeWhere(userId: string, q: CacheQuery) {
    if (q.origins.length === 0 || q.dests.length === 0 || q.cabins.length === 0) return null;
    if (q.programs !== undefined && q.programs.length === 0) return null;
    const filtered = q.include_filtered ?? false;
    const pct = q.min_cabin_pct ?? DEFAULT_MIN_CABIN_PCT;
    const conds = [
      eq(t.userId, userId),
      inArray(t.origin, [...q.origins]),
      inArray(t.dest, [...q.dests]),
      gte(t.date, q.date_from),
      lte(t.date, q.date_to),
      inArray(t.cabin, [...q.cabins]),
    ];
    if (q.programs !== undefined) {
      // Exact: the encoded program carries both flags, so nothing else can match.
      conds.push(
        inArray(
          t.program,
          q.programs.map((p) => encodeProgram(p, filtered, pct)),
        ),
      );
    } else if (pct !== DEFAULT_MIN_CABIN_PCT) {
      // `#pct<N>` is the outer suffix, so this alone pins both the pct and (via the encoded
      // text before it) nothing else; the `#filtered` half is re-checked by rowMatches below.
      conds.push(like(t.program, `%${PCT_PROGRAM_PREFIX}${pct}`));
      conds.push(filtered ? like(t.program, `%${FILTERED_PROGRAM_SUFFIX}${PCT_PROGRAM_PREFIX}${pct}`) : notLike(t.program, `%${FILTERED_PROGRAM_SUFFIX}${PCT_PROGRAM_PREFIX}${pct}`));
    } else {
      // THE TRAP this guards: `notLike('%#filtered')` is anchored at the END, so a row stored
      // as `alaska#pct70` does not end in `#filtered` and an unguarded prefilter would hand a
      // 70 % row to a 100 % query. Exclude every `#pct` row explicitly instead of relying on
      // the filtered predicate to do it.
      conds.push(notLike(t.program, `%${PCT_PROGRAM_PREFIX}%`));
      conds.push(filtered ? like(t.program, `%${FILTERED_PROGRAM_SUFFIX}`) : notLike(t.program, `%${FILTERED_PROGRAM_SUFFIX}`));
    }
    if (q.direct_only) conds.push(eq(t.direct, true));
    return and(...conds);
  }

  return {
    async getRows(userId, q): Promise<CachedRows> {
      assertUserId(userId);
      const where = scopeWhere(userId, q);
      if (!where) return { rows: [], fetched_at_min: null };
      const rows = db
        .select()
        .from(t)
        .where(where)
        .orderBy(asc(t.origin), asc(t.dest), asc(t.date), asc(t.cabin), asc(t.program))
        .all()
        .map(toRow)
        // The SQL filter is authoritative for the PK columns; rowMatches re-checks the exact
        // in-memory semantics (direct_only, include_filtered/min_cabin_pct scope, programs) so
        // both stores agree — scopeWhere is only ever a prefilter.
        .filter((r) => rowMatches(r, q));
      return { rows, fetched_at_min: minFetchedAt(rows) };
    },

    async getRowsBySourceId(userId, sourceId, scope): Promise<AvailabilityRow[]> {
      assertUserId(userId);
      if (sourceId === "") return [];
      // (user_id, source_id) is not the PK, so this is a scan of THIS user's rows — bounded by
      // the per-user cache and pruned by TTL, and it runs once per cell expand. The scope is
      // applied after `decodeProgram` (via rowInScope) rather than with the LIKE predicates
      // scopeWhere needs, so it cannot drift from the encoding: the decode is authoritative.
      return db
        .select()
        .from(t)
        .where(and(eq(t.userId, userId), eq(t.sourceId, sourceId)))
        .orderBy(asc(t.cabin), asc(t.program))
        .all()
        .map(toRow)
        .filter((r) => rowInScope(r, scope));
    },

    async updateRowFees(userId, key, fees): Promise<boolean> {
      assertUserId(userId);
      // A targeted UPDATE, never an upsert: it is the whole point of the method (issue #52).
      // The WHERE is the PK plus source_id, so a row a concurrent Cached Search refresh deleted
      // or replaced with a different availability matches zero rows and nothing is written back.
      const res = db
        .update(t)
        .set({ feesCents: fees.fees_cents, currency: fees.currency, bookingUrl: fees.booking_url })
        .where(
          and(
            eq(t.userId, userId),
            eq(t.program, encodeProgram(key.program, key.include_filtered, key.min_cabin_pct)),
            eq(t.origin, key.origin),
            eq(t.dest, key.dest),
            eq(t.date, key.date),
            eq(t.cabin, key.cabin),
            eq(t.sourceId, key.source_id),
          ),
        )
        .run();
      return res.changes > 0;
    },

    async putRows(userId, rows) {
      assertUserId(userId);
      if (rows.length === 0) return;
      const values = rows.map((r) => toInsert(userId, r));
      db.transaction((tx) => {
        for (const chunk of chunks(values, ROW_CHUNK)) {
          tx.insert(t)
            .values(chunk)
            .onConflictDoUpdate({
              target: [t.userId, t.program, t.origin, t.dest, t.date, t.cabin],
              set: {
                miles: sql`excluded.miles`,
                feesCents: sql`excluded.fees_cents`,
                currency: sql`excluded.currency`,
                seatsLeft: sql`excluded.seats_left`,
                direct: sql`excluded.direct`,
                airlines: sql`excluded.airlines`,
                computedLastSeen: sql`excluded.computed_last_seen`,
                sourceId: sql`excluded.source_id`,
                bookingUrl: sql`excluded.booking_url`,
                fetchedAt: sql`excluded.fetched_at`,
                timeEvidence: sql`excluded.time_evidence`,
              },
            })
            .run();
        }
      });
    },

    async deleteRows(userId, q) {
      assertUserId(userId);
      const where = scopeWhere(userId, q);
      if (!where) return;
      db.delete(t).where(where).run();
    },

    async getCoverage(userId, pairs): Promise<CoverageRecord[]> {
      assertUserId(userId);
      if (pairs.length === 0) return [];
      const wanted = new Set(pairs.map((p) => `${p.origin}-${p.dest}`));
      const rows = db
        .select()
        .from(c)
        .where(
          and(
            eq(c.userId, userId),
            inArray(c.origin, [...new Set(pairs.map((p) => p.origin))]),
            inArray(c.dest, [...new Set(pairs.map((p) => p.dest))]),
          ),
        )
        .all()
        .filter((r) => wanted.has(`${r.origin}-${r.dest}`));

      interface Group {
        origin: string;
        dest: string;
        key: string;
        fetched_at: string;
        /** cabin → set of dates covered for that cabin */
        byCabin: Map<string, Set<string>>;
      }
      const groups = new Map<string, Group>();
      for (const r of rows) {
        const gk = [r.origin, r.dest, r.programsKey, r.fetchedAt].join(" ");
        let g = groups.get(gk);
        if (!g) {
          g = { origin: r.origin, dest: r.dest, key: r.programsKey, fetched_at: r.fetchedAt, byCabin: new Map() };
          groups.set(gk, g);
        }
        let dates = g.byCabin.get(r.cabin);
        if (!dates) {
          dates = new Set();
          g.byCabin.set(r.cabin, dates);
        }
        dates.add(r.date);
      }
      const out: CoverageRecord[] = [];
      for (const g of groups.values()) {
        const decoded = decodeProgramsKey(g.key);
        for (const rect of foldRectangles(g.byCabin)) {
          const rec: CoverageRecord = {
            origin: g.origin,
            dest: g.dest,
            date_from: rect.date_from,
            date_to: rect.date_to,
            cabins: sortCabins(rect.cabins),
            programs: decoded.programs,
            direct_only: decoded.direct_only,
            fetched_at: g.fetched_at,
          };
          if (decoded.include_filtered) rec.include_filtered = true;
          if (decoded.min_cabin_pct !== DEFAULT_MIN_CABIN_PCT) rec.min_cabin_pct = decoded.min_cabin_pct;
          out.push(rec);
        }
      }
      out.sort(
        (a, b) =>
          a.origin.localeCompare(b.origin) ||
          a.dest.localeCompare(b.dest) ||
          a.fetched_at.localeCompare(b.fetched_at) ||
          a.date_from.localeCompare(b.date_from),
      );
      return out;
    },

    async markPairsFetched(userId, records) {
      assertUserId(userId);
      const values: (typeof cacheCoverage.$inferInsert)[] = [];
      for (const r of records) {
        const key = encodeProgramsKey(r.programs, r.direct_only, r.include_filtered, r.min_cabin_pct);
        for (const date of datesBetween(r.date_from, r.date_to)) {
          for (const cabin of r.cabins) {
            values.push({ userId, origin: r.origin, dest: r.dest, date, cabin, programsKey: key, fetchedAt: r.fetched_at });
          }
        }
      }
      if (values.length === 0) return;
      db.transaction((tx) => {
        for (const chunk of chunks(values, COVERAGE_CHUNK)) {
          tx.insert(c)
            .values(chunk)
            .onConflictDoUpdate({
              target: [c.userId, c.origin, c.dest, c.date, c.cabin, c.programsKey],
              // Newest fetch wins; ISO-8601 UTC strings order lexicographically.
              set: { fetchedAt: sql`max(${c.fetchedAt}, excluded.fetched_at)` },
            })
            .run();
        }
      });
    },

    async prune(userId, olderThanIso): Promise<PruneResult> {
      if (typeof olderThanIso !== "string" || !Number.isFinite(Date.parse(olderThanIso))) {
        throw new RangeError("prune requires an ISO-8601 timestamp");
      }
      return db.transaction((tx) => {
        const rowConds = [lt(t.fetchedAt, olderThanIso)];
        const covConds = [lt(c.fetchedAt, olderThanIso)];
        if (userId) {
          rowConds.push(eq(t.userId, userId));
          covConds.push(eq(c.userId, userId));
        }
        const rows = tx.delete(t).where(and(...rowConds)).run().changes;
        const coverage = tx.delete(c).where(and(...covConds)).run().changes;
        return { rows, coverage };
      });
    },
  };
}
