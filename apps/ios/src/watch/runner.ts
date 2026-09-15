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
 */
import {
  DEFAULT_MIN_QUOTA,
  type SkipReason,
  type Watch,
  type WatchOutcome,
  diffWithinOverlap,
  dueForCheck,
  isChanged,
  snapshot,
} from "@awardgrid/core/watch";
import { DEFAULT_CACHE_TTL_MINUTES } from "@awardgrid/core/seatsaero/cache";
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
  engine: Pick<SearchEngine, "search" | "quotaView">;
  store: WatchStore;
  apiKey: string | null;
  now: () => Date;
  ttlMinutes?: number;
  minQuota?: number;
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

  // Iterate over a copy: the store is updated as each watch finishes.
  for (const watch of [...opts.store.all()]) {
    const now = opts.now();
    const firstCheck = watch.lastCheckedAt === null;
    const quota = await opts.engine.quotaView();

    const skip: SkipReason | null = dueForCheck(watch, {
      now,
      ttlMinutes,
      quotaRemaining: quota.remaining,
      hasKey: Boolean(opts.apiKey),
      minQuota: opts.minQuota ?? DEFAULT_MIN_QUOTA,
    });
    if (skip) {
      results.push(result(watch, { status: "skipped", reason: skip }, firstCheck));
      continue;
    }

    const res = await opts.engine.search(watch.text, opts.apiKey);
    const iso = now.toISOString();

    if (!res.ok) {
      const message = res.message ?? res.error;
      // Do NOT touch the baseline or the unseen changes: a failed check says nothing about
      // availability, and must not wipe news an earlier check found.
      opts.store.update(watch.id, {
        ...(COSTLY_FAILURES.has(res.error) ? { lastAttemptAt: iso } : {}),
        lastResult: { at: iso, status: "failed", firstCheck, message },
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

    const prev = watch.unseen ?? null;
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
      lastResult: { at: iso, status: "checked", firstCheck },
      unseen,
    });
    results.push(result(watch, { status: "checked", diff, changed, snapshot: cells }, firstCheck));
  }
  return results;
}

function result(watch: Watch, outcome: WatchOutcome, firstCheck: boolean): WatchCheckResult {
  return { watchId: watch.id, name: watch.name, outcome, firstCheck };
}
