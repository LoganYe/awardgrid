/**
 * Read-only view of today's seats.aero quota for one user (Settings page quota bar,
 * kickoff §4.3 "Quota"). Reads the same `api_usage` row the SQLite quota store increments;
 * never writes. Day boundary = UTC calendar day (assumed reset at 00:00 UTC, ARCHITECTURE §2.7).
 *
 * `getUsageSummary` (Phase 6 §4.7) adds the ask-lane spend from `ask_usage` (via the check-only
 * `reserveAsk`) and the indicator state, in the wire shape GET /api/usage answers with.
 */
import { and, eq } from "drizzle-orm";
import { dailyCapUsd, reserveAsk } from "@/lib/ask/budget";
import type { DbConn } from "@/lib/auth/clock";
import { SEATS_AERO_PROVIDER } from "@/lib/db/stores/quota";
import { apiUsage } from "@/lib/db/schema";
import { nextUtcMidnight, SEATS_AERO_DAILY_LIMIT, softLimitFromEnv, utcDayKey } from "@awardgrid/core/seatsaero/quota";
import { stateFor, type QuotaState } from "@/components/shell/quota-indicator-state";

export interface TodayUsage {
  /** Calls recorded for the user today (UTC). */
  used: number;
  /** Soft limit awardgrid stops at (default 950; env SEATS_AERO_DAILY_SOFT_LIMIT). */
  limit: number;
  /** The provider's hard limit (1,000). */
  hardLimit: number;
  /** YYYY-MM-DD (UTC). */
  day: string;
  /** ISO timestamp of the next UTC midnight. */
  resetAt: string;
}

export interface TodayUsageOptions {
  now?: Date;
  provider?: string;
  env?: Record<string, string | undefined>;
}

export function getTodayUsage(db: DbConn, userId: string, opts: TodayUsageOptions = {}): TodayUsage {
  const now = opts.now ?? new Date();
  const day = utcDayKey(now);
  const provider = opts.provider ?? SEATS_AERO_PROVIDER;
  const row = db
    .select({ calls: apiUsage.calls })
    .from(apiUsage)
    .where(and(eq(apiUsage.userId, userId), eq(apiUsage.provider, provider), eq(apiUsage.day, day)))
    .get();
  return {
    used: row?.calls ?? 0,
    limit: softLimitFromEnv(opts.env),
    hardLimit: SEATS_AERO_DAILY_LIMIT,
    day,
    resetAt: nextUtcMidnight(now).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// GET /api/usage wire shape (Phase 6 §4.7 quota indicator)
// ---------------------------------------------------------------------------

/** Today's seats.aero call count against both limits, plus the indicator state. */
export interface SeatsAeroUsage {
  used: number;
  /** awardgrid stops here (default 950; env SEATS_AERO_DAILY_SOFT_LIMIT). `state` is "exceeded" from here. */
  soft_limit: number;
  /** The provider's hard limit (1,000). `state` is "warn" from 80 % of it (800). */
  limit: number;
  /** ISO timestamp of the next UTC midnight. */
  reset_at: string;
  state: QuotaState;
}

/** Today's ask-lane spend against the daily cap (check-only; nothing is charged by reading). */
export interface AskUsageSummary {
  spent_usd: number;
  cap_usd: number;
  remaining_usd: number;
  /** ISO timestamp of the next UTC midnight (the ask day is the UTC day too). */
  reset_at: string;
}

/** Body of GET /api/usage. Snake_case on purpose: it mirrors the seats.aero-facing wire style. */
export interface UsageSummary {
  seats_aero: SeatsAeroUsage;
  ask: AskUsageSummary;
  /** ISO timestamp the summary was computed at (server clock). */
  computed_at: string;
}

export interface UsageSummaryOptions {
  now?: Date;
  env?: Record<string, string | undefined>;
}

/**
 * Everything the top-bar indicator shows, from the two existing usage tables. Read-only.
 * `env` overrides both `SEATS_AERO_DAILY_SOFT_LIMIT` and `ASK_DAILY_COST_CAP_USD` for tests.
 */
export function getUsageSummary(db: DbConn, userId: string, opts: UsageSummaryOptions = {}): UsageSummary {
  const now = opts.now ?? new Date();
  const seats = getTodayUsage(db, userId, { now, env: opts.env });
  const ask = reserveAsk(db, userId, { now, capUsd: dailyCapUsd(opts.env) });
  const resetAt = nextUtcMidnight(now).toISOString();
  return {
    seats_aero: {
      used: seats.used,
      soft_limit: seats.limit,
      limit: seats.hardLimit,
      reset_at: resetAt,
      state: stateFor(seats.used, seats.limit, seats.hardLimit),
    },
    ask: {
      spent_usd: ask.spentUsd,
      cap_usd: ask.capUsd,
      remaining_usd: ask.remainingUsd,
      reset_at: resetAt,
    },
    computed_at: now.toISOString(),
  };
}
