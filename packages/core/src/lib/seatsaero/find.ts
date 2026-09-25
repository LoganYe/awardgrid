/**
 * The `find` orchestrator (kickoff §4): QueryObject → normalized AvailabilityRow[] using the
 * calling user's own seats.aero key, the per-user cache, and the per-user quota.
 *
 *   planFind  — pure: decides Cached Search vs Bulk Availability by ESTIMATED call count.
 *   runFind   — cache check → quota check → execute plan → normalize → cache → unmonitored.
 *
 * Boundaries honoured here: no Live Search, no scraping, no shared/default key (apiKey is a
 * required argument and there is no fallback), the key never reaches an error or a log.
 */
import {
  SEATS_SOURCES,
  CABIN_LETTER_TO_NAME,
  type Availability,
  type BulkAvailabilityParams,
  type CachedSearchParams,
  type SeatsRegion,
} from "./types";
import type { QueryObject } from "../query/schema";
import type { AvailabilityRow, RoutePair } from "../grid/types";
import { SeatsAeroClient, SeatsAeroError, MAX_TAKE } from "./client";
import { Quota, pagesFor, estimateCalls } from "./quota";
import {
  cacheTtlMinutesFromEnv,
  rowMatches,
  uncoveredPairs,
  type AvailabilityCacheStore,
  type CacheQuery,
  type CoverageRecord,
  type CoverageRecordEvidence,
} from "./cache";
import { notice, noticesToText, type Notice } from "../notices";
import { availabilitiesToRows } from "./normalize";
import type { RoutesCatalog, RoutesKnowledge } from "./routes";
import { type RequestOutcome, coverageFor, recordEvidence, runEvidence } from "../workspace/coverage";
import type { CoverageEvidence } from "../workspace/types";

// ---------------------------------------------------------------------------
// Estimation heuristics (documented constants — tune with real usage data)
// ---------------------------------------------------------------------------

/**
 * Fraction of (pair, day, program, cabin) combinations expected to come back as a row.
 * Premium-cabin award space is sparse: on a typical long-haul pair, roughly one program in
 * seven has J/F space on a given day. 0.15 is deliberately pessimistic so we over-estimate
 * pages (and therefore never under-reserve quota) rather than under-estimate.
 */
export const ROW_DENSITY = 0.15;
/** Page size used for every estimate and every request: the documented maximum. */
export const PAGE_SIZE = MAX_TAKE;
/**
 * Monitored routes per program when the routes catalog is not loaded. The Getting Started
 * page quotes "over 70,000 routes" across the programs; 70,000 / 26 ≈ 2,700. A bulk pull
 * without region filters walks all of them, which is why bulk only wins when the catalog is
 * known and the region slice is small relative to the requested pairs.
 */
export const ASSUMED_ROUTES_PER_PROGRAM = 2700;
/**
 * Hard cap on HTTP pages one runFind may spend on search/availability requests, on top of
 * the daily quota headroom. The largest sane query (7 pairs × 92 days × 26 programs × 4
 * cabins × ROW_DENSITY ≈ 10k rows) needs ~10 pages; anything past 40 is a runaway
 * pagination loop, and we would rather return a truncated result (with a warning) than
 * burn most of a user's 1,000 daily calls on one grid.
 */
export const MAX_PAGES_PER_FIND = 40;

export type PlanRequest =
  | { kind: "search"; params: CachedSearchParams; pages: number }
  | { kind: "availability"; source: string; params: BulkAvailabilityParams; pages: number };

export interface FindPlan {
  mode: "cached" | "bulk";
  requests: PlanRequest[];
  /** Calls the chosen mode is expected to consume. */
  estimated_calls: number;
  cached_calls: number;
  /** null when the query does not name programs (bulk needs one source per request). */
  bulk_calls: number | null;
  expected_rows: number;
  pairs: RoutePair[];
  days: number;
  programs: string[] | null;
}

export interface PlanOptions {
  /** Sharpen the bulk estimate with known monitored routes (no API calls). */
  routesKnown?: RoutesKnowledge;
}

export function pairsOf(query: Pick<QueryObject, "origins" | "destinations">): RoutePair[] {
  const out: RoutePair[] = [];
  for (const origin of query.origins) {
    for (const dest of query.destinations) out.push({ origin, dest, key: `${origin}-${dest}` });
  }
  return out;
}

