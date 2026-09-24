/**
 * Server facade for the grid page and its API routes (kickoff §4, §5).
 *
 *   findGridForUser   QueryObject → Grid using the CALLING user's own seats.aero key
 *   getTripsForUser   Get Trips for one Availability ID (costs exactly one call)
 *   parseForUser      NL text → QueryObject (LLM only when ANTHROPIC_API_KEY is set)
 *   userFromRequest   session cookie on a Route Handler request → User | null
 *
 * Boundaries honoured here (§0.2): there is no default key — a user without a key gets a
 * NoKeyError, never someone else's key; the decrypted key is passed to exactly one place, the
 * SeatsAeroClient constructor inside runFind / getTripsForUser, and is never returned, logged
 * or placed on an error. Cache, quota and routes stores are the per-user SQLite stores.
 */
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, getSessionUser, type User } from "@/lib/auth";
import type { Db } from "@/lib/db/client";
import { createSqliteStores } from "@/lib/db/stores";
import { buildGrid, enumeratePairs } from "@awardgrid/core/grid/pivot";
import type { AvailabilityRow, Grid, NotFetchedPair, Orientation, RoutePair } from "@awardgrid/core/grid/types";
import type { CoverageEvidence } from "@awardgrid/core/workspace/types";
import { getDecryptedKey, getMasterKey, hasKey, NoKeyError } from "@/lib/keys";
import { BodyError } from "@/lib/server/http";
import { PARSER_MODEL_DEFAULT, ParseError, parseQuery, resolveParserModel, type ParseQueryResult, type ParserClient } from "@awardgrid/core/query";
import type { QueryObject } from "@awardgrid/core/query/schema";
import { SeatsAeroClient, SeatsAeroError, SeatsAeroHttpError, SeatsAeroNetworkError } from "@awardgrid/core/seatsaero/client";
import { seatsFetchFromEnv } from "./seats-fetch";
import { runFind, type FindResult } from "@awardgrid/core/seatsaero/find";
import { cacheTtlMinutesFromEnv, uncoveredPairs, type AvailabilityCacheStore, type CacheQuery } from "@awardgrid/core/seatsaero/cache";
import { tripsToFees, type TripFees } from "@awardgrid/core/seatsaero/normalize";
import { Quota, QuotaExceededError, softLimitFromEnv } from "@awardgrid/core/seatsaero/quota";
import { RoutesCatalog, type EnsureLoadedOptions, type EnsureLoadedResult } from "@awardgrid/core/seatsaero/routes";
import { DEFAULT_MIN_CABIN_PCT, type Cabin } from "@awardgrid/core/query/schema";
import { notice, noticesToText, type Notice } from "@awardgrid/core/notices";
import { SEATS_SOURCES, SOURCE_NAMES, type Trip } from "@awardgrid/core/seatsaero/types";

export { NoKeyError, ParseError, PARSER_MODEL_DEFAULT, QuotaExceededError };

// ---------------------------------------------------------------------------
// Shared options
// ---------------------------------------------------------------------------

export interface ServerFindOptions {
  /** Clock; inject in tests. */
  now?: () => Date;
  /** Transport; inject a fake in tests. Never a way to bypass the key. */
  fetch?: typeof fetch;
  /** MASTER_KEY override for tests; production reads process.env.MASTER_KEY via getMasterKey(). */
  masterKey?: Buffer;
  /** Cache TTL override (minutes); default from CACHE_TTL_MINUTES. */
  ttlMinutes?: number;
  /**
   * Append cached dynamic-pricing rows (flagged `dynamic: true`) to a query that hides them
   * (Phase 6 §3.4 "filtered" cell state). Default true. Pass false for consumers that diff
   * or notify on the rows (standing queries), so a cached include_filtered scope can never
   * show up as "new" cells.
   */
  dynamic_rows?: boolean;
}

/** Quota snapshot for the header bar (soft limit, not the provider's hard 1,000). */
export interface QuotaSnapshot {
  used: number;
  limit: number;
  /** ISO timestamp of the next UTC midnight ("assumed 00:00 UTC", ARCHITECTURE §2.7). */
  resetAt: string;
}

