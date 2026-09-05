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
import { buildGrid } from "@/lib/grid/pivot";
import type { Grid, Orientation } from "@/lib/grid/types";
import { getDecryptedKey, getMasterKey, hasKey, NoKeyError } from "@/lib/keys";
import { BodyError } from "@/lib/server/http";
import { PARSER_MODEL_DEFAULT, ParseError, parseQuery, resolveParserModel, type ParseQueryResult, type ParserClient } from "@/lib/query";
import type { QueryObject } from "@/lib/query/schema";
import { SeatsAeroClient, SeatsAeroError, SeatsAeroHttpError, SeatsAeroNetworkError } from "@/lib/seatsaero/client";
import { seatsFetchFromEnv } from "./seats-fetch";
import { runFind } from "@/lib/seatsaero/find";
import { tripsToFees } from "@/lib/seatsaero/normalize";
import { Quota, QuotaExceededError, softLimitFromEnv } from "@/lib/seatsaero/quota";
import { RoutesCatalog } from "@/lib/seatsaero/routes";
import type { Cabin } from "@/lib/query/schema";
import type { Notice } from "@/lib/notices";
import type { Trip } from "@/lib/seatsaero/types";

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

function wiring(db: Db, now: () => Date) {
  const stores = createSqliteStores(db);
  const quota = new Quota({ store: stores.quota, now, softLimit: softLimitFromEnv() });
  const routes = new RoutesCatalog({ store: stores.routes, now });
  return { stores, quota, routes };
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

  const grid = buildGrid(result.rows, query, {
    orientation: opts.orientation ?? "dates",
    now: now(),
    unmonitored_pairs: result.unmonitored_pairs,
    api_calls_used: result.api_calls_used,
    served_from_cache: result.served_from_cache,
  });
  return { grid, warnings: result.warnings, notices: result.notices, quota: await snapshot(quota, user.id) };
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
 * Get Trips for one Availability ID — costs exactly one seats.aero call, reserved before the
 * request and charged whether it succeeds or fails (seats.aero charged for it either way).
 */
export async function getTripsForUser(
  db: Db,
  user: UserRef,
  availabilityId: string,
  opts: ServerFindOptions & { cabin?: Cabin; include_filtered?: boolean } = {},
): Promise<TripsForUserResult> {
  const now = opts.now ?? (() => new Date());
  const apiKey = resolveSeatsKey(db, user.id, opts.masterKey);
  const { quota } = wiring(db, now);

  const day = quota.today();
  await quota.reserve(user.id, 1, day); // throws QuotaExceededError with the reset time
  const fetchImpl = opts.fetch ?? seatsFetchFromEnv();
  const client = new SeatsAeroClient({ apiKey, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
  let calls = 0;
  const unsubscribe = client.subscribe(() => {
    calls += 1;
  });
  try {
    const res = await client.getTrips(availabilityId, opts.include_filtered ? { include_filtered: true } : {});
    const fees = tripsToFees(res, opts.cabin);
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