export function daySpan(date_from: string, date_to: string): number {
  const from = Date.parse(`${date_from}T00:00:00Z`);
  const to = Date.parse(`${date_to}T00:00:00Z`);
  return Math.max(1, Math.round((to - from) / 86_400_000) + 1);
}

export function planFind(query: QueryObject, opts: PlanOptions = {}): FindPlan {
  const pairs = pairsOf(query);
  const days = daySpan(query.date_from, query.date_to);
  const programs = query.programs && query.programs.length > 0 ? [...query.programs] : null;
  const programCount = programs ? programs.length : SEATS_SOURCES.length;
  const cabins = query.cabins.map((c) => CABIN_LETTER_TO_NAME[c]);

  const expectedRows = pairs.length * days * programCount * query.cabins.length * ROW_DENSITY;
  const search: PlanRequest = {
    kind: "search",
    pages: pagesFor(expectedRows, PAGE_SIZE),
    params: {
      origin_airport: [...query.origins],
      destination_airport: [...query.destinations],
      start_date: query.date_from,
      end_date: query.date_to,
      take: PAGE_SIZE,
      order_by: "lowest_mileage",
      cabins,
      ...(programs ? { sources: programs } : {}),
      ...(query.direct_only ? { only_direct_flights: true } : {}),
      ...(query.include_filtered ? { include_filtered: true } : {}),
      // 100 is the API's own default: emitting nothing keeps the request byte-identical to
      // what this product sent before min_cabin_pct existed.
      ...(query.min_cabin_pct < 100 ? { min_cabin_pct: query.min_cabin_pct } : {}),
    },
  };
  const cachedCalls = search.pages;

  let bulkRequests: PlanRequest[] | null = null;
  if (programs) {
    bulkRequests = programs.flatMap((source) => bulkRequestsFor(source, query, days, opts.routesKnown));
  }
  const bulkCalls = bulkRequests ? estimateCalls({ requests: bulkRequests }) : null;
  // Bulk needs at least one request: a catalog saying "no program monitors these airports"
  // could be a week stale, so we still spend the one cached call rather than return nothing.
  const useBulk = bulkRequests !== null && bulkRequests.length > 0 && bulkCalls !== null && bulkCalls < cachedCalls;

  return {
    mode: useBulk ? "bulk" : "cached",
    requests: useBulk && bulkRequests ? bulkRequests : [search],
    estimated_calls: useBulk && bulkCalls !== null ? bulkCalls : cachedCalls,
    cached_calls: cachedCalls,
    bulk_calls: bulkCalls,
    expected_rows: Math.round(expectedRows),
    pairs,
    days,
    programs,
  };
}

/**
 * Bulk Availability walks a program's monitored routes (optionally sliced by region), so its
 * row count depends on the program's route count, not on how many pairs were asked for.
 * With the catalog known we slice by (origin region, destination region) and count exactly;
 * without it we assume ASSUMED_ROUTES_PER_PROGRAM with no region filter.
 */
function bulkRequestsFor(
  source: string,
  query: QueryObject,
  days: number,
  routesKnown: RoutesKnowledge | undefined,
): PlanRequest[] {
  const cabin = query.cabins.length === 1 ? CABIN_LETTER_TO_NAME[query.cabins[0]!] : undefined;
  const base: BulkAvailabilityParams = {
    source,
    start_date: query.date_from,
    end_date: query.date_to,
    take: PAGE_SIZE,
    ...(cabin ? { cabin } : {}),
    ...(query.include_filtered ? { include_filtered: true } : {}),
    ...(query.min_cabin_pct < 100 ? { min_cabin_pct: query.min_cabin_pct } : {}),
  };
  const routes = routesKnown?.routesFor(source);
  if (!routes) {
    const rows = ASSUMED_ROUTES_PER_PROGRAM * days * query.cabins.length * ROW_DENSITY;
    return [{ kind: "availability", source, params: base, pages: pagesFor(rows, PAGE_SIZE) }];
  }
  // Region pairs touched by the requested airports, and how many monitored routes sit in each.
  const originRegions = new Set<string>();
  const destRegions = new Set<string>();
  for (const r of routes) {
    if (query.origins.includes(r.OriginAirport)) originRegions.add(r.OriginRegion);
    if (query.destinations.includes(r.DestinationAirport)) destRegions.add(r.DestinationRegion);
  }
  const out: PlanRequest[] = [];
  for (const o of originRegions) {
    for (const d of destRegions) {
      const count = routes.filter((r) => r.OriginRegion === o && r.DestinationRegion === d).length;
      if (count === 0) continue;
      const rows = count * days * query.cabins.length * ROW_DENSITY;
      out.push({
        kind: "availability",
        source,
        params: { ...base, origin_region: o as SeatsRegion, destination_region: d as SeatsRegion },
        pages: pagesFor(rows, PAGE_SIZE),
      });
    }
  }
  // Catalog known and none of the requested airports appear: this program cannot yield rows.
  return out;
}

