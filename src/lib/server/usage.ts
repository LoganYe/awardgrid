/**
 * Read-only view of today's seats.aero quota for one user (Settings page quota bar,
 * kickoff §4.3 "Quota"). Reads the same `api_usage` row the SQLite quota store increments;
 * never writes. Day boundary = UTC calendar day (assumed reset at 00:00 UTC, ARCHITECTURE §2.7).
 */
import { and, eq } from "drizzle-orm";
import type { DbConn } from "@/lib/auth/clock";
import { SEATS_AERO_PROVIDER } from "@/lib/db/stores/quota";
import { apiUsage } from "@/lib/db/schema";
import { nextUtcMidnight, SEATS_AERO_DAILY_LIMIT, softLimitFromEnv, utcDayKey } from "@/lib/seatsaero/quota";

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