export interface FindGridResult {
  grid: Grid;
  /** English renderings of `notices` (kept for the CLI / older clients). */
  warnings: string[];
  /** Structured {code, vars}; the UI renders these through t() in the viewer's language. */
  notices: Notice[];
  quota: QuotaSnapshot;
  /**
   * True when the include_filtered scope of this query is cached (fresh within the TTL) and
   * its extra rows were appended as `dynamic: true` — the "Show dynamic pricing" toggle would
   * cost no calls. Always false when the query already includes dynamic pricing.
   */
  dynamic_rows_available: boolean;
  /**
   * Programs whose Get Routes call failed upstream during this run (the grid still renders;
   * "not monitored" is not claimed for them). Empty when nothing failed.
   */
  programs_failed: string[];
  /**
   * Phase 6 additive: programs monitoring each requested pair (pair key → count) from this
   * user's routes catalog — the column header's "N programs". Null when the catalog does not
   * know every requested program (never consulted, budget-skipped or failed upstream): the UI
   * then shows what it can see in the cells and says so, instead of claiming a monitoring count.
   */
  programs_by_pair: Record<string, number> | null;
  /**
   * Phase 6 additive: programs the run checked for these pairs — those monitoring at least one
   * requested pair when the catalog is known, else every requested program (the search covered
   * them all). The empty-results sentence's "Checked N programs".
   */
  programs_checked: number;
  /**
   * UI/UX v1 T18, additive: the rows the grid was built from (dynamic ones appended as above) and how much of the
   * query's scope they cover, so the Web workspace builds the same ResultSnapshot iOS does (core
   * workspace/snapshot-from-find.ts). Older clients ignore both.
   */
  rows: AvailabilityRow[];
  coverage: CoverageEvidence | null;
}

type UserRef = Pick<User, "id">;

/**
 * Resolve the calling user's seats.aero key. Order matters: the "has a key" check happens
 * BEFORE the master key is touched, so a user without a key gets a clean NoKeyError even on a
 * host where MASTER_KEY is unset (and the route can answer 409 instead of 500).
 */
function resolveSeatsKey(db: Db, userId: string, masterKey: Buffer | undefined): string {
  if (!hasKey(db, userId, "seats_aero")) throw new NoKeyError("seats_aero");
  const key = getDecryptedKey(db, userId, "seats_aero", masterKey ?? getMasterKey());
  if (key === null) throw new NoKeyError("seats_aero");
  return key;
}

/**
 * A RoutesCatalog whose Get Routes failures for ONE program do not fail the whole grid: an
 * upstream 5xx / 429 / schema error on `/routes?source=x` leaves that source unloaded (reported
 * in `skipped`, so runFind never claims "not monitored" from partial knowledge) and records it
 * in `failed`. Key errors (401/403) and transport errors still propagate — they affect every
 * request, and hiding them would hide a broken key.
 */
export class ResilientRoutesCatalog extends RoutesCatalog {
  readonly failed: string[] = [];

  override async ensureLoaded(
    userId: string,
    sources: readonly string[],
    client: SeatsAeroClient,
    opts: EnsureLoadedOptions = {},
  ): Promise<EnsureLoadedResult> {
    const result: EnsureLoadedResult = { fetched: [], cached: [], skipped: [] };
    let budget = opts.maxFetches ?? Number.POSITIVE_INFINITY;
    for (const source of sources) {
      try {
        const one = await super.ensureLoaded(userId, [source], client, { maxFetches: budget });
        budget -= one.fetched.length;
        result.fetched.push(...one.fetched);
        result.cached.push(...one.cached);
        result.skipped.push(...one.skipped);
      } catch (err) {
        if (err instanceof SeatsAeroHttpError && err.kind === "invalid_key") throw err;
        if (!(err instanceof SeatsAeroError) || err instanceof SeatsAeroNetworkError) throw err;
        budget -= 1; // the failed request was still made (and charged)
        result.skipped.push(source);
        if (!this.failed.includes(source)) this.failed.push(source);
      }
    }
    return result;
  }
}

function wiring(db: Db, now: () => Date) {
  const stores = createSqliteStores(db);
  const quota = new Quota({ store: stores.quota, now, softLimit: softLimitFromEnv() });
  const routes = new ResilientRoutesCatalog({ store: stores.routes, now });
  return { stores, quota, routes };
}

