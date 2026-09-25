/**
 * The production SearchPort (UI/UX v1 plan 01 T05; docs/03 §3): the workspace's runs go through
 * `SearchEngine.searchQuery`, the same executor, quota and cache as the text search, watches and Ask.
 *
 * Runs are executed one after another here — never two seats.aero pulls at once from the workspace — while the
 * workspace itself decides which answer may be shown. A queued run that a newer run has already superseded (its
 * signal is aborted) is skipped before anything is sent: nothing can show its answer. A run already sent cannot be
 * recalled (docs/PHASE0.md §3). The key is read from the Keychain when a run starts and goes to the engine only; a
 * snapshot holds rows, query, times and coverage, never the key or a header.
 *
 * The engine's full answer (grid, notices, quota) is handed to `onAnswer` BEFORE the snapshot is returned — so
 * before the workspace can publish it — and is also kept for the run that asked, until that caller takes it: the
 * Search screen renders from it until the result cards read the snapshot directly (T07).
 */
import { snapshotFromFind } from "@awardgrid/core/workspace/snapshot-from-find";
import type { ResultSnapshot, SearchPort, SearchRun } from "@awardgrid/core/workspace/types";
import type { QueryObject } from "@awardgrid/core/query/schema";
import type { KeyStore } from "../native/keychain";
import type { ApiResult, FindValue, SearchEngine } from "../search/search";
import { SearchRunError } from "./workspace-store";

export interface EngineSearchPort extends SearchPort {
  /** The engine's answer to a run, once: the second call for the same run returns null. */
  takeResult(runId: string): ApiResult<FindValue> | null;
}

export interface SearchPortOptions {
  engine: Pick<SearchEngine, "searchQuery">;
  keys: Pick<KeyStore, "get">;
  now: () => Date;
  /** Called with each snapshot and the engine's answer, before the snapshot goes back to the workspace. */
  onAnswer?: (snapshot: ResultSnapshot, value: FindValue, run: SearchRun) => void;
  /**
   * T17: queue each search with the app's other spending entries (RequestCoordinator), so it starts after them and
   * reads the quota they left. The run's own check for being superseded happens when its turn comes.
   */
  coordinate?: <T>(operation: () => Promise<T>) => Promise<T>;
}

/** How many unclaimed answers are kept; older ones belong to runs nobody is waiting for any more. */
const KEPT_RESULTS = 4;

export function createSearchPort(opts: SearchPortOptions): EngineSearchPort {
  const results = new Map<string, ApiResult<FindValue>>();
  let tail: Promise<unknown> = Promise.resolve();

  const keep = (runId: string, result: ApiResult<FindValue>) => {
    results.delete(runId);
    results.set(runId, result);
    while (results.size > KEPT_RESULTS) results.delete(results.keys().next().value!);
  };

  const executeNow = async (query: QueryObject, run: SearchRun): Promise<ResultSnapshot> => {
    if (run.signal?.aborted) throw new SearchRunError("superseded", "A newer search started before this one was sent.");
    let key: string | null;
    try {
      key = await opts.keys.get();
    } catch {
      key = null;
    }
    const result = await opts.engine.searchQuery(query, key);
    keep(run.id, result);
    if (!result.ok) throw new SearchRunError(result.error, result.message);
    const snapshot = snapshotFromFind(result.value, run, opts.now().toISOString());
    try {
      opts.onAnswer?.(snapshot, result.value, run);
    } catch {
      // Bookkeeping must never turn an answer into a failure.
    }
    return snapshot;
  };

  return {
    execute(query, run) {
      const next = tail.then(() => (opts.coordinate ? opts.coordinate(() => executeNow(query, run)) : executeNow(query, run)));
      tail = next.catch(() => undefined);
      return next;
    },
    takeResult(runId) {
      const result = results.get(runId) ?? null;
      results.delete(runId);
      return result;
    },
  };
}

/** A ResultSnapshot from one engine answer: core's (T18), shared with the Web. */
export { snapshotFromFind };
