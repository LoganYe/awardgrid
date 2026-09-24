/**
 * What a platform's watches can really do, said in the approved words (UI/UX v1 T20; docs/02 D05; docs/05; A33).
 *
 * The sentence follows the platform's capabilities, never the viewport: a phone-sized Web window still has the Web's
 * scheduler, and a large iPad still has only foreground checks. A configured scheduler is configuration, not proof that
 * a check ran: how the last run went is said separately (`runHealth`), and "unknown" when nothing says.
 */
import type { WatchCapabilities } from "./types";

export type { WatchCapabilities } from "./types";

export type CapabilityMessageKey = "watch.foreground_only" | "watch.scheduled_with_push" | "watch.scheduled_only" | "watch.unavailable";

export function capabilityMessageKey(cap: WatchCapabilities): CapabilityMessageKey {
  if (cap.scheduledChecks) return cap.pushEnabled ? "watch.scheduled_with_push" : "watch.scheduled_only";
  // Scheduler configured is not proof of a recent successful worker run; health is reported separately.
  return cap.checkOnForeground ? "watch.foreground_only" : "watch.unavailable";
}

/** The last scheduled run as the server recorded it, if it recorded one. */
export interface LastRun {
  /** When it finished (ISO instant), or null when no run has been recorded. */
  finishedAt: string | null;
  ok: boolean | null;
}

export type RunHealth = "unknown" | "never" | "ok" | "failed" | "stale";

/** How far ahead of the reader's clock a recorded run may be and still count (two processes' clocks differ a little). */
const FUTURE_SKEW_MS = 2 * 60 * 1000;

/**
 * How the scheduled checks are going: "unknown" when nothing is recorded to tell, "never" when none has run, "failed"
 * when the last one failed, "stale" when the last success is older than `staleAfterMs` (a scheduler that stopped),
 * "ok" otherwise. Only ever from recorded runs; configuration alone is never "ok".
 */
export function runHealth(last: LastRun | null, now: string, staleAfterMs: number): RunHealth {
  if (last === null) return "unknown";
  if (last.finishedAt === null) return "never";
  if (last.ok === false) return "failed";
  if (last.ok === null) return "unknown";
  const age = Date.parse(now) - Date.parse(last.finishedAt);
  if (!Number.isFinite(age)) return "unknown";
  // A run recorded in the future (a clock set wrong on either side) proves nothing about now (T20 review CAP-1).
  if (age < -FUTURE_SKEW_MS) return "unknown";
  return age > staleAfterMs ? "stale" : "ok";
}
