/**
 * The single-user replacement for `src/lib/server/find.ts:findGridForUser` (709 lines, multi-user,
 * database-backed). One device, one key, no accounts — so what is left is: parse, plan, fetch,
 * pivot.
 *
 * The result shape deliberately reuses `ApiResult` / `ApiFailureCode` from
 * `src/components/grid/api.ts`. PIVOT §2 asks for that explicitly — "whose ApiResult/ApiFailureCode
 * shape should be kept exactly so no caller changes" — because Phase 3 drops the real grid
 * components in here, and every one of them already branches on these codes to pick an empty state.
 * Two of the codes cannot occur in a client app and are kept anyway rather than pruned:
 * `unauthorized` (there are no sessions) and `internal` (there is no server to 500).
 */
import { buildGrid } from "@awardgrid/core/grid/pivot";
import type { Grid } from "@awardgrid/core/grid/types";
import type { Notice } from "@awardgrid/core/notices";
import { parseQuery } from "@awardgrid/core/query/parse";
import type { QueryObject } from "@awardgrid/core/query/schema";
import {
  InMemoryAvailabilityCache,
  type AvailabilityCacheStore,
} from "@awardgrid/core/seatsaero/cache";
import {
  SeatsAeroError,
  SeatsAeroHttpError,
  SeatsAeroNetworkError,
  SeatsAeroResponseError,
} from "@awardgrid/core/seatsaero/client";
import { pairsOf, runFind } from "@awardgrid/core/seatsaero/find";
import { notFetchedPairsFrom } from "@awardgrid/core/seatsaero/not-fetched";
import { Quota, QuotaExceededError } from "@awardgrid/core/seatsaero/quota";
import { RoutesCatalog } from "@awardgrid/core/seatsaero/routes";

/**
 * There is exactly one user, and `runFind` still wants an id because the core is shared with the
 * multi-user server. A constant keeps every cache and quota key stable across launches — a value
 * derived from the device or the key would silently orphan the cache on reinstall or key rotation.
 */
export const LOCAL_USER = "local";

export type ApiFailureCode =
  | "unauthorized"
  | "invalid_body"
  | "no_key"
  | "quota"
  | "parse"
  | "seatsaero"
  | "internal"
  | "network";

export interface ApiFailure {
  ok: false;
  status: number;
  error: ApiFailureCode;
  missing?: string[];
  message?: string;
  notice?: Notice;
  resetAt?: string;
  remaining?: number;
  requested?: number;
  kind?: string;
}

export type ApiResult<T> = { ok: true; value: T } | ApiFailure;

export interface QuotaSnapshotView {
  used: number;
  remaining: number;
  softLimit: number;
  resetAt: string;
}

export interface FindValue {
  grid: Grid;
  query: QueryObject;
  warnings: string[];
  notices: Notice[];
  quota: QuotaSnapshotView;
  served_from_cache: boolean;
  api_calls_used: number;
  /** Oldest fetched_at among the rows — the honest input to a "last checked" line. */
  fetched_at_min: string | null;
}

export interface SearchEngineOptions {
  fetchImpl: typeof fetch;
  cache?: AvailabilityCacheStore;
  routes?: RoutesCatalog;
  quota: Quota;
  now?: () => Date;
}

/**
 * Holds the device's stores for the lifetime of the app. Kept as a class so the shell can hand the
 * same instances to a snapshot writer without threading them through React.
 */
export class SearchEngine {
  readonly cache: AvailabilityCacheStore;
  readonly routes: RoutesCatalog;
  readonly quota: Quota;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;

  constructor(opts: SearchEngineOptions) {
    this.cache = opts.cache ?? new InMemoryAvailabilityCache();
    this.routes = opts.routes ?? new RoutesCatalog();
    this.quota = opts.quota;
    this.#fetch = opts.fetchImpl;
    this.#now = opts.now ?? (() => new Date());
  }

  async quotaView(): Promise<QuotaSnapshotView> {
    return {
      used: await this.quota.used(LOCAL_USER),
      remaining: await this.quota.remaining(LOCAL_USER),
      softLimit: this.quota.softLimit,
      resetAt: this.quota.resetAt().toISOString(),
    };
  }

