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
import { rowKey, scopeKey } from "@awardgrid/core/workspace/identity";
import { rowTimeEvidence } from "@awardgrid/core/workspace/semantics";
import type { ResultSnapshot, SearchPort, SearchRun, WorkspaceRow } from "@awardgrid/core/workspace/types";
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
      const next = tail.then(() => executeNow(query, run));
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

/**
 * A ResultSnapshot from one engine answer. Row keys are derived from the query's scope; a row that repeats an
 * identity is the same row and is kept once. Coverage that is missing, describes another scope, or comes without its
 * rows is unknown.
 */
export function snapshotFromFind(value: FindValue, run: { id: string; revision: number }, createdAt: string): ResultSnapshot {
  const scope = scopeKey(value.query);
  const seen = new Set<string>();
  const rows: WorkspaceRow[] = [];
  for (const row of value.rows ?? []) {
    const key = rowKey(row, scope);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ key, value: row, time: rowTimeEvidence(row, createdAt) });
  }
  // An answer that did not carry its rows (built outside the engine) proves nothing about coverage.
  const coverage =
    value.rows !== undefined && value.coverage && value.coverage.scopeKey === scope ? value.coverage : { state: "unknown" as const, scopeKey: scope, slices: [] };
  return {
    schemaVersion: 1,
    id: `${run.id}@${createdAt}`,
    revision: run.revision,
    query: value.query,
    scopeKey: scope,
    createdAt,
    rows,
    coverage,
    receipt: { sentCalls: value.api_calls_used, fromCache: value.served_from_cache },
  };
}
