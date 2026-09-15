/**
 * seats.aero Partner API client (kickoff §4.3).
 *
 * Only the four endpoints allowed by §0.2 #3 exist here: Cached Search, Bulk Availability,
 * Get Trips, Get Routes. Live Search is deliberately NOT implemented.
 *
 * Every HTTP request counts as one call against the user's 1,000/day Pro quota, so every
 * request is reported through `onCall` / `subscribe` listeners (the quota layer counts them).
 *
 * Key handling (§5, §0.2 #8): the key lives in a private field, goes out only in the
 * `Partner-Authorization` header, and is redacted from any error text just in case the
 * upstream echoes it. Errors never carry headers or the request options.
 */
import type { ZodType } from "zod";
import {
  BulkResponse,
  RoutesResponse,
  SearchResponse,
  TripsResponse,
  type Availability,
  type BulkAvailabilityParams,
  type CachedSearchParams,
  type GetTripsParams,
  type Route,
} from "./types";

export const SEATS_AERO_BASE_URL = "https://seats.aero/partnerapi/";
export const DEFAULT_TIMEOUT_MS = 20_000;
/** Largest page the API allows (`take` must be 10..1000). */
export const MAX_TAKE = 1000;
export const MIN_TAKE = 10;
/** The API's own default when `take` is omitted. */
export const DEFAULT_TAKE = 500;

export type SeatsAeroEndpoint = "search" | "availability" | "trips" | "routes";

/** Emitted once per HTTP request (success or failure). Never contains the key. */
export interface SeatsAeroCallInfo {
  endpoint: SeatsAeroEndpoint;
  /** Path + query string relative to the base URL (no host, no headers). */
  path: string;
  /** HTTP status, or 0 when the request failed before a response arrived. */
  status: number;
  durationMs: number;
}
export type SeatsAeroCallListener = (info: SeatsAeroCallInfo) => void;

export interface SeatsAeroClientOptions {
  apiKey: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  onCall?: SeatsAeroCallListener;
  timeoutMs?: number;
}

export interface PagedResult<T> {
  data: T[];
  /** HTTP requests performed for this result. */
  pages: number;
  /** True when `maxPages` stopped the loop while the API still reported more. */
  truncated: boolean;
}

export interface PaginateOptions {
  /** Hard cap on HTTP requests for one logical search; defaults to 20. */
  maxPages?: number;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class SeatsAeroError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeatsAeroError";
  }
}

export type SeatsAeroHttpKind = "invalid_key" | "rate_limited" | "unavailable" | "bad_request" | "http";

export class SeatsAeroHttpError extends SeatsAeroError {
  readonly status: number;
  readonly kind: SeatsAeroHttpKind;
  /** First ≤ 200 characters of the response body, key-redacted. */
  readonly bodySnippet: string;
  constructor(status: number, bodySnippet: string) {
    const kind = classifyStatus(status);
    super(`${messageFor(kind, status)}${bodySnippet ? `: ${bodySnippet}` : ""}`);
    this.name = "SeatsAeroHttpError";
    this.status = status;
    this.kind = kind;
    this.bodySnippet = bodySnippet;
  }
}

/** The upstream JSON did not match the documented schema. `path` is the zod issue path. */
export class SeatsAeroResponseError extends SeatsAeroError {
  readonly endpoint: SeatsAeroEndpoint;
  readonly path: string;
  constructor(endpoint: SeatsAeroEndpoint, path: string, detail: string) {
    super(`seats.aero ${endpoint} response did not match the documented schema at "${path}": ${detail}`);
    this.name = "SeatsAeroResponseError";
    this.endpoint = endpoint;
    this.path = path;
  }
}

/** fetch() itself failed or the request timed out (no HTTP status). */
export class SeatsAeroNetworkError extends SeatsAeroError {
  readonly timedOut: boolean;
  constructor(message: string, timedOut: boolean) {
    super(message);
    this.name = "SeatsAeroNetworkError";
    this.timedOut = timedOut;
  }
}

function classifyStatus(status: number): SeatsAeroHttpKind {
  if (status === 401 || status === 403) return "invalid_key";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "unavailable";
  if (status === 400 || status === 404 || status === 422) return "bad_request";
  return "http";
}

function messageFor(kind: SeatsAeroHttpKind, status: number): string {
  switch (kind) {
    case "invalid_key":
      return `seats.aero rejected the API key (invalid key, HTTP ${status})`;
    case "rate_limited":
      return "seats.aero rate limited this key (HTTP 429)";
    case "unavailable":
      return `seats.aero unavailable (HTTP ${status})`;
    case "bad_request":
      return `seats.aero rejected the request (HTTP ${status})`;
    default:
      return `seats.aero returned HTTP ${status}`;
  }
}

