/**
 * RoutesCatalog — which (origin, dest) pairs each program is monitored on, from Get Routes.
 * Used so an empty cell can say "not monitored by seats.aero" instead of a silent blank
 * (kickoff §4.3).
 *
 * Design note (quota): GET /routes?source= is one call per program, so filling the catalog
 * for all 26 sources costs 26 of the user's 1,000 daily calls. The catalog is therefore
 * filled LAZILY — only for sources the user actually queried, and only after a pair came
 * back with zero rows (see find.ts step e). Entries are cached per (user, source) for 7 days
 * because monitored routes rarely change. Both the store AND the in-process index are keyed
 * by user: every entry was paid for with one user's key, so no other user may read it
 * (§0.2 #2, §12 "cache scope: per user key, never global").
 */
import { type SeatsAeroClient, SeatsAeroError, SeatsAeroHttpError, SeatsAeroNetworkError } from "./client";
import type { Route } from "./types";

export const ROUTES_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface RoutesEntry {
  routes: Route[];
  fetched_at: string; // ISO
}

export interface RoutesStore {
  get(userId: string, source: string): Promise<RoutesEntry | null>;
  put(userId: string, source: string, entry: RoutesEntry): Promise<void>;
}

export class InMemoryRoutesStore implements RoutesStore {
  readonly #entries = new Map<string, RoutesEntry>();
  async get(userId: string, source: string): Promise<RoutesEntry | null> {
    return this.#entries.get(`${userId} ${source}`) ?? null;
  }
  async put(userId: string, source: string, entry: RoutesEntry): Promise<void> {
    this.#entries.set(`${userId} ${source}`, { routes: [...entry.routes], fetched_at: entry.fetched_at });
  }
}

export interface RoutesCatalogOptions {
  store?: RoutesStore;
  now?: () => Date;
  ttlMs?: number;
}

export interface EnsureLoadedOptions {
  /** Upper bound on Get Routes calls this invocation may make (each missing source = 1). */
  maxFetches?: number;
}

export interface EnsureLoadedResult {
  /** Sources fetched from the API just now (each cost one call). */
  fetched: string[];
  /** Sources that were already loaded (memory or store). */
  cached: string[];
  /** Sources left unloaded because `maxFetches` ran out. */
  skipped: string[];
  /**
   * Sources left unloaded because their Get Routes call failed with a seats.aero error; each still cost one call.
   * Only ResilientRoutesCatalog reports these. The base class lets the error end the run, and leaves this absent.
   */
  failed?: string[];
}

export interface PairLike {
  origin: string;
  dest: string;
}

/**
 * Read-only, single-user view used by planFind: tells whether a source's routes are known
 * and gives the monitored pairs so estimates can be sharpened without any API call.
 * Obtain one with `catalog.knowledgeFor(userId)`.
 */
export interface RoutesKnowledge {
  routesFor(source: string): readonly Route[] | undefined;
}

interface LoadedSource {
  pairs: Set<string>;
  routes: Route[];
  /** ms since epoch; the in-process copy expires with the same TTL as the store entry. */
  fetchedAt: number;
}

export class RoutesCatalog {
  readonly #store: RoutesStore;
  readonly #now: () => Date;
  readonly #ttlMs: number;
  /** In-process view for synchronous lookups: userId → source → "ORIG-DEST" set + raw routes. */
  readonly #loaded = new Map<string, Map<string, LoadedSource>>();

  constructor(opts: RoutesCatalogOptions = {}) {
    this.#store = opts.store ?? new InMemoryRoutesStore();
    this.#now = opts.now ?? (() => new Date());
    this.#ttlMs = opts.ttlMs ?? ROUTES_TTL_MS;
  }

  /**
   * True when a fresh copy is in memory. An entry older than the TTL is evicted here, so a
   * long-lived web process re-reads the store / calls Get Routes again after 7 days instead of
   * answering "not monitored" from a stale index forever.
   */
  isLoaded(userId: string, source: string): boolean {
    return this.#fresh(userId, source) !== undefined;
  }

  loadedSources(userId: string): string[] {
    const perUser = this.#loaded.get(userId);
    if (!perUser) return [];
    return [...perUser.keys()].filter((source) => this.isLoaded(userId, source));
  }

  routesFor(userId: string, source: string): readonly Route[] | undefined {
    return this.#fresh(userId, source)?.routes;
  }

  /** The planFind view of this user's loaded routes (never another user's). */
  knowledgeFor(userId: string): RoutesKnowledge {
    return { routesFor: (source) => this.routesFor(userId, source) };
  }