// ---------------------------------------------------------------------------
// runFind
// ---------------------------------------------------------------------------

export interface RunFindOptions {
  query: QueryObject;
  userId: string;
  /**
   * The calling user's own seats.aero key. Required — there is no default key, and there is
   * deliberately no injectable client either: every request of this run is made by a client
   * built from THIS key, so a caller cannot route one user's search through another's key
   * (§0.2 #2). Tests inject `fetch` instead.
   */
  apiKey: string;
  fetch?: typeof fetch;
  quota: Quota;
  cache: AvailabilityCacheStore;
  routes?: RoutesCatalog;
  now?: () => Date;
  /** Cache TTL in minutes; default from CACHE_TTL_MINUTES (45). */
  ttlMinutes?: number;
  /** Cap on Get Routes calls spent detecting unmonitored pairs; default 26. */
  maxRoutesCalls?: number;
  /** Cap on search/availability pages for this run; default MAX_PAGES_PER_FIND. */
  maxPages?: number;
}

export interface FindResult {
  rows: AvailabilityRow[];
  /** Every HTTP request this run made (search/availability pages + Get Routes). */
  api_calls_used: number;
  /** The part of api_calls_used spent on Get Routes (cached 7 days per user/source). */
  routes_calls_used: number;
  served_from_cache: boolean;
  unmonitored_pairs: RoutePair[];
  /** English renderings of `notices` (CLI, logs, tests). */
  warnings: string[];
  /** Structured {code, vars} for translation in the UI. */
  notices: Notice[];
  /** The plan that was executed; null when served from cache. */
  plan: FindPlan | null;
  /** Oldest fetched_at among the returned rows (null when empty). */
  fetched_at_min: string | null;
  /**
   * How much of the query's scope this result covers (UI/UX v1 T03): per pair, checked to the end, stopped at the
   * page cap or for quota, not monitored, or unknown (a cache hit on records that carry no evidence). Always set
   * by runFind; optional only so results built elsewhere keep compiling.
   */
  coverage?: CoverageEvidence;
}

