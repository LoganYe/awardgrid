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
import type { AvailabilityRow, Grid } from "@awardgrid/core/grid/types";
import { type Notice, isNotice } from "@awardgrid/core/notices";
import { parseQuery } from "@awardgrid/core/query/parse";
import { type Cabin, QueryObject } from "@awardgrid/core/query/schema";
import { isRealDate } from "@awardgrid/core/workspace/semantics";
import type { CoverageEvidence } from "@awardgrid/core/workspace/types";
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
import { type FindResult, pairsOf, runFind } from "@awardgrid/core/seatsaero/find";
import { notFetchedPairsFrom } from "@awardgrid/core/seatsaero/not-fetched";
import { Quota, QuotaExceededError } from "@awardgrid/core/seatsaero/quota";
import { ResilientRoutesCatalog, type RoutesCatalog } from "@awardgrid/core/seatsaero/routes";
import { SOURCE_NAMES } from "@awardgrid/core/seatsaero/types";
import { type GetTripsResult, runGetTrips } from "@awardgrid/core/seatsaero/trips";
import { type KeyCheckOutcome, checkSeatsKey } from "@awardgrid/core/seatsaero/key-check";
import { OAUTH } from "../app/flags";
import { localDate } from "../app/local-date";

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
  /**
   * The rows the grid was built from, as runFind returned them, and how much of the query's scope they cover
   * (UI/UX v1 T05: what a workspace snapshot is made of). Always set by SearchEngine; optional so a value built
   * elsewhere keeps compiling.
   */
  rows?: AvailabilityRow[];
  coverage?: CoverageEvidence | null;
}

/** A free-text query after the deterministic parser, before anything is fetched. */
export interface ParsedText {
  query: QueryObject;
  warnings: string[];
  notices: Notice[];
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
    // One program's route list failing costs its "not monitored" claim, never the rows the search paid for (#89).
    this.routes = opts.routes ?? new ResilientRoutesCatalog();
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
   *
   * The text is parsed, and the parsed query then runs on the SAME path as `searchQuery`: one executor, one
   * quota, one cache (UI/UX v1 T05, acceptance A09).
   */
  async search(text: string, apiKey: string | null): Promise<ApiResult<FindValue>> {
    const parsed = await this.parseText(text, apiKey);
    if (!parsed.ok) return parsed;
    return this.#execute(parsed.value.query, apiKey!, parsed.value);
  }

  /**
   * Check the key and parse free text, sending nothing. The same checks, in the same order, as `search`.
   *
   * No llmClient is passed: the grid lane is deterministic-only and needs no Anthropic key
   * (PIVOT §3). A query the parser cannot resolve becomes a `parse` failure with the missing
   * fields named, which is what the chip editors use to offer a manual fix.
   */
  async parseText(text: string, apiKey: string | null): Promise<ApiResult<ParsedText>> {
    if (!apiKey) return noKey();
    return this.parsePlan(text);
  }

