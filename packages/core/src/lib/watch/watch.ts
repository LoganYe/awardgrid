/**
 * A watch, and the rules about when it may run.
 *
 * The web app calls this a standing query and runs it on a cron. A client app cannot: `docs/PIVOT.md`
 * §3 is blunt that "there is no iOS mechanism that replaces a cron", and renames the feature from a
 * *schedule* to a *watch* for that reason. So nothing here takes a cron expression, computes a next
 * run, or has any concept of "due at". A watch is checked when something checks it.
 *
 * What this module owns is the decisions that keep the feature from being useless, expensive, or
 * noisy — all pure, all testable without a device:
 *
 *   1. **May this watch spend a call?** A seats.aero Pro key allows 1,000 calls a day and the app
 *      stops at 950. A watch that refetched every time the app was opened would spend the user's
 *      quota on data it already has: the availability cache has a 45-minute TTL, so a check sooner
 *      than that returns the same rows from cache. `dueForCheck` says no until the TTL has passed.
 *   2. **What changed?** `diffWithinOverlap`, below, on top of `diffSnapshots` from ./diff.
 */
import { diffSnapshots, parseCellKey } from "./diff";
import type { CellSnapshot, DiffOptions, SnapshotDiff } from "./types";

/** The date range one check actually covered, as the parser resolved it that day. */
export interface DateWindow {
  date_from: string; // YYYY-MM-DD
  date_to: string; // inclusive
}

/** A saved query the user asked to be watched. Device-local; there is no server to sync it to. */
export interface Watch {
  id: string;
  /** What the user called it. */
  name: string;
  /**
   * The query TEXT, not a parsed QueryObject, so every check re-parses against that day's date.
   *
   * This is the fix for the web app's issue #47. `saved_queries.query_json` stores absolute dates,
   * so "next 30 days" freezes on the day it was saved and the standing query goes silent once
   * those dates pass — within 92 days at most. Re-parsing the text keeps a relative window
   * relative.
   */
  text: string;
  /** ISO of the last check that SUCCEEDED. This is what "last checked" means to the user. */
  lastCheckedAt: string | null;
  /**
   * ISO of the last check that was ATTEMPTED and may have spent calls, successful or not.
   *
   * Kept apart from `lastCheckedAt` for two reasons that pull in opposite directions. A check that
   * reached seats.aero and failed (a 500, a timeout) still cost a call, so it must start the TTL
   * clock — otherwise a persistently failing watch retries, and spends, on every single app open.
   * But it did not produce data, so it must not be reported as "last checked". One field cannot
   * say both.
   */
  lastAttemptAt?: string | null;
  /** The baseline the next check diffs against. Empty until the first successful check. */
  baseline: CellSnapshot[];
  /** The window `baseline` was taken over. Needed to tell "the date aged out" from "the seat went". */
  baselineWindow?: DateWindow | null;
  /** Minimum miles decrease that counts as a price drop, in percent of the baseline. */
  dropThresholdPct: number;
  /** The most recent check that COMPLETED, successful or not. Drives "last checked" and "last attempt failed". */
  lastResult?: { at: string; status: "checked" | "failed"; firstCheck: boolean; message?: string } | null;
  /**
   * Changes found by checks the user has not looked at yet, accumulated across checks.
   *
   * Accumulated rather than replaced, because every check moves the baseline forward. If the latest
   * result simply overwrote the previous one, a check that found three new seats followed an hour
   * later by a check that found nothing would erase the three seats before anyone saw them — the
   * watch would have noticed, and then quietly forgotten it had.
   */
  unseen?: { new: number; dropped: number; cheaper: number; since: string } | null;
  /** A paused watch is never checked and says so; it is not deleted. */
  enabled: boolean;
  createdAt: string;
}

/** Why a watch did not run. Every one of these is a sentence the UI has to be able to say. */
export type SkipReason = "disabled" | "no_key" | "quota_low" | "checked_recently";

export type WatchOutcome =
  | { status: "skipped"; reason: SkipReason }
  | { status: "failed"; message: string }
  | { status: "checked"; diff: SnapshotDiff; changed: boolean; snapshot: CellSnapshot[] };

export interface DueOptions {
  now: Date;
  /** Availability cache TTL. Checking sooner cannot return fresher data. */
  ttlMinutes: number;
  /** Calls the key has left today, from the quota counter. */
  quotaRemaining: number;
  /** A watch will not start unless at least this many calls are left. */
  minQuota?: number;
  hasKey: boolean;
}