  /**
   * Free text in, grid out. Every failure is a VALUE, never a throw, so the caller renders an empty
   * state instead of catching — the same contract `src/components/grid/api.ts` has always had.
   */
  async search(text: string, apiKey: string | null): Promise<ApiResult<FindValue>> {
    const now = this.#now();
    if (!apiKey) {
      return { ok: false, status: 400, error: "no_key", message: "Add your seats.aero Pro API key in Settings." };
    }
    const trimmed = text.trim();
    if (!trimmed) return { ok: false, status: 400, error: "invalid_body", message: "Type a query first." };

    // No llmClient is passed: the grid lane is deterministic-only and needs no Anthropic key
    // (PIVOT §3). A query the parser cannot resolve becomes a `parse` failure with the missing
    // fields named, which is what the chip editors use to offer a manual fix.
    let parsed;
    try {
      parsed = await parseQuery(trimmed, { today: now.toISOString().slice(0, 10) });
    } catch (err) {
      return {
        ok: false,
        status: 422,
        error: "parse",
        message: err instanceof Error ? err.message : "Could not read that query.",
        missing: missingFrom(err),
      };
    }

    try {
      const result = await runFind({
        query: parsed.query,
        userId: LOCAL_USER,
        apiKey,
        fetch: this.#fetch,
        quota: this.quota,
        cache: this.cache,
        routes: this.routes,
        now: this.#now,
      });

      return {
        ok: true,
        value: {
          // Empty cells carry their reason, as the web grid's do (src/lib/server/find.ts:387-412): a
          // pair seats.aero does not monitor, or one a truncated pull may never have reached, must
          // not read the same as a pair that was checked and had nothing. `pairsOf` is the pair list
          // runFind itself walked (find.ts:257); the web's `enumeratePairs` (grid/pivot.ts:48-56)
          // builds the identical list.
          grid: buildGrid(result.rows, parsed.query, {
            unmonitored_pairs: result.unmonitored_pairs,
            not_fetched_pairs: notFetchedPairsFrom(result, pairsOf(parsed.query)),
          }),
          query: parsed.query,
          warnings: [...parsed.warnings, ...result.warnings],
          notices: [...parsed.notices, ...result.notices],
          quota: await this.quotaView(),
          served_from_cache: result.served_from_cache,
          api_calls_used: result.api_calls_used,
          fetched_at_min: result.fetched_at_min,
        },
      };
    } catch (err) {
      return await this.#failure(err);
    }
  }

  async #failure(err: unknown): Promise<ApiFailure> {
    if (err instanceof QuotaExceededError) {
      return {
        ok: false,
        status: 429,
        error: "quota",
        remaining: err.remaining,
        requested: err.requested,
        resetAt: err.resetAt.toISOString(),
        message: err.message,
      };
    }
    if (err instanceof SeatsAeroNetworkError) {
      // Includes the native timeout. Phase 0 measured that the request itself is NOT recalled,
      // so this means "we stopped waiting", and the call may already have cost quota.
      return { ok: false, status: 504, error: "network", kind: "network", message: err.message };
    }
    if (err instanceof SeatsAeroHttpError) {
      // 401/403 from seats.aero is a bad or non-Pro key, which for this app is a key problem.
      const isAuth = err.status === 401 || err.status === 403;
      return {
        ok: false,
        status: err.status,
        error: isAuth ? "no_key" : "seatsaero",
        kind: `http_${err.status}`,
        message: isAuth
          ? "seats.aero rejected that key. Check it in Settings — the Partner API needs a Pro account."
          : err.message,
      };
    }
    if (err instanceof SeatsAeroResponseError || err instanceof SeatsAeroError) {
      return { ok: false, status: 502, error: "seatsaero", kind: "response", message: err.message };
    }
    return { ok: false, status: 500, error: "internal", message: err instanceof Error ? err.message : String(err) };
  }
}

/** `ParseError` carries the field names the chip editors need; anything else has none. */
function missingFrom(err: unknown): string[] | undefined {
  const missing = (err as { missing?: unknown })?.missing;
  return Array.isArray(missing) ? missing.filter((m): m is string => typeof m === "string") : undefined;
}
