/**
 * The value every seats.aero call of an account sends: "Bearer seats:ota:…", which the core client puts in the
 * `Partner-Authorization` header exactly as seats.aero documents for an OAuth access token (developers.seats.aero,
 * "Using Access Tokens"). Search, details, standing queries and Ask all get it here, so none needs a second path.
 *
 * The access token lives about an hour; it is renewed through the token service (sites/auth /refresh) on the server,
 * as seats.aero asks, following the iPhone app's rules (apps/ios/src/oauth/token-store.ts):
 *
 *   - **Early.** A token with less than EARLY_REFRESH_MS left is renewed before it is handed out.
 *   - **One renewal at a time** per account in this process; across processes (the web app and `pnpm worker`) the
 *     row's generation decides which renewal is written, and a renewal that lost reads what won.
 *   - **A passing failure is not a disconnection.** The token service or seats.aero down: a token that still has time
 *     left is handed out as it is; one that has run out fails with SeatsRenewalUnavailableError ("try again soon").
 *   - **A revoked grant is.** seats.aero refusing the refresh token itself ("invalid_grant") removes the tokens and
 *     purges every seats.aero result the server holds for the account (./retention.ts), unless the row moved on
 *     meanwhile (another process renewed it, or the person connected again), whose tokens are then the answer.
 *   - **One retry after a refusal** (`withSeatsAuthorization`): seats.aero refusing a token the server thought valid
 *     renews it once and sends again; refused again with a token renewed just now, the refusal stands (the account,
 *     not its token: most likely one without API access).
 *
 * No token is logged, returned to a browser or placed on an error.
 */
import type { DbConn } from "@/lib/auth/clock";
import { getMasterKey } from "@/lib/keys";
import { SeatsAeroHttpError } from "@awardgrid/core/seatsaero/client";
import { type BrokerResult, type TokenBroker, createTokenBroker, meansRevoked } from "./broker";
import { tokenServiceUrlFromEnv } from "./config";
import { purgeSeatsDataForUser } from "./retention";
import { type SeatsTokens, type StoredConnection, deleteConnection, isSeatsConnected, readConnection, writeRefreshed } from "./store";

/** Renew when less than this is left. */
export const EARLY_REFRESH_MS = 5 * 60_000;
/** The prefix seats.aero's Partner-Authorization header takes before an OAuth access token. */
export const BEARER = "Bearer ";

export function bearer(access: string): string {
  return `${BEARER}${access}`;
}

/** The access token inside a Bearer value, or the value itself. */
export function accessOf(value: string): string {
  return value.startsWith(BEARER) ? value.slice(BEARER.length) : value;
}

/**
 * No seats.aero account is connected (never connected, disconnected, or the grant was revoked). The API answers it as
 * 409 `no_key`, the code every client already knows; its copy says to connect seats.aero in Settings.
 */
export class SeatsNotConnectedError extends Error {
  readonly code = "no_key" as const;
  readonly provider = "seats_aero" as const;
  constructor() {
    super("No seats.aero account is connected. Connect seats.aero in Settings.");
    this.name = "SeatsNotConnectedError";
  }
}

/** The access token has run out and the token service could not renew it now: a passing failure, to try again soon. */
export class SeatsRenewalUnavailableError extends Error {
  readonly kind = "renewal_unavailable" as const;
  constructor() {
    super("The seats.aero sign-in could not be renewed right now. Try again in a minute.");
    this.name = "SeatsRenewalUnavailableError";
  }
}

export interface SeatsAccessOptions {
  /** MASTER_KEY override for tests; production reads process.env.MASTER_KEY. */
  masterKey?: Buffer;
  now?: () => Date;
  /** The token service client; production builds one from SEATS_OAUTH_TOKEN_SERVICE_URL. */
  broker?: TokenBroker;
  earlyMs?: number;
}

type RenewalOutcome = { kind: "fresh"; tokens: SeatsTokens } | { kind: "revoked" } | { kind: "cleared" } | { kind: "failed"; result: BrokerResult };

/** What renewing a refused token gave: a new value, or why there is none (the iPhone app's Renewal). */
export type Renewal = { key: string } | { key: null; reason: "none" | "unavailable" };

/** Renewals under way in this process, one per account. */
const inflight = new Map<string, Promise<RenewalOutcome>>();

function brokerOf(opts: SeatsAccessOptions): TokenBroker {
  return opts.broker ?? createTokenBroker({ baseUrl: tokenServiceUrlFromEnv() });
}

function nowMs(opts: SeatsAccessOptions): number {
  return (opts.now ?? (() => new Date()))().getTime();
}