/**
 * A watch reserves headroom rather than spending to the last call. Running a watch down to zero
 * would leave the user unable to run the search they actually opened the app to run — and a check
 * that consumed the day's last call without being asked is the version of this feature that would
 * deserve to be deleted.
 */
export const DEFAULT_MIN_QUOTA = 25;

/**
 * Whether this watch may check now. Returns null when it may, or the reason it may not.
 *
 * Deliberately NOT a function of a schedule: there is no "it is 3pm so this is due". The only
 * questions are whether checking again could tell the user anything new, and whether it can be
 * afforded.
 */
export function dueForCheck(watch: Watch, opts: DueOptions): SkipReason | null {
  if (!watch.enabled) return "disabled";
  if (!opts.hasKey) return "no_key";
  if (opts.quotaRemaining < (opts.minQuota ?? DEFAULT_MIN_QUOTA)) return "quota_low";

  // Gate on the last ATTEMPT when there is one, so a failed-but-costly check still waits out the TTL.
  const gate = watch.lastAttemptAt ?? watch.lastCheckedAt;
  if (gate) {
    const last = Date.parse(gate);
    // An unparseable timestamp is treated as "never checked" rather than as "checked at NaN",
    // which would compare false and let the watch run on every single open.
    if (Number.isFinite(last)) {
      const elapsedMinutes = (opts.now.getTime() - last) / 60_000;
      // A clock that moved backwards (timezone change, NTP correction) must not make a watch look
      // like it was checked in the future and freeze it until the clock catches up.
      if (elapsedMinutes >= 0 && elapsedMinutes < opts.ttlMinutes) return "checked_recently";
    }
  }
  return null;
}

/** True when a diff contains anything the user asked to hear about. */
export function isChanged(diff: SnapshotDiff): boolean {
  return diff.new.length > 0 || diff.dropped.length > 0 || diff.price_drops.length > 0;
}

function inWindow(cell: CellSnapshot, from: string, to: string): boolean {
  const date = parseCellKey(cell.key)?.date;
  // A key that does not parse cannot be placed in time; leave it out rather than guess.
  return date !== undefined && date >= from && date <= to;
}

/**
 * Compare two checks only over the dates BOTH of them covered.
 *
 * A watch re-parses its text every check, so "next 30 days" is a window that slides forward with
 * the calendar. Diffing the raw snapshots would then report every date that simply aged out of the
 * window as a dropped seat, and every date that newly entered it as a new one — on every check,
 * forever. That is a watch that cries wolf, and a watch nobody trusts is worse than no watch.
 *
 * Restricting both sides to the overlap means a reported change is a change in availability, not
 * a change in the calendar. When the windows do not overlap at all (the watch was paused for two
 * months) nothing can honestly be said about what changed across the gap, so the diff is empty
 * and the new snapshot simply becomes the baseline.
 *
 * `prevWindow` may be null for a baseline taken before windows were recorded; the current window
 * is then used for both sides, which still excludes dates that have aged out.
 */
export function diffWithinOverlap(
  prev: readonly CellSnapshot[],
  prevWindow: DateWindow | null | undefined,
  next: readonly CellSnapshot[],
  nextWindow: DateWindow,
  opts: DiffOptions,
): SnapshotDiff {
  const from = prevWindow && prevWindow.date_from > nextWindow.date_from ? prevWindow.date_from : nextWindow.date_from;
  const to = prevWindow && prevWindow.date_to < nextWindow.date_to ? prevWindow.date_to : nextWindow.date_to;
  if (from > to) return { new: [], dropped: [], price_drops: [], unchanged: 0 };
  return diffSnapshots(
    prev.filter((c) => inWindow(c, from, to)),
    next.filter((c) => inWindow(c, from, to)),
    opts,
  );
}

/**
 * How long ago the last check was, in whole units, or null when it has never run.
 *
 * Past tense only, and that is the point rather than a formatting preference. PIVOT §3: "Never
 * print a next-run time. Print 'last checked 2 h ago' … Promising a cadence the OS will not honour
 * is the one lie this product must not tell." There is deliberately no counterpart function that
 * projects forwards, because the moment one exists somebody will render it.
 */
export function sinceLastCheck(lastCheckedAt: string | null, now: Date): { value: number; unit: "minute" | "hour" | "day" } | null {
  if (!lastCheckedAt) return null;
  const then = Date.parse(lastCheckedAt);
  if (!Number.isFinite(then)) return null;
  const ms = now.getTime() - then;
  if (ms < 0) return { value: 0, unit: "minute" }; // clock skew: "just now", never a negative age
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return { value: minutes, unit: "minute" };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { value: hours, unit: "hour" };
  return { value: Math.floor(hours / 24), unit: "day" };
}
