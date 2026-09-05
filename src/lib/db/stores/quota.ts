/**
 * SQLite-backed QuotaStore over the `api_usage` table (kickoff §3, §4.3 "Quota").
 *
 * Contract (see src/lib/seatsaero/quota.ts): `increment` must be atomic — one SQL statement
 * does the read-modify-write (`INSERT … ON CONFLICT DO UPDATE SET calls = calls + excluded.calls
 * RETURNING calls`), so two overlapping runs for the same user (a standing-query tick plus an
 * interactive search) cannot both observe the same headroom. `n` may be negative (refunds).
 *
 * Every statement is scoped by user_id AND provider: one user's counter is invisible to
 * another user's (§0.2 #2), and a future Duffel/ignav counter never mixes with seats.aero.
 */
import { and, eq, lt, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { apiUsage } from "@/lib/db/schema";
import type { QuotaStore } from "@/lib/seatsaero/quota";

/** Provider label stored in `api_usage.provider` for seats.aero Pro keys. */
export const SEATS_AERO_PROVIDER = "seats_aero";

export interface SqliteQuotaStoreOptions {
  /** Defaults to "seats_aero". */
  provider?: string;
}

export interface SqliteQuotaStore extends QuotaStore {
  readonly provider: string;
  /**
   * Delete usage rows for days strictly before `beforeDay` (YYYY-MM-DD), optionally for one
   * user. Returns the number of rows removed. Housekeeping for the worker; never called by
   * the quota logic itself.
   */
  prune(userId: string | null | undefined, beforeDay: string): Promise<number>;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertDay(day: string): void {
  if (!DAY_RE.test(day)) throw new RangeError(`quota day must be YYYY-MM-DD, got ${JSON.stringify(day)}`);
}

function assertUserId(userId: string): void {
  if (typeof userId !== "string" || userId === "") throw new RangeError("quota store requires a non-empty userId");
}

export function createSqliteQuotaStore(db: Db, opts: SqliteQuotaStoreOptions = {}): SqliteQuotaStore {
  const provider = opts.provider ?? SEATS_AERO_PROVIDER;
  const t = apiUsage;

  return {
    provider,

    async get(userId, day) {
      assertUserId(userId);
      assertDay(day);
      const row = db
        .select({ calls: t.calls })
        .from(t)
        .where(and(eq(t.userId, userId), eq(t.provider, provider), eq(t.day, day)))
        .get();
      return row?.calls ?? 0;
    },

    async increment(userId, day, n) {
      assertUserId(userId);
      assertDay(day);
      if (!Number.isInteger(n)) throw new RangeError("quota increment must be an integer");
      const row = db
        .insert(t)
        .values({ userId, provider, day, calls: n })
        .onConflictDoUpdate({
          target: [t.userId, t.provider, t.day],
          set: { calls: sql`${t.calls} + excluded.calls` },
        })
        .returning({ calls: t.calls })
        .get();
      // RETURNING always yields the affected row for a single-row upsert.
      return row?.calls ?? n;
    },

    async prune(userId, beforeDay) {
      assertDay(beforeDay);
      const conds = [eq(t.provider, provider), lt(t.day, beforeDay)];
      if (userId) conds.push(eq(t.userId, userId));
      const res = db.delete(t).where(and(...conds)).run();
      return res.changes;
    },
  };
}
