/**
 * Small shared types for the auth/keys modules: an injectable clock so tests can freeze time,
 * and a connection type that accepts both the Db handle and a transaction inside it.
 * Callers may pass `now` as a Date or a `() => Date` (the seats.aero Quota convention).
 */
import type { RunResult } from "better-sqlite3";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type * as schema from "@/lib/db/schema";

export type NowInput = Date | (() => Date);

export interface ClockOptions {
  /** Defaults to the wall clock. */
  now?: NowInput;
}

export function resolveNow(opts?: ClockOptions): Date {
  const n = opts?.now;
  if (n === undefined) return new Date();
  return typeof n === "function" ? n() : n;
}

/** `Db` (openDb/openTestDb) or a transaction handle from `db.transaction((tx) => ...)`. */
export type DbConn = BaseSQLiteDatabase<"sync", RunResult, typeof schema>;