/** Identity of a cached row within one scope (the availability_cache primary key minus the scope). */
function rowIdentity(r: Pick<AvailabilityRow, "program" | "origin" | "dest" | "date" | "cabin">): string {
  return `${r.program}|${r.origin}|${r.dest}|${r.date}|${r.cabin}`;
}

/** The exact cache scope runFind reads/writes for `query`, with include_filtered forced on. */
function filteredScope(query: QueryObject): CacheQuery {
  const programs = query.programs && query.programs.length > 0 ? [...query.programs] : null;
  return {
    origins: query.origins,
    dests: query.destinations,
    date_from: query.date_from,
    date_to: query.date_to,
    cabins: query.cabins,
    ...(programs ? { programs } : {}),
    direct_only: query.direct_only,
    include_filtered: true,
    // Same mixed-cabin scope as the query itself: the dynamic-pricing hint may only be borrowed
    // from a scope that asked seats.aero the same question.
    min_cabin_pct: query.min_cabin_pct,
  };
}

/**
 * For a query that hides dynamic pricing: when the include_filtered scope of the SAME query is
 * fresh in the cache for every pair, append its rows that the plain scope does not have,
 * flagged `dynamic: true`. Reads the cache only — never the network, never quota.
 */
export async function appendCachedDynamicRows(
  cache: AvailabilityCacheStore,
  userId: string,
  query: QueryObject,
  rows: readonly AvailabilityRow[],
  ttlMinutes: number,
  now: Date,
): Promise<{ rows: AvailabilityRow[]; available: boolean }> {
  if (query.include_filtered) return { rows: [...rows], available: false };
  const pairs = enumeratePairs(query);
  const scope = filteredScope(query);
  const coverage = await cache.getCoverage(userId, pairs);
  if (uncoveredPairs(scope, coverage, ttlMinutes, now).length > 0) return { rows: [...rows], available: false };
  const cached = await cache.getRows(userId, scope);
  const have = new Set(rows.map(rowIdentity));
  const extra: AvailabilityRow[] = [];
  for (const r of cached.rows) {
    if (have.has(rowIdentity(r))) continue;
    extra.push({ ...r, dynamic: true });
  }
  return { rows: [...rows, ...extra], available: true };
}

/**
 * i18n keys the grid shows for a cell whose fetch did not complete (never English text).
 * `upstream` is the partial run: one program's Get Routes failed (ResilientRoutesCatalog), so a
 * pair with no rows that no LOADED program monitors may belong to the failed program — the
 * grid cannot say "not monitored" or "no availability" for it (`upstreamNotFetchedPairs`).
 */
export const NOT_FETCHED_REASON = {
  quota: "grid.cell.not_fetched_quota",
  truncated: "grid.cell.not_fetched",
  upstream: "grid.cell.not_fetched_error",
} as const;

/**
 * Map runFind's run-level warnings onto pairs. Truncation and quota headroom stop a run before
 * every pair/date was pulled, but the warnings do not say which: the only honest claim is that
 * a pair with NO rows in such a run may not have been fetched at all. Pairs seats.aero does not
 * monitor keep their own state; pairs with rows are "ok" (their empty dates stay "none").
 */
export function notFetchedPairsFrom(result: Pick<FindResult, "rows" | "notices" | "unmonitored_pairs">, pairs: readonly RoutePair[]): NotFetchedPair[] {
  let reason: string | null = null;
  for (const n of result.notices) {
    if (n.code === "find.quota_headroom") {
      reason = NOT_FETCHED_REASON.quota;
      break;
    }
    if (n.code === "find.truncated_search" || n.code === "find.truncated_bulk") reason = NOT_FETCHED_REASON.truncated;
  }
  if (reason === null) return [];
  const withRows = new Set(result.rows.map((r) => `${r.origin}-${r.dest}`));
  const unmonitored = new Set(result.unmonitored_pairs.map((p) => p.key));
  const out: NotFetchedPair[] = [];
  for (const p of pairs) {
    if (withRows.has(p.key) || unmonitored.has(p.key)) continue;
    out.push({ pair: { origin: p.origin, dest: p.dest }, reason });
  }
  return out;
}