// ---------------------------------------------------------------------------
// Query-string encoding — names exactly as documented, arrays comma-joined,
// booleans as "true"/"false", undefined omitted. Commas are kept literal so the
// URL reads like the docs' examples (`origin_airport=SFO,LAX`).
// ---------------------------------------------------------------------------

export type QueryValue = string | number | boolean | readonly string[] | undefined;

export function encodeQuery(params: Record<string, QueryValue>): string {
  const parts: string[] = [];
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const raw = Array.isArray(value) ? value.join(",") : String(value);
    if (Array.isArray(value) && raw === "") continue;
    parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(raw).replace(/%2C/g, ",")}`);
  }
  return parts.join("&");
}

/** Query parameters for /search in documented order. Exported for tests. */
export function cachedSearchQuery(p: CachedSearchParams): string {
  return encodeQuery({
    origin_airport: p.origin_airport,
    destination_airport: p.destination_airport,
    start_date: p.start_date,
    end_date: p.end_date,
    cursor: p.cursor,
    take: optionalTake(p.take),
    order_by: p.order_by,
    skip: p.skip,
    include_trips: p.include_trips,
    only_direct_flights: p.only_direct_flights,
    carriers: p.carriers,
    include_filtered: p.include_filtered,
    sources: p.sources,
    minify_trips: p.minify_trips,
    cabins: p.cabins,
    min_cabin_pct: p.min_cabin_pct,
  });
}

/** Query parameters for /availability in documented order. Exported for tests. */
export function bulkAvailabilityQuery(p: BulkAvailabilityParams): string {
  return encodeQuery({
    source: p.source,
    cabin: p.cabin,
    start_date: p.start_date,
    end_date: p.end_date,
    origin_region: p.origin_region,
    destination_region: p.destination_region,
    take: optionalTake(p.take),
    cursor: p.cursor,
    skip: p.skip,
    include_filtered: p.include_filtered,
    min_cabin_pct: p.min_cabin_pct,
  });
}

export function getTripsQuery(p: GetTripsParams): string {
  return encodeQuery({ include_filtered: p.include_filtered, min_cabin_pct: p.min_cabin_pct });
}

/** Normalized page shape shared by /search and /availability. */
export interface AvailabilityPage {
  data: Availability[];
  hasMore: boolean;
  cursor: number | undefined;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class SeatsAeroClient {
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #listeners = new Set<SeatsAeroCallListener>();

  constructor(opts: SeatsAeroClientOptions) {
    if (typeof opts.apiKey !== "string" || opts.apiKey.trim() === "") {
      throw new SeatsAeroError("a seats.aero API key is required (no default key exists)");
    }
    this.#apiKey = opts.apiKey;
    this.#fetch = opts.fetch ?? globalThis.fetch;
    this.#baseUrl = (opts.baseUrl ?? SEATS_AERO_BASE_URL).replace(/\/?$/, "/");
    this.#timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (opts.onCall) this.#listeners.add(opts.onCall);
  }

  /** Register an extra per-request listener; returns an unsubscribe function. */
  subscribe(listener: SeatsAeroCallListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Keep the key out of console.log / util.inspect / JSON.stringify output. */
  toJSON(): Record<string, unknown> {
    return { baseUrl: this.#baseUrl, timeoutMs: this.#timeoutMs };
  }

  // ---- Cached Search ------------------------------------------------------

  async cachedSearch(params: CachedSearchParams): Promise<SearchResponse> {
    return this.#request("search", `search?${cachedSearchQuery(params)}`, SearchResponse);
  }

  /**
   * Fetch every page of a Cached Search. Pagination per the Concepts page: pass back the
   * FIRST response's `cursor` and `skip` = number of results already retrieved (raw count,
   * duplicates included); stop when `hasMore` is false. Objects are deduplicated by `ID`.
   * `take` defaults to the maximum (1000) because every request is one quota call.
   */
  async cachedSearchAll(params: CachedSearchParams, opts: PaginateOptions = {}): Promise<PagedResult<Availability>> {
    const take = clampTake(params.take ?? MAX_TAKE);
    return paginate(
      opts.maxPages ?? 20,
      async (cursor, skip) => {
        const res = await this.cachedSearch({ ...params, take, cursor, skip: skip > 0 ? skip : undefined });
        return { data: res.data, hasMore: res.hasMore ?? res.data.length >= take, cursor: res.cursor };
      },
      params.cursor,
      params.skip ?? 0,
    );
  }

  // ---- Bulk Availability ---------------------------------------------------

  /** One page of /availability, normalized whether the API sends the envelope or a bare array. */
  async bulkAvailability(params: BulkAvailabilityParams): Promise<AvailabilityPage> {
    const res = await this.#request("availability", `availability?${bulkAvailabilityQuery(params)}`, BulkResponse);
    const take = clampTake(params.take ?? DEFAULT_TAKE);
    if (Array.isArray(res)) {
      return { data: res, hasMore: res.length >= take, cursor: undefined };
    }
    return { data: res.data, hasMore: res.hasMore ?? res.data.length >= take, cursor: res.cursor };
  }

  async bulkAvailabilityAll(
    params: BulkAvailabilityParams,
    opts: PaginateOptions = {},
  ): Promise<PagedResult<Availability>> {
    const take = clampTake(params.take ?? MAX_TAKE);
    return paginate(
      opts.maxPages ?? 20,
      (cursor, skip) => this.bulkAvailability({ ...params, take, cursor, skip: skip > 0 ? skip : undefined }),
      params.cursor,
      params.skip ?? 0,
    );
  }

  // ---- Get Trips / Get Routes ---------------------------------------------

  async getTrips(id: string, params: GetTripsParams = {}): Promise<TripsResponse> {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new SeatsAeroError("invalid availability id");
    const qs = getTripsQuery(params);
    return this.#request("trips", `trips/${encodeURIComponent(id)}${qs ? `?${qs}` : ""}`, TripsResponse);
  }

  async getRoutes(source: string): Promise<Route[]> {
    return this.#request("routes", `routes?${encodeQuery({ source })}`, RoutesResponse);
  }

  // ---- Transport ------------------------------------------------------------

  async #request<T>(endpoint: SeatsAeroEndpoint, path: string, schema: ZodType<T>): Promise<T> {
    const url = this.#baseUrl + path;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    const started = Date.now();
    let status = 0;
    try {
      let response: Response;
      try {
        response = await this.#fetch(url, {
          method: "GET",
          // The only request header the reference documents. No Accept header: the API
          // returns JSON without it and §0.2 #7 forbids anything the docs do not back.
          headers: { "Partner-Authorization": this.#apiKey },
          signal: controller.signal,
        });
      } catch (err) {
        const timedOut = controller.signal.aborted;
        const detail = timedOut ? `timed out after ${this.#timeoutMs} ms` : this.#redact(errorMessage(err));
        throw new SeatsAeroNetworkError(`seats.aero ${endpoint} request failed: ${detail}`, timedOut);
      }
      status = response.status;
      const text = await response.text();
      if (!response.ok) {
        throw new SeatsAeroHttpError(status, this.#redact(text).slice(0, 200));
      }
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new SeatsAeroResponseError(endpoint, "", "body is not valid JSON");
      }
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const path = issue ? issue.path.map(String).join(".") : "";
        throw new SeatsAeroResponseError(endpoint, path, this.#redact(issue?.message ?? "unknown issue"));
      }
      return parsed.data;
    } finally {
      clearTimeout(timer);
      const info: SeatsAeroCallInfo = { endpoint, path, status, durationMs: Date.now() - started };
      for (const listener of this.#listeners) listener(info);
    }
  }

  #redact(text: string): string {
    return this.#apiKey.length > 0 ? text.split(this.#apiKey).join("[redacted]") : text;
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "unknown error";
}