  /** Feed routes obtained elsewhere (tests, warm-up). Persists to the store. */
  async prime(userId: string, source: string, routes: readonly Route[], fetchedAt?: string): Promise<void> {
    const entry = { routes: [...routes], fetched_at: fetchedAt ?? this.#now().toISOString() };
    await this.#store.put(userId, source, entry);
    this.#index(userId, source, entry.routes, Date.parse(entry.fetched_at));
  }

  /**
   * Pull `sources` into the in-process index from the STORE only — zero API calls. Returns
   * the sources that are loaded afterwards. The web app builds a fresh catalog per request,
   * so a grid served from the availability cache must hydrate this way before it can claim
   * "not monitored" for a pair whose route lists were paid for on an earlier request.
   */
  async hydrate(userId: string, sources: readonly string[]): Promise<string[]> {
    const loaded: string[] = [];
    for (const source of sources) {
      if (await this.#loadFromStore(userId, source)) loaded.push(source);
    }
    return loaded;
  }

  /**
   * Make sure `sources` are loaded for this user, reading the store first and calling
   * Get Routes (through `client`, i.e. the user's own key) only for missing/expired ones,
   * never more than `maxFetches` times.
   */
  async ensureLoaded(
    userId: string,
    sources: readonly string[],
    client: SeatsAeroClient,
    opts: EnsureLoadedOptions = {},
  ): Promise<EnsureLoadedResult> {
    const result: EnsureLoadedResult = { fetched: [], cached: [], skipped: [] };
    let budget = opts.maxFetches ?? Number.POSITIVE_INFINITY;
    for (const source of sources) {
      if (await this.#loadFromStore(userId, source)) {
        result.cached.push(source);
        continue;
      }
      if (budget <= 0) {
        result.skipped.push(source);
        continue;
      }
      budget -= 1;
      const routes = await client.getRoutes(source);
      await this.prime(userId, source, routes);
      result.fetched.push(source);
    }
    return result;
  }

  /** True when the (loaded) source monitors origin→dest. Unknown sources return false. */
  isMonitored(userId: string, source: string, origin: string, dest: string): boolean {
    return this.#fresh(userId, source)?.pairs.has(`${origin}-${dest}`) ?? false;
  }

  /**
   * Pairs that NONE of `sources` monitors. Only sources that are loaded are consulted; pass
   * the result of ensureLoaded so unloaded sources do not produce false "unmonitored" claims.
   */
  unmonitoredPairs<P extends PairLike>(userId: string, pairs: readonly P[], sources: readonly string[]): P[] {
    const known = sources.filter((s) => this.isLoaded(userId, s));
    if (known.length === 0) return [];
    return pairs.filter((p) => !known.some((s) => this.isMonitored(userId, s, p.origin, p.dest)));
  }

  /** True when the source is loaded afterwards (already in memory, or a fresh store entry was indexed). */
  async #loadFromStore(userId: string, source: string): Promise<boolean> {
    if (this.isLoaded(userId, source)) return true;
    const stored = await this.#store.get(userId, source);
    if (stored && this.#now().getTime() - Date.parse(stored.fetched_at) < this.#ttlMs) {
      this.#index(userId, source, stored.routes, Date.parse(stored.fetched_at));
      return true;
    }
    return false;
  }

  /** The in-memory entry when it exists and is younger than the TTL; expired ones are evicted. */
  #fresh(userId: string, source: string): LoadedSource | undefined {
    const perUser = this.#loaded.get(userId);
    const entry = perUser?.get(source);
    if (!entry) return undefined;
    if (this.#now().getTime() - entry.fetchedAt >= this.#ttlMs) {
      perUser?.delete(source);
      return undefined;
    }
    return entry;
  }

  #index(userId: string, source: string, routes: readonly Route[], fetchedAt: number): void {
    const pairs = new Set<string>();
    for (const r of routes) pairs.add(`${r.OriginAirport}-${r.DestinationAirport}`);
    let perUser = this.#loaded.get(userId);
    if (!perUser) {
      perUser = new Map();
      this.#loaded.set(userId, perUser);
    }
    perUser.set(source, { pairs, routes: [...routes], fetchedAt });
  }
}

/**
 * A catalog whose Get Routes failure for ONE program does not end the run (#89). A route list only decides whether an
 * empty pair may be called "not monitored", so losing one should cost that claim, not the rows the run already paid
 * for. A seats.aero error on `/routes?source=x` (an HTTP error other than a rejected key, or a response that does not
 * match the schema) leaves that source unloaded and reports it in `failed`; its call still counts against
 * `maxFetches`, since seats.aero charged for it. A rejected key and a transport error still propagate: they affect
 * every request, and hiding them would hide a broken key or a dead connection.
 *
 * The rule is the web facade's ResilientRoutesCatalog (src/lib/server/find.ts:122-150). That one puts a failed source
 * in `skipped` and remembers it on the instance, which suits a catalog built per request; this one reports failures
 * per call, because the iOS engine keeps one catalog for the life of the app, and runFind reads them from the result.
 */
export class ResilientRoutesCatalog extends RoutesCatalog {
  override async ensureLoaded(
    userId: string,
    sources: readonly string[],
    client: SeatsAeroClient,
    opts: EnsureLoadedOptions = {},
  ): Promise<EnsureLoadedResult> {
    const result: EnsureLoadedResult = { fetched: [], cached: [], skipped: [], failed: [] };
    let budget = opts.maxFetches ?? Number.POSITIVE_INFINITY;
    for (const source of sources) {
      try {
        const one = await super.ensureLoaded(userId, [source], client, { maxFetches: budget });
        budget -= one.fetched.length;
        result.fetched.push(...one.fetched);
        result.cached.push(...one.cached);
        result.skipped.push(...one.skipped);
      } catch (err) {
        if (!survivable(err)) throw err;
        budget -= 1;
        result.failed!.push(source);
      }
    }
    return result;
  }
}

/** A seats.aero error about this one request: not a rejected key, not a transport failure, not our own bug. */
function survivable(err: unknown): boolean {
  if (!(err instanceof SeatsAeroError) || err instanceof SeatsAeroNetworkError) return false;
  return !(err instanceof SeatsAeroHttpError && err.kind === "invalid_key");
}
