/**
 * Per-user daily cost cap for the ask lane (kickoff §7.5, §12: $2 per user per UTC day).
 *
 * Accounting lives in the `ask_usage` table (user_id, day, cost_micro_usd, requests). Costs are
 * the SDK's `total_cost_usd` estimate (ARCHITECTURE §3: an estimate, not billing), stored as
 * integer micro-dollars so sums are exact.
 *
 *   reserveAsk   read-only check (GET /api/ask/usage): spent vs cap, nothing is charged.
 *   holdAsk      what a session does BEFORE spawning: atomically charges today's row with the
 *                per-request ceiling `budgetUsd = min(PER_REQUEST_MAX_USD, remaining)` and one
 *                request. Concurrent sessions therefore each see the previous holds, so N
 *                parallel POSTs cannot each be granted the same remaining dollars.
 *   settleHold   when the SDK result arrives: replaces the held ceiling with the actual
 *                `total_cost_usd`. A session that ends WITHOUT a result (timeout, abort, stream
 *                error, subprocess death — the SDK gives no cost readout on that path) is simply
 *                never settled: the ceiling stays charged as a conservative estimate, and the
 *                request stays counted.
 *   releaseHold  undoes a hold completely — only for sessions that never reached the model (the
 *                init-message check failed), where nothing could have been spent.
 *   settleAsk    plain "add this cost + one request" (kept for tests/tools that record a cost
 *                without a hold).
 *
 * better-sqlite3 is synchronous, so a hold's read + upsert cannot interleave with another hold in
 * the same process; the transaction makes it atomic across processes as well.
 */
import { and, eq, sql } from "drizzle-orm";
import { type ClockOptions, type DbConn, resolveNow } from "@/lib/auth/clock";
import { askUsage } from "@/lib/db/schema";

export const DEFAULT_DAILY_CAP_USD = 2;
export const DEFAULT_PER_REQUEST_MAX_USD = 0.5;

type Env = Record<string, string | undefined>;

function positiveNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** ASK_DAILY_COST_CAP_USD (default 2). */
export function dailyCapUsd(env: Env = process.env): number {
  return positiveNumber(env.ASK_DAILY_COST_CAP_USD, DEFAULT_DAILY_CAP_USD);
}

/** ASK_PER_REQUEST_MAX_USD (default 0.5). */
export function perRequestMaxUsd(env: Env = process.env): number {
  return positiveNumber(env.ASK_PER_REQUEST_MAX_USD, DEFAULT_PER_REQUEST_MAX_USD);
}

/** YYYY-MM-DD in UTC. */
export function askDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function usdToMicro(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.round(usd * 1_000_000);
}

export function microToUsd(micro: number): number {
  return micro / 1_000_000;
}

export interface AskUsage {
  userId: string;
  day: string;
  costMicroUsd: number;
  costUsd: number;
  requests: number;
}

export function getAskUsage(db: DbConn, userId: string, day: string): AskUsage {
  const row = db
    .select({ costMicroUsd: askUsage.costMicroUsd, requests: askUsage.requests })
    .from(askUsage)
    .where(and(eq(askUsage.userId, userId), eq(askUsage.day, day)))
    .get();
  const micro = row?.costMicroUsd ?? 0;
  return {
    userId,
    day,
    costMicroUsd: micro,
    costUsd: microToUsd(micro),
    requests: row?.requests ?? 0,
  };
}

export interface ReserveOptions extends ClockOptions {
  /** Override the daily cap (default: env ASK_DAILY_COST_CAP_USD or 2). */
  capUsd?: number;
}

export interface ReserveResult {
  allowed: boolean;
  /** Dollars left under the cap today (0 when denied). */
  remainingUsd: number;
  spentUsd: number;
  capUsd: number;
  day: string;
  requests: number;
}

/** Check-only: is the user still under today's cap? Denies when spent ≥ cap. */
export function reserveAsk(db: DbConn, userId: string, opts: ReserveOptions = {}): ReserveResult {
  const now = resolveNow(opts);
  const day = askDayKey(now);
  const capUsd = opts.capUsd ?? dailyCapUsd();
  const usage = getAskUsage(db, userId, day);
  const remaining = Math.max(0, capUsd - usage.costUsd);
  const allowed = usage.costUsd < capUsd && remaining > 0;
  return {
    allowed,
    remainingUsd: allowed ? remaining : 0,
    spentUsd: usage.costUsd,
    capUsd,
    day,
    requests: usage.requests,
  };
}