/** Clamp to the documented range (`take` "must be >= 10 and <= 1000"). */
export function clampTake(take: number): number {
  return Math.min(MAX_TAKE, Math.max(MIN_TAKE, Math.trunc(take)));
}

/** Leave `take` out when unset (the API's default is 500); clamp it otherwise. */
function optionalTake(take: number | undefined): number | undefined {
  return take === undefined ? undefined : clampTake(take);
}

/**
 * Generic cursor+skip pagination with dedupe by `ID`. `fetchPage` receives the cursor from
 * the first response (undefined on the first request) and the raw number retrieved so far.
 */
export async function paginate(
  maxPages: number,
  fetchPage: (cursor: number | undefined, skip: number) => Promise<AvailabilityPage>,
  initialCursor: number | undefined = undefined,
  initialSkip = 0,
): Promise<PagedResult<Availability>> {
  const seen = new Map<string, Availability>();
  let cursor = initialCursor;
  let skip = initialSkip;
  let pages = 0;
  let truncated = false;
  for (;;) {
    if (pages >= Math.max(1, maxPages)) {
      truncated = true;
      break;
    }
    const page = await fetchPage(cursor, skip);
    pages += 1;
    for (const item of page.data) if (!seen.has(item.ID)) seen.set(item.ID, item);
    skip += page.data.length;
    if (cursor === undefined) cursor = page.cursor;
    if (!page.hasMore || page.data.length === 0) break;
  }
  return { data: [...seen.values()], pages, truncated };
}