/**
 * Re-attribute the routes notices once the run is over.
 *
 * `ResilientRoutesCatalog.ensureLoaded` puts a source whose Get Routes call FAILED into both
 * `failed` and `skipped`, and `runFind` turns any `skipped` into `find.routes_skipped` — "…
 * skipped to stay within today's quota". So an upstream 500 on one program's route list used to
 * tell the user their daily allowance had run out. It had not: the call was made and answered
 * with an error. Here the two causes are separated again, from the one place that can see both.
 *
 *  - the quota sentence keeps only the sources the budget really stopped (`skipped − failed`)
 *    and disappears when every skip was a failure;
 *  - the failures get their own `find.routes_failed`, naming the programs.
 *
 * The caller must rebuild `warnings` from the returned list (`noticesToText`): `uiNotices`
 * (src/components/grid/api.ts) drops the WHOLE strip back to the server's English unless
 * `notices.length === warnings.length`, so an unpaired notice untranslates the zh UI.
 */
export function reattributeRoutesNotices(notices: readonly Notice[], failed: readonly string[]): Notice[] {
  if (failed.length === 0) return [...notices];
  const out: Notice[] = [];
  for (const n of notices) {
    if (n.code !== "find.routes_skipped") {
      out.push(n);
      continue;
    }
    const skipped = Number(n.vars?.skipped ?? 0) - failed.length;
    if (skipped > 0) out.push(notice("find.routes_skipped", { pairs: Number(n.vars?.pairs ?? 0), skipped }));
  }
  const programs = failed.map((s) => (SOURCE_NAMES as Record<string, string>)[s] ?? s);
  // Joined server-side, where the viewer's locale is not known: an English comma, like every
  // other list the API puts inside a notice variable. The program names are English brand
  // names in both dictionaries (SOURCE_NAMES, §0.2 #4 "text only").
  out.push(notice("find.routes_failed", { programs: programs.join(", "), count: failed.length }));
  return out;
}

/**
 * Pairs whose state is unknown because a program's route list is not loaded: no rows in the
 * run, not already flagged, and monitored by none of the programs whose route lists loaded.
 * Pairs a loaded program monitors keep "no availability" (their rows, if any, were fetched).
 * `reason` is the i18n key for the cell: upstream when the list failed on this request, quota
 * when the run could not afford the call, the generic key when the gap is older than this
 * request (a cached grid after an earlier failure — the store never records failures).
 */
export function upstreamNotFetchedPairs(
  routes: Pick<RoutesCatalog, "unmonitoredPairs">,
  userId: string,
  sources: readonly string[],
  pairs: readonly RoutePair[],
  result: Pick<FindResult, "rows" | "unmonitored_pairs">,
  already: readonly NotFetchedPair[],
  reason: string = NOT_FETCHED_REASON.upstream,
): NotFetchedPair[] {
  const withRows = new Set(result.rows.map((r) => `${r.origin}-${r.dest}`));
  const skip = new Set([...result.unmonitored_pairs.map((p) => p.key), ...already.map((n) => `${n.pair.origin}-${n.pair.dest}`)]);
  const zero = pairs.filter((p) => !withRows.has(p.key) && !skip.has(p.key));
  return routes.unmonitoredPairs(userId, zero, sources).map((p) => ({ pair: { origin: p.origin, dest: p.dest }, reason }));
}

/** Requested programs: the query's list, else every seats.aero source. */
export function requestedSources(query: Pick<QueryObject, "programs">): string[] {
  return query.programs && query.programs.length > 0 ? [...query.programs] : [...SEATS_SOURCES];
}

/**
 * Per-pair monitoring counts and the checked-program count from the routes catalog, once it
 * knows every requested source; `by_pair` is null otherwise (see FindGridResult).
 */
export function programCounts(
  routes: Pick<RoutesCatalog, "isLoaded" | "isMonitored">,
  userId: string,
  sources: readonly string[],
  pairs: readonly RoutePair[],
): { by_pair: Record<string, number> | null; checked: number } {
  if (!sources.every((s) => routes.isLoaded(userId, s))) return { by_pair: null, checked: sources.length };
  const by_pair: Record<string, number> = {};
  for (const p of pairs) by_pair[p.key] = sources.filter((s) => routes.isMonitored(userId, s, p.origin, p.dest)).length;
  const checked = sources.filter((s) => pairs.some((p) => routes.isMonitored(userId, s, p.origin, p.dest))).length;
  return { by_pair, checked };
}