/** The SDK `maxBudgetUsd` for one session: min(per-request ceiling, what is left today), never below 1 cent. */
export function perRequestBudgetUsd(remainingUsd: number, perRequest: number = perRequestMaxUsd()): number {
  return Math.max(0.01, Math.min(perRequest, remainingUsd));
}

export interface HoldOptions extends ReserveOptions {
  /** Override the per-request ceiling (default: env ASK_PER_REQUEST_MAX_USD or 0.5). */
  perRequestUsd?: number;
}

/** A charged reservation; hand it back to `settleHold` / `releaseHold`. */
export interface AskHold {
  userId: string;
  day: string;
  /** The ceiling charged up front (== the session's `maxBudgetUsd`). */
  budgetUsd: number;
  budgetMicroUsd: number;
}

export type HoldResult =
  | ({ allowed: true; hold: AskHold } & ReserveResult)
  | ({ allowed: false; hold: null } & ReserveResult);

function addMicro(db: DbConn, userId: string, day: string, micro: number, requests: number): void {
  db.insert(askUsage)
    .values({ userId, day, costMicroUsd: micro, requests })
    .onConflictDoUpdate({
      target: [askUsage.userId, askUsage.day],
      set: {
        costMicroUsd: sql`max(0, ${askUsage.costMicroUsd} + ${micro})`,
        requests: sql`max(0, ${askUsage.requests} + ${requests})`,
      },
    })
    .run();
}

/**
 * Check today's cap and, when allowed, charge the per-request ceiling + one request atomically.
 * `remainingUsd`/`spentUsd`/`requests` describe the state BEFORE the hold.
 */
export function holdAsk(db: DbConn, userId: string, opts: HoldOptions = {}): HoldResult {
  const perRequest = opts.perRequestUsd ?? perRequestMaxUsd();
  return db.transaction((tx) => {
    const r = reserveAsk(tx, userId, opts);
    if (!r.allowed) return { ...r, hold: null } as HoldResult;
    const budgetUsd = perRequestBudgetUsd(r.remainingUsd, perRequest);
    const budgetMicroUsd = usdToMicro(budgetUsd);
    addMicro(tx, userId, r.day, budgetMicroUsd, 1);
    return { ...r, hold: { userId, day: r.day, budgetUsd, budgetMicroUsd } } as HoldResult;
  });
}

/** Replace the held ceiling with the session's actual cost (the request stays counted). Returns the new totals. */
export function settleHold(db: DbConn, hold: AskHold, actualCostUsd: number): AskUsage {
  const delta = usdToMicro(actualCostUsd) - hold.budgetMicroUsd;
  addMicro(db, hold.userId, hold.day, delta, 0);
  return getAskUsage(db, hold.userId, hold.day);
}

/** Undo a hold entirely (ceiling and request) — for sessions that never reached the model. */
export function releaseHold(db: DbConn, hold: AskHold): AskUsage {
  addMicro(db, hold.userId, hold.day, -hold.budgetMicroUsd, -1);
  return getAskUsage(db, hold.userId, hold.day);
}

/** Record a finished session: adds micro-dollars and one request to today's row (upsert). Returns the new totals. */
export function settleAsk(
  db: DbConn,
  userId: string,
  costUsd: number,
  opts: ClockOptions = {},
): AskUsage {
  const now = resolveNow(opts);
  const day = askDayKey(now);
  const micro = usdToMicro(costUsd);
  db.insert(askUsage)
    .values({ userId, day, costMicroUsd: micro, requests: 1 })
    .onConflictDoUpdate({
      target: [askUsage.userId, askUsage.day],
      set: {
        costMicroUsd: sql`${askUsage.costMicroUsd} + ${micro}`,
        requests: sql`${askUsage.requests} + 1`,
      },
    })
    .run();
  return getAskUsage(db, userId, day);
}
