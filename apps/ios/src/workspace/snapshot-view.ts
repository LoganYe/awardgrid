/**
 * The Search screen's view of a saved snapshot (UI/UX v1 T05): what a relaunch shows before anything is fetched.
 *
 * Built only from the snapshot: its rows, its query, and its coverage. An empty cell may read "no availability" only
 * where a complete slice proves the pair was checked to the end; a pair the provider does not monitor says so; every
 * other pair without rows — a partial slice, a slice with no evidence, or no slice at all (coverage that
 * restoreCoverage could not prove) — reads "not checked". What a snapshot does not record is not invented: the
 * calls the original search cost are unknown here (null), and there are no run warnings to repeat.
 */
import { buildGrid, enumeratePairs } from "@awardgrid/core/grid/pivot";
import type { NotFetchedPair } from "@awardgrid/core/grid/types";
import { NOT_FETCHED_REASON } from "@awardgrid/core/seatsaero/not-fetched";
import type { CoverageSlice, ResultSnapshot } from "@awardgrid/core/workspace/types";
import type { SearchView } from "../search/last-search";

const REASON: Record<CoverageSlice["reason"], string> = {
  exhausted: NOT_FETCHED_REASON.truncated,
  page_cap: NOT_FETCHED_REASON.truncated,
  quota: NOT_FETCHED_REASON.quota,
  upstream_error: NOT_FETCHED_REASON.upstream,
  not_monitored: NOT_FETCHED_REASON.truncated,
  missing_evidence: NOT_FETCHED_REASON.truncated,
};

export function searchViewFromSnapshot(snapshot: ResultSnapshot): SearchView {
  const rows = snapshot.rows.map((r) => r.value);
  const withRows = new Set(rows.map((r) => `${r.origin}-${r.dest}`));
  const slicesFor = (origin: string, dest: string) => snapshot.coverage.slices.filter((s) => s.origin === origin && s.destination === dest);
  const unmonitored: Array<{ origin: string; dest: string }> = [];
  const notFetched: NotFetchedPair[] = [];
  for (const pair of enumeratePairs(snapshot.query)) {
    if (withRows.has(pair.key)) continue;
    const slices = slicesFor(pair.origin, pair.dest);
    if (slices.some((s) => s.state === "unmonitored")) unmonitored.push({ origin: pair.origin, dest: pair.dest });
    else if (slices.length > 0 && slices.every((s) => s.state === "complete")) continue;
    else {
      const weak = slices.find((s) => s.state !== "complete");
      notFetched.push({ pair: { origin: pair.origin, dest: pair.dest }, reason: weak ? REASON[weak.reason] : NOT_FETCHED_REASON.truncated });
    }
  }
  const fetched = rows.map((r) => r.fetched_at).filter((t): t is string => typeof t === "string" && t !== "").sort();
  return {
    grid: buildGrid(rows, snapshot.query, { now: snapshot.createdAt, unmonitored_pairs: unmonitored, not_fetched_pairs: notFetched }),
    query: snapshot.query,
    warnings: [],
    served_from_cache: snapshot.receipt.fromCache,
    api_calls_used: null,
    fetched_at_min: fetched[0] ?? null,
    rows,
    coverage: snapshot.coverage,
  };
}