  /**
   * The planner (release plan step 18): free text read by the same deterministic parser with no key asked for, since
   * nothing is fetched. What it returns is a plan to look at or save; only `parseText`, a search's first half, keeps
   * the key gate. A failure carries the parser's notice and the fields it could not read, so the planner can say them
   * in the screen's language.
   */
  async parsePlan(text: string): Promise<ApiResult<ParsedText>> {
    const trimmed = text.trim();
    if (!trimmed) return { ok: false, status: 400, error: "invalid_body", message: "Type a query first.", notice: { code: "parse.empty" } };
    try {
      // "Today" on the person's own calendar, not UTC's: in the US evening UTC is already tomorrow (PR-D).
      const parsed = await parseQuery(trimmed, { today: localDate(this.#now()) });
      return { ok: true, value: { query: parsed.query, warnings: parsed.warnings, notices: parsed.notices } };
    } catch (err) {
      const notice = noticeFrom(err);
      return {
        ok: false,
        status: 422,
        error: "parse",
        message: err instanceof Error ? err.message : "Could not read that query.",
        missing: missingFrom(err),
        ...(notice ? { notice } : {}),
      };
    }
  }

  /**
   * A structured query in, grid out: the entry the query editor and the workspace use (docs/03 §3). No text, no
   * parser, no LLM. An invalid query — schema, or a date that is not on the calendar — is `invalid_body` before
   * anything is sent.
   */
  async searchQuery(query: QueryObject, apiKey: string | null): Promise<ApiResult<FindValue>> {
    if (!apiKey) return noKey();
    const valid = QueryObject.safeParse(query);
    if (!valid.success || !isRealDate(valid.data.date_from) || !isRealDate(valid.data.date_to)) {
      return { ok: false, status: 400, error: "invalid_body", message: "That search is not a valid query." };
    }
    return this.#execute(valid.data, apiKey, { warnings: [], notices: [] });
  }

  /** The one executor both entries share. */
  async #execute(query: QueryObject, apiKey: string, parsed: { warnings: string[]; notices: Notice[] }): Promise<ApiResult<FindValue>> {
    try {
      const result = await runFind({
        query,
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
          grid: buildGrid(result.rows, query, {
            unmonitored_pairs: result.unmonitored_pairs,
            not_fetched_pairs: notFetchedPairsFrom(result, pairsOf(query)),
          }),
          query,
          warnings: [...parsed.warnings, ...runWarnings(result)],
          notices: [...parsed.notices, ...result.notices],
          quota: await this.quotaView(),
          served_from_cache: result.served_from_cache,
          api_calls_used: result.api_calls_used,
          fetched_at_min: result.fetched_at_min,
          rows: result.rows,
          coverage: result.coverage ?? null,
        },
      };
    } catch (err) {
      return await this.#failure(err);
    }
  }

  /**
   * Get Trips for one shown option (UI/UX v1 T10): exactly one seats.aero call, reserved on the same quota and
   * sent through the same transport as a search, with the fee it learns written back to the same cache
   * (core seatsaero/trips.ts runGetTrips). Only the option's own source id and cabin, and the scope it was fetched
   * in, are sent — never free text. The same failures as a search.
   */
  async getTrips(
    option: { availabilityId: string; cabin: Cabin; include_filtered: boolean; min_cabin_pct: number },
    apiKey: string | null,
  ): Promise<ApiResult<GetTripsResult>> {
    if (!apiKey) return noKey();
    try {
      const value = await runGetTrips({
        availabilityId: option.availabilityId,
        cabin: option.cabin,
        userId: LOCAL_USER,
        apiKey,
        fetch: this.#fetch,
        quota: this.quota,
        cache: this.cache,
        include_filtered: option.include_filtered,
        min_cabin_pct: option.min_cabin_pct,
      });
      return { ok: true, value };
    } catch (err) {
      return await this.#failure(err);
    }
  }

  /**
   * Check a seats.aero key before it is saved (T11): one call — the smallest Cached Search — through the same quota
   * and transport as a search (core seatsaero/key-check.ts). Only on the user's request; never to render a screen.
   */
  async checkKey(draft: string): Promise<KeyCheckOutcome> {
    try {
      const { api_calls_used: _calls, ...outcome } = await checkSeatsKey({ apiKey: draft, userId: LOCAL_USER, fetch: this.#fetch, quota: this.quota });
      return outcome;
    } catch {
      // The quota store itself failed; the engine answers with a value, as it does everywhere else.
      return { ok: false, reason: "unknown" };
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
      // 401/403 from seats.aero is a key it does not accept (wrong, or an account without API access): a key problem.
      const isAuth = err.status === 401 || err.status === 403;
      return {
        ok: false,
        status: err.status,
        error: isAuth ? "no_key" : "seatsaero",
        kind: `http_${err.status}`,
        message: isAuth
          ? OAUTH
            ? "seats.aero did not accept the connection. Connect your seats.aero account again in Settings."
            : "seats.aero did not accept the API key. Check it in Settings."
          : err.message,
      };
    }
    if (err instanceof SeatsAeroResponseError || err instanceof SeatsAeroError) {
      return { ok: false, status: 502, error: "seatsaero", kind: "response", message: err.message };
    }
    return { ok: false, status: 500, error: "internal", message: err instanceof Error ? err.message : String(err) };
  }
}

/** runFind's warnings in its order, one per notice, with the failed route list said the way this screen draws it. */
function runWarnings(result: Pick<FindResult, "warnings" | "notices" | "routes_failed" | "monitoring_unknown">): string[] {
  return result.warnings.map((text, i) => (result.notices[i]?.code === "find.routes_failed" ? routesFailedWarning(result) : text));
}

/**
 * The results screen's sentence for a route list that failed (#89). runFind's own is the web grid's ("Blank cells on
 * those routes may be unchecked rather than empty"), true there, where those cells read "not fetched", and not here:
 * these pairs were searched to the end, so their coverage stays complete, and only whether seats.aero monitors them is
 * open. Whether such a pair gets a label of its own is #78.
 */
export function routesFailedWarning(result: Pick<FindResult, "routes_failed" | "monitoring_unknown">): string {
  const programs = (result.routes_failed ?? []).map((s) => (SOURCE_NAMES as Partial<Record<string, string>>)[s] ?? s).join(", ");
  const unknown = result.monitoring_unknown ?? [];
  const lists = (result.routes_failed ?? []).length === 1 ? "list" : "lists";
  const head = `Couldn't load the route ${lists} for ${programs}: seats.aero returned an error.`;
  if (unknown.length === 0) return `${head} It does not change these results.`;
  const routes = unknown.map((p) => `${p.origin} → ${p.dest}`).join(", ");
  return unknown.length === 1
    ? `${head} ${routes} was searched to the end, but whether seats.aero monitors it is unknown.`
    : `${head} ${routes} were searched to the end, but whether seats.aero monitors them is unknown.`;
}

function noKey(): ApiFailure {
  return { ok: false, status: 400, error: "no_key", message: "Connect your seats.aero account in Settings." };
}

/** `ParseError` carries the field names the chip editors need; anything else has none. */
function missingFrom(err: unknown): string[] | undefined {
  const missing = (err as { missing?: unknown })?.missing;
  return Array.isArray(missing) ? missing.filter((m): m is string => typeof m === "string") : undefined;
}

/** `ParseError` also carries its message as a notice ({code, vars}), which a screen can say in its own language. */
function noticeFrom(err: unknown): Notice | undefined {
  const notice = (err as { notice?: unknown })?.notice;
  return isNotice(notice) ? notice : undefined;
}
