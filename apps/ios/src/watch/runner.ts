/**
 * Checking watches.
 *
 * There is no scheduler here, and that is not an omission. `docs/PIVOT.md` §3: "There is no iOS
 * mechanism that replaces a cron." This function checks every watch that may be checked, once, when
 * it is called — and it is called when the app is opened or returns to the foreground, and at no
 * other time (see ./capabilities.ts for why there is no background check).
 *
 * The rules this runner holds, each of which would otherwise be easy to break:
 *
 *   - **Sequential, with quota re-read between watches.** Every check spends seats.aero calls. Read
 *     quota once up front and ten watches would all see the same headroom and collectively overrun
 *     it. Checking one at a time means a later watch sees what the earlier ones spent and can stop.
 *   - **The first check sets a baseline and reports nothing.** Diffed against an empty baseline,
 *     every seat on the route looks "new". The web app's scheduler skips notifying on its first run
 *     for the same reason (`saved.skip.first_run`).
 *   - **The same snapshot basis as the web app.** `src/lib/scheduler/run.ts` snapshots
 *     `grid.cells.flat().flatMap(c => c.all)`, never the cached dynamic-priced rows. So does this,
 *     so a watch here and a standing query there mean the same thing by "changed".
 *   - **Changes accumulate until seen.** Each check moves the baseline forward, so a quiet check
 *     must not erase an earlier check's news. See `Watch.unseen`.
 *   - **A structured watch runs its structured query** (T14): the draft resolved against today, through the
 *     engine's `searchQuery`, never its old text read again over edited fields. A watch under review, or one from
 *     before T14 not migrated yet, reads its text as it always did. Fixed dates that have all passed are not
 *     checked: that could only spend a call on dates nobody can book.
 *   - **What changed is kept, with the old and new values** (T14), over the dates both checks covered; a check that
 *     could not compare (no overlap) says so rather than "no change".
 *   - **An edit made while a check is out wins** (T14 review). Each watch is read when its turn comes, and again when
 *     its request returns: a watch edited, restarted or removed meanwhile gets nothing from a check of its old
 *     conditions (its next check sets the baseline the edit asked for), and changes marked seen meanwhile stay seen.
 *   - **Conditions that cannot be run are not replaced by the old text.** A structured watch whose draft no longer
 *     resolves (a damaged file) is not checked, costs nothing, and says its conditions need editing.
 *   - **The OAuth flavour** (release plan step 18b): a token seats.aero refuses is renewed once per run and that
 *     watch checked once more (`renewKey`); and a baseline older than `baselineMaxAgeMs` (24 hours: seats.aero's
 *     results are kept on the device for no longer, ../retention/short-term.ts) is not compared against: the check
 *     sets a new one, as a first check does, and reports nothing. The key flavour passes neither, and runs as before.
 */
import {
  DEFAULT_MIN_QUOTA,
  MAX_UNSEEN_CHANGES,
  type SkipReason,
  type Watch,
  type WatchOutcome,
  changesFrom,
  diffWithinOverlap,
  dueForCheck,
  isChanged,
  overlapWindow,
  snapshot,
} from "@awardgrid/core/watch";
import { resolveDraft } from "@awardgrid/core/workspace/query-editor";
import type { QueryObject } from "@awardgrid/core/query/schema";
import { DEFAULT_CACHE_TTL_MINUTES } from "@awardgrid/core/seatsaero/cache";
import { refusedByProvider } from "../oauth/refresh-retry";
import { localDate } from "../app/local-date";
import type { ApiFailureCode, SearchEngine } from "../search/search";
import type { WatchStore } from "../store/watch-store";

export interface WatchCheckResult {
  watchId: string;
  name: string;
  outcome: WatchOutcome;
  /** True when this check only established the baseline. Nothing is reported as changed. */
  firstCheck: boolean;
}

export interface CheckWatchesOptions {
  engine: Pick<SearchEngine, "search" | "searchQuery" | "quotaView">;
  store: WatchStore;
  apiKey: string | null;
  now: () => Date;
  ttlMinutes?: number;
  minQuota?: number;
  /** The OAuth flavour: a renewed token after seats.aero refused `rejected`, or null (../oauth/refresh-retry.ts). */
  renewKey?: (rejected: string | null) => Promise<string | null>;
  /** The OAuth flavour: a baseline taken longer ago than this (ms) has been purged, and is not compared against. */
  baselineMaxAgeMs?: number | null;
}

/** Whether a watch's baseline is older than the short-term limit (its time is the last successful check's). */
export function baselineExpired(watch: Pick<Watch, "lastCheckedAt">, now: Date, maxAgeMs: number | null | undefined): boolean {
  if (maxAgeMs == null || watch.lastCheckedAt === null) return false;
  const at = Date.parse(watch.lastCheckedAt);
  return !Number.isFinite(at) || now.getTime() - at > maxAgeMs;
}

/**
 * Failures that happened after the request may have reached seats.aero, and so may have spent a
 * call. These start the attempt clock. The rest — no key, quota refused at reservation, a query
 * that did not parse — are refused before any request goes out and cost nothing, so retrying them
 * on the next open is free and they must not hold a watch back.
 */
const COSTLY_FAILURES: ReadonlySet<ApiFailureCode> = new Set(["network", "seatsaero", "internal"]);