async function snapshot(quota: Quota, userId: string): Promise<QuotaSnapshot> {
  return { used: await quota.used(userId), limit: quota.softLimit, resetAt: quota.resetAt().toISOString() };
}

// ---------------------------------------------------------------------------
// findGridForUser
// ---------------------------------------------------------------------------

/**
 * Run the fast lane for `user` and pivot into a Grid. Throws NoKeyError (→ 409),
 * QuotaExceededError (→ 429) or a SeatsAeroError subclass (→ 502). The key never leaves
 * this function except into the SeatsAeroClient that runFind builds.
 */
export async function findGridForUser(
  db: Db,
  user: UserRef,
  query: QueryObject,
  opts: ServerFindOptions & { orientation?: Orientation } = {},
): Promise<FindGridResult> {
  const now = opts.now ?? (() => new Date());
  const apiKey = resolveSeatsKey(db, user.id, opts.masterKey);
  const { stores, quota, routes } = wiring(db, now);

  const fetchImpl = opts.fetch ?? seatsFetchFromEnv();
  const result = await runFind({
    query,
    userId: user.id,
    apiKey,
    quota,
    cache: stores.cache,
    routes,
    now,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
    ...(opts.ttlMinutes !== undefined ? { ttlMinutes: opts.ttlMinutes } : {}),
  });

  // Phase 6 additive: dynamic rows from the cached include_filtered scope (no network) and the
  // "not fetched" cell state derived from the run's warnings.
  let rows: AvailabilityRow[] = result.rows;
  let dynamicAvailable = false;
  if (!query.include_filtered && (opts.dynamic_rows ?? true)) {
    const appended = await appendCachedDynamicRows(
      stores.cache,
      user.id,
      query,
      result.rows,
      opts.ttlMinutes ?? cacheTtlMinutesFromEnv(),
      now(),
    );
    rows = appended.rows;
    dynamicAvailable = appended.available;
  }

  // Separate "the quota stopped us" from "the program's route list errored" before either
  // reaches the user (see reattributeRoutesNotices). With nothing failed this is `result.notices`
  // unchanged, so every other path is byte-identical to before.
  const notices = reattributeRoutesNotices(result.notices, routes.failed);

  const pairs = enumeratePairs(query);
  const notFetched = notFetchedPairsFrom(result, pairs);
  // Route lists paid for on earlier requests (store only, zero calls): the header's program
  // counts, and the honest state for pairs no loaded program monitors while a list is missing.
  const sources = requestedSources(query);
  await routes.hydrate(user.id, sources);
  const unloaded = sources.filter((s) => !routes.isLoaded(user.id, s));
  if (unloaded.length > 0) {
    const reason =
      routes.failed.length > 0
        ? NOT_FETCHED_REASON.upstream
        : notices.some((n) => n.code === "find.routes_skipped")
          ? NOT_FETCHED_REASON.quota
          : NOT_FETCHED_REASON.truncated;
    notFetched.push(...upstreamNotFetchedPairs(routes, user.id, sources, pairs, result, notFetched, reason));
  }
  const counts = programCounts(routes, user.id, sources, pairs);

  const grid = buildGrid(rows, query, {
    orientation: opts.orientation ?? "dates",
    now: now(),
    unmonitored_pairs: result.unmonitored_pairs,
    not_fetched_pairs: notFetched,
    api_calls_used: result.api_calls_used,
    served_from_cache: result.served_from_cache,
  });
  return {
    grid,
    // Rebuilt from `notices`, never passed through from the run: uiNotices pairs the two arrays
    // by index and falls back to English for the whole strip when their lengths differ.
    warnings: noticesToText(notices),
    notices,
    quota: await snapshot(quota, user.id),
    dynamic_rows_available: dynamicAvailable,
    programs_failed: [...routes.failed],
    programs_by_pair: counts.by_pair,
    programs_checked: counts.checked,
    rows,
    coverage: result.coverage ?? null,
  };
}

// ---------------------------------------------------------------------------
// getTripsForUser
// ---------------------------------------------------------------------------