export async function runFind(opts: RunFindOptions): Promise<FindResult> {
  if (typeof opts.apiKey !== "string" || opts.apiKey.trim() === "") {
    throw new SeatsAeroError("runFind requires the calling user's seats.aero API key");
  }
  const { query, userId, quota, cache, routes } = opts;
  const now = opts.now ?? (() => new Date());
  const ttl = opts.ttlMinutes ?? cacheTtlMinutesFromEnv();
  const notices: Notice[] = [];
  const pairs = pairsOf(query);
  const programs = query.programs && query.programs.length > 0 ? [...query.programs] : null;
  /**
   * The cached scope. `direct_only` matters twice: coverage recorded by a direct-only fetch
   * (only_direct_flights=true upstream) is a SUBSET of the data, so it never satisfies an
   * all-flights query; and when re-inserting a direct-only fetch we only replace direct
   * rows, so a fresh all-flights pull for the same scope stays intact.
   */
  const scope: CacheQuery = {
    origins: query.origins,
    dests: query.destinations,
    date_from: query.date_from,
    date_to: query.date_to,
    cabins: query.cabins,
    ...(programs ? { programs } : {}),
    direct_only: query.direct_only,
    include_filtered: query.include_filtered,
    // min_cabin_pct changes what the API returns exactly as include_filtered does, so it is
    // part of the scope: a 70 % search must not be answered from a 100 % record, nor poison it.
    min_cabin_pct: query.min_cabin_pct,
  };
  const sources = programs ?? [...SEATS_SOURCES];

  // (a) fresh coverage for every pair → serve from cache with zero calls.
  const coverage = await cache.getCoverage(userId, pairs);
  const uncovered = uncoveredPairs(scope, coverage, ttl, now());
  if (uncovered.length === 0) {
    const cached = await cache.getRows(userId, scope);
    const rows = cached.rows;
    const zero = zeroRowPairs(pairs, rows);
    // Only claim "not monitored" when THIS user's catalog knows every requested source. The
    // catalog may be a fresh instance (one per web request): hydrate from the routes store
    // first — that reads what earlier requests paid for and never calls the API.
    if (routes) await routes.hydrate(userId, sources);
    const allLoaded = routes !== undefined && sources.every((s) => routes.isLoaded(userId, s));
    const unmonitoredPairs = allLoaded ? routes.unmonitoredPairs(userId, zero, sources) : [];
    // The evidence comes from the records that satisfied the lookup: a record written by a capped fetch stays
    // partial on every later hit, and one written before evidence existed proves nothing (unknown).
    const nowAtHit = now();
    const cachedCoverage = coverageFor(
      query,
      pairs.map((p) => ({
        origin: p.origin,
        dest: p.dest,
        evidence: recordEvidence(coverage, p, scope, ttl, nowAtHit),
        unmonitored: unmonitoredPairs.some((u) => u.key === p.key),
      })),
    );
    return {
      rows,
      api_calls_used: 0,
      routes_calls_used: 0,
      served_from_cache: true,
      unmonitored_pairs: unmonitoredPairs,
      warnings: noticesToText(notices),
      notices,
      plan: null,
      fetched_at_min: cached.fetched_at_min,
      coverage: cachedCoverage,
    };
  }

  // (b) quota check on the estimate BEFORE any request.
  const plan = planFind(query, routes ? { routesKnown: routes.knowledgeFor(userId) } : {});
  await quota.assertCanCall(userId, plan.estimated_calls);

  // (c) execute, counting every HTTP request through the client's listener. Quota is RESERVED
  // before each phase and the unused part refunded afterwards, so concurrent runs for the same
  // user share the headroom instead of each spending it in full (§4.3 "stop at 950").
  const client = new SeatsAeroClient({ apiKey: opts.apiKey, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
  let calls = 0;
  const unsubscribe = client.subscribe(() => {
    calls += 1;
  });
  const fetchedAt = now().toISOString();
  let rows: AvailabilityRow[] = [];
  const unmonitored: RoutePair[] = [];
  let reserved = 0;
  let routesCalls = 0;
  const outcomes: RequestOutcome[] = [];
  let runEvidenceProven: CoverageRecordEvidence = { state: "partial", reason: "quota" };
  // One UTC day key for the whole run: reservations made before midnight are settled on the
  // same day after it (otherwise a refund would over-credit the new day).
  const day = quota.today();
  try {
    const remaining = await quota.remaining(userId);
    const pageLimit = opts.maxPages ?? MAX_PAGES_PER_FIND;
    const pageCap = await quota.reserve(userId, Math.max(1, Math.min(remaining, pageLimit)), day);
    reserved += pageCap;
    const availabilities = await executePlan(plan, client, pageCap, notices, outcomes);
    // A stop is a quota stop when the day's remaining quota, not the page cap, set this run's budget.
    const evidence = runEvidence(outcomes, { quotaBound: pageCap < pageLimit });
    runEvidenceProven = evidence;

    // (d) normalize, filter locally to the query, replace the cached scope, record coverage.
    // A truncated pull (page cap / quota headroom) is still recorded as coverage: the
    // warning tells the user, and refetching the same incomplete scope every render would
    // only spend more quota on the same answer. `all` keeps every cabin row of the fetched objects (a direct-only upstream filter is
    // per object, so an object can still carry a non-direct cabin); `rows` is the answer.
    const all = availabilitiesToRows(availabilities, {
      fetchedAt,
      includeFiltered: query.include_filtered,
      minCabinPct: query.min_cabin_pct,
    }).filter((r) =>
      rowMatches(r, { ...scope, direct_only: false }),
    );
    rows = all.filter((r) => rowMatches(r, scope));
    const records: CoverageRecord[] = pairs.map((p) => ({
      origin: p.origin,
      dest: p.dest,
      date_from: query.date_from,
      date_to: query.date_to,
      cabins: [...query.cabins],
      programs,
      direct_only: query.direct_only,
      include_filtered: query.include_filtered,
      min_cabin_pct: query.min_cabin_pct,
      fetched_at: fetchedAt,
      evidence,
    }));
    // One unit when the store supports it: a failure between "delete" and "mark" must not leave an earlier
    // fetch's record claiming the rows this run just removed.
    if (cache.replaceScope) {
      await cache.replaceScope(userId, scope, all, records);
    } else {
      await cache.deleteRows(userId, scope);
      await cache.putRows(userId, all);
      await cache.markPairsFetched(userId, records);
    }

    // (e) zero-row pairs → consult the routes catalog within the remaining soft quota.
    const zero = zeroRowPairs(pairs, rows);
    if (zero.length > 0 && routes) {
      // Settle the search reservation first so `remaining` reflects what this run really spent.
      await quota.release(userId, reserved - calls, day);
      reserved = calls;
      const left = await quota.remaining(userId);
      const wanted = Math.min(left, sources.filter((s) => !routes.isLoaded(userId, s)).length, opts.maxRoutesCalls ?? SEATS_SOURCES.length);
      const cap = wanted > 0 ? await quota.reserve(userId, wanted, day) : 0;
      reserved += cap;
      const loaded = await routes.ensureLoaded(userId, sources, client, { maxFetches: cap });
      routesCalls = loaded.fetched.length;
      if (loaded.skipped.length > 0) {
        notices.push(notice("find.routes_skipped", { pairs: zero.length, skipped: loaded.skipped.length }));
      } else {
        unmonitored.push(...routes.unmonitoredPairs(userId, zero, sources));
      }
    }
  } finally {
    unsubscribe();
    // Settle: refund the unused reservation, or (after a failure part-way) charge any call the
    // reservation did not already cover. Failed calls count too — seats.aero charged for them.
    if (reserved > calls) await quota.release(userId, reserved - calls, day);
    else if (calls > reserved) await quota.increment(userId, calls - reserved, day);
  }

  return {
    rows,
    api_calls_used: calls,
    routes_calls_used: routesCalls,
    served_from_cache: false,
    unmonitored_pairs: unmonitored,
    warnings: noticesToText(notices),
    notices,
    plan,
    fetched_at_min: rows.length > 0 ? fetchedAt : null,
    coverage: coverageFor(
      query,
      pairs.map((p) => ({ origin: p.origin, dest: p.dest, evidence: runEvidenceProven, unmonitored: unmonitored.some((u) => u.key === p.key) })),
    ),
  };
}

/**
 * Run every request of the plan, paginating within the quota headroom; dedupes across requests. How each request
 * ended is appended to `outcomes` (truncated at the page cap, or skipped because the budget ran out first), which
 * is what the run's coverage evidence is built from.
 */
async function executePlan(
  plan: FindPlan,
  client: SeatsAeroClient,
  maxTotalPages: number,
  notices: Notice[],
  outcomes: RequestOutcome[],
): Promise<Availability[]> {
  const seen = new Map<string, Availability>();
  let pagesLeft = maxTotalPages;
  for (const [i, req] of plan.requests.entries()) {
    if (pagesLeft <= 0) {
      notices.push(notice("find.quota_headroom"));
      for (let j = i; j < plan.requests.length; j++) outcomes.push({ truncated: false, skipped: true });
      break;
    }
    const result =
      req.kind === "search"
        ? await client.cachedSearchAll(req.params, { maxPages: pagesLeft })
        : await client.bulkAvailabilityAll(req.params, { maxPages: pagesLeft });
    outcomes.push({ truncated: result.truncated, skipped: false, ...(result.incomplete ? { incomplete: true } : {}) });
    pagesLeft -= result.pages;
    if (result.truncated) {
      notices.push(
        req.kind === "search"
          ? notice("find.truncated_search", { pages: result.pages })
          : notice("find.truncated_bulk", { pages: result.pages, source: req.source }),
      );
    }
    for (const av of result.data) if (!seen.has(av.ID)) seen.set(av.ID, av);
  }
  return [...seen.values()];
}

function zeroRowPairs(pairs: readonly RoutePair[], rows: readonly AvailabilityRow[]): RoutePair[] {
  const withRows = new Set(rows.map((r) => `${r.origin}-${r.dest}`));
  return pairs.filter((p) => !withRows.has(p.key));
}