export async function checkWatches(opts: CheckWatchesOptions): Promise<WatchCheckResult[]> {
  const ttlMinutes = opts.ttlMinutes ?? DEFAULT_CACHE_TTL_MINUTES;
  const results: WatchCheckResult[] = [];
  let apiKey = opts.apiKey;
  // A refused token is renewed once per run, not once per watch: a second refusal is the answer.
  let renewed = false;

  // Ids, not records: each watch is read when its turn comes, so an edit made during an earlier watch's check is run.
  for (const id of opts.store.all().map((w) => w.id)) {
    const watch = opts.store.get(id);
    if (!watch) continue;
    const now = opts.now();
    const firstCheck = watch.lastCheckedAt === null || baselineExpired(watch, now, opts.baselineMaxAgeMs);
    const quota = await opts.engine.quotaView();

    const skip: SkipReason | null = dueForCheck(watch, {
      now,
      ttlMinutes,
      quotaRemaining: quota.remaining,
      hasKey: Boolean(apiKey),
      minQuota: opts.minQuota ?? DEFAULT_MIN_QUOTA,
    });
    if (skip) {
      results.push(result(watch, { status: "skipped", reason: skip }, firstCheck));
      continue;
    }

    // A structured watch runs its own query for today (T14); one under review, or not migrated, reads its text.
    let structured: QueryObject | null = null;
    if (watch.draft && !watch.review) {
      try {
        structured = resolveDraft(watch.draft, localDate(now));
      } catch {
        // Never the old text instead: that is a different search from the one on its card. Nothing was sent.
        opts.store.update(watch.id, { lastResult: { at: now.toISOString(), status: "failed", firstCheck, unresolved: true } });
        results.push(result(watch, { status: "failed", message: "The watch's conditions could not be resolved." }, firstCheck));
        continue;
      }
      if (structured.date_to < localDate(now)) {
        results.push(result(watch, { status: "skipped", reason: "dates_passed" }, firstCheck));
        continue;
      }
    }

    const send = (key: string | null) => (structured ? opts.engine.searchQuery(structured, key) : opts.engine.search(watch.text, key));
    let res = await send(apiKey);
    if (refusedByProvider(res) && opts.renewKey && !renewed) {
      renewed = true;
      const fresh = await opts.renewKey(apiKey);
      if (fresh && fresh !== apiKey) {
        apiKey = fresh;
        res = await send(apiKey);
      }
    }
    const iso = now.toISOString();
    // Read again: the request may have been out while the watch was edited, restarted from the editor, or removed.
    const current = opts.store.get(watch.id);
    if (!current || editedSince(watch, current)) continue;

    if (!res.ok) {
      const message = res.message ?? res.error;
      // Do NOT touch the baseline or the unseen changes: a failed check says nothing about
      // availability, and must not wipe news an earlier check found.
      // A refused key (401/403) is its own reason, so the screen can say the key, not the watch, is the problem.
      const refused = res.error === "no_key" && (res.status === 401 || res.status === 403);
      opts.store.update(watch.id, {
        ...(COSTLY_FAILURES.has(res.error) || refused ? { lastAttemptAt: iso } : {}),
        lastResult: { at: iso, status: "failed", firstCheck, message, refused },
      });
      results.push(result(watch, { status: "failed", message }, firstCheck));
      continue;
    }

    const cells = snapshot(res.value.grid.cells.flat().flatMap((c) => c.all));
    const window = { date_from: res.value.query.date_from, date_to: res.value.query.date_to };
    const diff = diffWithinOverlap(watch.baseline, watch.baselineWindow, cells, window, {
      dropThresholdPct: watch.dropThresholdPct,
    });
    const changed = !firstCheck && isChanged(diff);
    // The dates this check compared against the baseline; null when it could not compare (first check, no overlap).
    const compared = firstCheck ? null : overlapWindow(watch.baselineWindow, window);
    // What is still unseen now, not when the check started: changes marked seen meanwhile stay seen.
    const unseenChanges = changed ? [...changesFrom(diff, iso), ...(current.unseenChanges ?? [])].slice(0, MAX_UNSEEN_CHANGES) : (current.unseenChanges ?? null);

    const prev = current.unseen ?? null;
    const unseen = changed
      ? {
          new: (prev?.new ?? 0) + diff.new.length,
          dropped: (prev?.dropped ?? 0) + diff.dropped.length,
          cheaper: (prev?.cheaper ?? 0) + diff.price_drops.length,
          since: prev?.since ?? iso,
        }
      : prev; // a quiet check keeps whatever the user has not seen yet

    opts.store.update(watch.id, {
      baseline: cells,
      baselineWindow: window,
      lastCheckedAt: iso,
      lastAttemptAt: iso,
      lastResult: { at: iso, status: "checked", firstCheck, compared },
      unseen,
      unseenChanges,
    });
    results.push(result(watch, { status: "checked", diff, changed, snapshot: cells }, firstCheck));
  }
  return results;
}

/** Whether what a check of `before` compared against, or what it ran, has changed since. */
function editedSince(before: Watch, after: Watch): boolean {
  return (
    after.draft !== before.draft ||
    after.text !== before.text ||
    after.review !== before.review ||
    after.lastCheckedAt !== before.lastCheckedAt ||
    after.baselineWindow !== before.baselineWindow ||
    after.baseline !== before.baseline
  );
}

function result(watch: Watch, outcome: WatchOutcome, firstCheck: boolean): WatchCheckResult {
  return { watchId: watch.id, name: watch.name, outcome, firstCheck };
}