export interface TripSegmentSummary {
  flight_number: string;
  origin: string;
  dest: string;
  departs_at: string; // airport-local, "Z" suffix is NOT UTC (ARCHITECTURE §2.3)
  arrives_at: string;
  aircraft: string | null;
  fare_class: string | null;
}

export interface TripSummary {
  id: string;
  cabin: string;
  miles: number;
  fees_cents: number;
  currency: string | null;
  seats: number;
  stops: number;
  carriers: string;
  flight_numbers: string;
  departs_at: string;
  arrives_at: string;
  duration: number | null;
  mixed_cabin_pct: number | null;
  segments: TripSegmentSummary[];
}

export interface TripsForUserResult {
  availability_id: string;
  trips: TripSummary[];
  /** Cheapest trip's taxes (minor units) for the requested cabin, else null. */
  fees_cents: number | null;
  currency: string | null;
  booking_url: string | null;
  booking_links: { label: string; link: string; primary: boolean }[];
  api_calls_used: number;
  quota: QuotaSnapshot;
}

export function summarizeTrip(t: Trip): TripSummary {
  return {
    id: t.ID,
    cabin: t.Cabin,
    miles: t.MileageCost,
    fees_cents: t.TotalTaxes,
    currency: t.TaxesCurrency ? t.TaxesCurrency : null,
    seats: t.RemainingSeats,
    stops: t.Stops,
    carriers: t.Carriers,
    flight_numbers: t.FlightNumbers,
    departs_at: t.DepartsAt,
    arrives_at: t.ArrivesAt,
    duration: t.TotalDuration ?? null,
    mixed_cabin_pct: t.MixedCabinPct ?? null,
    segments: [...t.AvailabilitySegments]
      .sort((a, b) => (a.Order ?? 0) - (b.Order ?? 0))
      .map((s) => ({
        flight_number: s.FlightNumber,
        origin: s.OriginAirport,
        dest: s.DestinationAirport,
        departs_at: s.DepartsAt,
        arrives_at: s.ArrivesAt,
        aircraft: s.AircraftName ?? s.AircraftCode ?? null,
        fare_class: s.FareClass ?? null,
      })),
  };
}

/**
 * Persist what Get Trips priced onto the cached row it belongs to (issue #52). Get Trips is the
 * only source of real fees, currency and booking link; before this they were returned to the one
 * open drawer and dropped, so a cell's fee lasted exactly as long as the render did.
 *
 * The rules, in the order they bite:
 *
 *  - WHICH ROW. `fees` is `tripsToFees(res, cabin)` — the cheapest trip IN THAT CABIN, which is
 *    the number the drawer shows for that cabin's row. So the write goes to that one row: the
 *    cached row with this Availability ID and this cabin, nothing else. Without a cabin the
 *    caller asked for the cheapest trip in ANY cabin, which is not the fee of any single cell —
 *    there is no row it may be attributed to, and nothing is written.
 *  - WHICH SCOPE. The lookup carries the request's own include_filtered / min_cabin_pct, so the
 *    fee lands in the scope the drawer asked in and never leaks into the neighbouring one (a
 *    100 % row must not inherit a 70 % answer). Per user, like every other cache write.
 *  - EVIDENCE. Everything written is evidence about THIS cabin, so the whole write is gated on
 *    having priced a trip in it. A response with no trip in this cabin still carries the
 *    availability-level `booking_links[]`, and writing that link alone would permanently
 *    re-point the cell's deeplink (`resolveDeeplink` prefers `booking_url` over every program
 *    builder) on the strength of a call that found no itinerary to book.
 *  - CURRENCY. The currency of the fee just learned, verbatim — null included. seats.aero sends
 *    `TaxesCurrency: ""` for USD, which `tripsToFees` normalizes to null, and null already means
 *    the recorded USD assumption everywhere else (`formatFees`, `availabilityToRows`). Inheriting
 *    the row's old currency instead would label a USD amount "EUR".
 *  - FRESHNESS. `computed_last_seen` and `fetched_at` are never touched: they say how old the
 *    AVAILABILITY is, and a fresh fee does not make a three-day-old row newly seen. See
 *    DECISIONS.md (#52).
 *  - ATOMICITY. The write is a targeted `updateRowFees`, not a re-upsert of the row that was
 *    read: between the read and the write a Cached Search refresh may have rewritten or deleted
 *    this row, and an upsert would roll its columns back or resurrect a retired award.
 *
 * Returns true when a row was updated (false = nothing to learn, or no such row cached).
 */