function renew(db: DbConn, userId: string, current: StoredConnection, opts: SeatsAccessOptions, masterKey: Buffer): Promise<RenewalOutcome> {
  const running = inflight.get(userId);
  if (running) return running;
  const renewal = (async (): Promise<RenewalOutcome> => {
    const result = await brokerOf(opts).refresh(current.tokens.refresh);
    const now = nowMs(opts);
    // What is on file now, when the row moved on while this renewal was out.
    const latest = (): RenewalOutcome => {
      const stored = readConnection(db, userId, masterKey);
      return stored ? { kind: "fresh", tokens: stored.tokens } : { kind: "cleared" };
    };
    if (result.ok) {
      const tokens: SeatsTokens = { access: result.grant.access, refresh: result.grant.refresh ?? current.tokens.refresh, expiresAt: now + result.grant.expiresIn * 1000 };
      if (writeRefreshed(db, userId, current.generation, tokens, { masterKey, now: new Date(now) })) return { kind: "fresh", tokens };
      return latest();
    }
    if (meansRevoked(result)) {
      if (deleteConnection(db, userId, current.generation)) {
        purgeSeatsDataForUser(db, userId, new Date(now));
        return { kind: "revoked" };
      }
      // Renewed elsewhere with a rotated refresh token, disconnected, or connected again: not this grant's end.
      return latest();
    }
    return { kind: "failed", result };
  })().finally(() => {
    if (inflight.get(userId) === renewal) inflight.delete(userId);
  });
  inflight.set(userId, renewal);
  return renewal;
}

/**
 * "Bearer seats:ota:…" for the account, renewed first when it is about to run out. Throws SeatsNotConnectedError
 * (nothing connected, or the grant was just found revoked) or SeatsRenewalUnavailableError. The "connected" check runs
 * before MASTER_KEY is read, so an account without a connection gets a clean 409 even where MASTER_KEY is unset.
 */
export async function seatsAuthorization(db: DbConn, userId: string, opts: SeatsAccessOptions = {}): Promise<string> {
  if (!isSeatsConnected(db, userId)) throw new SeatsNotConnectedError();
  const masterKey = opts.masterKey ?? getMasterKey();
  const stored = readConnection(db, userId, masterKey);
  if (!stored) throw new SeatsNotConnectedError();
  const now = nowMs(opts);
  if (stored.tokens.expiresAt - now > (opts.earlyMs ?? EARLY_REFRESH_MS)) return bearer(stored.tokens.access);
  const outcome = await renew(db, userId, stored, opts, masterKey);
  if (outcome.kind === "fresh") return bearer(outcome.tokens.access);
  if (outcome.kind === "revoked" || outcome.kind === "cleared") throw new SeatsNotConnectedError();
  // A passing failure: the token on file while it lasts, so the request itself says what happened.
  if (stored.tokens.expiresAt > now) return bearer(stored.tokens.access);
  throw new SeatsRenewalUnavailableError();
}

/**
 * Renew now, because seats.aero refused `rejected` (a Bearer value or a bare token). When the token on file is no
 * longer that one, another caller has renewed it already, and it is returned as it is.
 */
export async function renewSeatsAuthorization(db: DbConn, userId: string, rejected: string, opts: SeatsAccessOptions = {}): Promise<Renewal> {
  if (!isSeatsConnected(db, userId)) return { key: null, reason: "none" };
  const masterKey = opts.masterKey ?? getMasterKey();
  const stored = readConnection(db, userId, masterKey);
  if (!stored) return { key: null, reason: "none" };
  if (accessOf(rejected) !== stored.tokens.access) return { key: bearer(stored.tokens.access) };
  const outcome = await renew(db, userId, stored, opts, masterKey);
  if (outcome.kind === "fresh") return { key: bearer(outcome.tokens.access) };
  return { key: null, reason: outcome.kind === "failed" ? "unavailable" : "none" };
}

/** seats.aero refused the token itself (401/403), as the core client classifies it. */
export function refusedBySeats(err: unknown): err is SeatsAeroHttpError {
  return err instanceof SeatsAeroHttpError && err.kind === "invalid_key";
}

/**
 * Run `attempt` with the account's authorization; when seats.aero refuses it, renew once and run once more with the
 * new one. A refusal of a token renewed just now propagates as seats.aero's own answer.
 */
export async function withSeatsAuthorization<T>(db: DbConn, userId: string, opts: SeatsAccessOptions, attempt: (authorization: string) => Promise<T>): Promise<T> {
  const authorization = await seatsAuthorization(db, userId, opts);
  try {
    return await attempt(authorization);
  } catch (err) {
    if (!refusedBySeats(err)) throw err;
    const renewal = await renewSeatsAuthorization(db, userId, authorization, opts);
    if (renewal.key === null) {
      if (renewal.reason === "unavailable") throw new SeatsRenewalUnavailableError();
      if (!isSeatsConnected(db, userId)) throw new SeatsNotConnectedError();
      throw err;
    }
    if (renewal.key === authorization) throw err;
    return attempt(renewal.key);
  }
}

/** The secrets an authorization carries, for redaction: the Bearer value and the bare token inside it. */
export function authorizationSecrets(authorization: string): string[] {
  return [authorization, accessOf(authorization)];
}

/** Test hook: forget renewals under way (each test opens a fresh database). */
export function resetRenewalsForTests(): void {
  inflight.clear();
}