export async function cacheFeesFromTrips(
  cache: AvailabilityCacheStore,
  userId: string,
  availabilityId: string,
  fees: TripFees,
  scope: { cabin?: Cabin; include_filtered?: boolean; min_cabin_pct?: number },
): Promise<boolean> {
  if (scope.cabin === undefined) return false;
  // No trip in this cabin = nothing was learned ABOUT this cabin, booking link included.
  if (fees.fees_cents === null) return false;
  const rows = await cache.getRowsBySourceId(userId, availabilityId, {
    include_filtered: scope.include_filtered ?? false,
    min_cabin_pct: scope.min_cabin_pct ?? DEFAULT_MIN_CABIN_PCT,
  });
  const row = rows.find((r) => r.cabin === scope.cabin);
  if (!row) return false;
  // A response with a priced trip but no booking link keeps the stored link: a missing link is
  // not a contradiction of a good one, unlike the currency, which belongs to the fee itself.
  const bookingUrl = fees.booking_url ?? row.booking_url;
  if (fees.fees_cents === row.fees_cents && fees.currency === row.currency && bookingUrl === row.booking_url) return false;
  return cache.updateRowFees(userId, row, {
    fees_cents: fees.fees_cents,
    currency: fees.currency,
    booking_url: bookingUrl,
  });
}

/**
 * Get Trips for one Availability ID — costs exactly one seats.aero call, reserved before the
 * request and charged whether it succeeds or fails (seats.aero charged for it either way).
 */
export async function getTripsForUser(
  db: Db,
  user: UserRef,
  availabilityId: string,
  opts: ServerFindOptions & { cabin?: Cabin; include_filtered?: boolean; min_cabin_pct?: number } = {},
): Promise<TripsForUserResult> {
  const now = opts.now ?? (() => new Date());
  const apiKey = resolveSeatsKey(db, user.id, opts.masterKey);
  const { stores, quota } = wiring(db, now);

  const day = quota.today();
  await quota.reserve(user.id, 1, day); // throws QuotaExceededError with the reset time
  const fetchImpl = opts.fetch ?? seatsFetchFromEnv();
  const client = new SeatsAeroClient({ apiKey, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
  let calls = 0;
  const unsubscribe = client.subscribe(() => {
    calls += 1;
  });
  try {
    const pct = opts.min_cabin_pct ?? 100;
    const res = await client.getTrips(availabilityId, {
      ...(opts.include_filtered ? { include_filtered: true } : {}),
      // 100 is the API's own default: omitted so the request is unchanged from before #18.
      ...(pct < 100 ? { min_cabin_pct: pct } : {}),
    });
    const fees = tripsToFees(res, opts.cabin);
    // The only place a real fee, currency or booking link is ever learned: write it back to the
    // cell's own cached row (issue #52). A store failure must not cost the user the answer they
    // just paid a call for, so it is logged by NAME ONLY (kickoff §10) and the response stands.
    try {
      await cacheFeesFromTrips(stores.cache, user.id, availabilityId, fees, {
        ...(opts.cabin ? { cabin: opts.cabin } : {}),
        ...(opts.include_filtered ? { include_filtered: true } : {}),
        ...(opts.min_cabin_pct !== undefined ? { min_cabin_pct: opts.min_cabin_pct } : {}),
      });
    } catch (err) {
      console.error("trips fee writeback failed", err instanceof Error ? err.name : typeof err);
    }
    const trips = res.data.map(summarizeTrip).sort((a, b) => a.miles - b.miles || a.fees_cents - b.fees_cents);
    return {
      availability_id: availabilityId,
      trips,
      fees_cents: fees.fees_cents,
      currency: fees.currency,
      booking_url: fees.booking_url,
      booking_links: res.booking_links.map((l) => ({ label: l.label, link: l.link, primary: l.primary })),
      api_calls_used: calls,
      quota: await snapshot(quota, user.id),
    };
  } finally {
    unsubscribe();
    // The reservation covered one call; refund it only if no request reached the server.
    if (calls === 0) await quota.release(user.id, 1, day);
    else if (calls > 1) await quota.increment(user.id, calls - 1, day);
  }
}

// ---------------------------------------------------------------------------
// parseForUser
// ---------------------------------------------------------------------------

export interface ParseForUserOptions {
  /** YYYY-MM-DD in the user's local calendar (sent by the browser). */
  today: string;
  /** Environment to read ANTHROPIC_API_KEY / AWARDGRID_PARSER_MODEL from; default process.env. */
  env?: Record<string, string | undefined>;
  /** Injected LLM client (tests); when omitted a real Anthropic client is built only if the key is set. */
  llmClient?: ParserClient;
}

/** True when the server can fall back to the language model for ambiguous text. */
export function llmAvailable(env: Record<string, string | undefined> = process.env): boolean {
  const key = env.ANTHROPIC_API_KEY?.trim();
  return key !== undefined && key.length > 0;
}

/**
 * NL → QueryObject. Deterministic first; the LLM (model from AWARDGRID_PARSER_MODEL, default
 * PARSER_MODEL_DEFAULT) only when ANTHROPIC_API_KEY is configured — otherwise parseQuery throws
 * a ParseError naming the missing fields so the UI can ask for them.
 */
export async function parseForUser(text: string, opts: ParseForUserOptions): Promise<ParseQueryResult> {
  const env = opts.env ?? process.env;
  let llmClient = opts.llmClient;
  if (!llmClient && llmAvailable(env)) {
    // The Anthropic SDK owns its key; nothing here reads or forwards it.
    llmClient = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return parseQuery(text, {
    today: opts.today,
    model: resolveParserModel(env),
    ...(llmClient ? { llmClient } : {}),
  });
}

// ---------------------------------------------------------------------------
// Route helpers
// ---------------------------------------------------------------------------

/** The signed-in user for a Route Handler request (session cookie → User), or null. */
export function userFromRequest(db: Db, request: NextRequest, opts: { now?: () => Date } = {}): User | null {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getSessionUser(db, token, opts.now ? { now: opts.now } : undefined);
}

/** Error codes the grid API can answer with (superset of the shell's ApiErrorCode). */
export type GridApiErrorCode = "unauthorized" | "invalid_body" | "no_key" | "quota" | "parse" | "seatsaero" | "internal";

/** `{ error: code, ...extra }` — extra must never carry a key, token or upstream body. */
export function gridError(status: number, error: GridApiErrorCode, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ error, ...extra }, { status, headers: { "cache-control": "no-store" } });
}

/** YYYY-MM-DD of `now` in UTC; the browser sends its own local date when it can. */
export function utcToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Map a thrown error to the API contract. Only codes and non-secret scalars are echoed: the
 * seats.aero message is capped at 200 characters and is already key-redacted by the client;
 * unknown errors log their name only (kickoff §10: no keys, tokens or usernames in logs).
 */
export function gridErrorResponse(err: unknown): NextResponse {
  if (err instanceof BodyError) return gridError(400, "invalid_body");
  if (err instanceof NoKeyError) return gridError(409, "no_key", { provider: err.provider });
  if (err instanceof QuotaExceededError) {
    return gridError(429, "quota", { resetAt: err.resetAt.toISOString(), remaining: err.remaining, requested: err.requested });
  }
  if (err instanceof ParseError) {
    return gridError(422, "parse", { missing: err.missing, message: err.message.slice(0, 500), ...(err.notice ? { notice: err.notice } : {}) });
  }
  if (err instanceof SeatsAeroError) {
    const kind = err instanceof SeatsAeroHttpError ? err.kind : err instanceof SeatsAeroNetworkError ? "network" : "response";
    return gridError(502, "seatsaero", { kind, message: err.message.slice(0, 200) });
  }
  console.error("grid api error", err instanceof Error ? err.name : typeof err);
  return gridError(500, "internal");
}

/** Attachment name for the CSV export, e.g. awardgrid_HKG+PVG_SEA_2026-10-01_2026-10-30.csv */
export function exportFilename(query: Pick<QueryObject, "origins" | "destinations" | "date_from" | "date_to">): string {
  const o = query.origins.slice(0, 3).join("+");
  const d = query.destinations.slice(0, 3).join("+");
  return `awardgrid_${o}_${d}_${query.date_from}_${query.date_to}.csv`;
}
