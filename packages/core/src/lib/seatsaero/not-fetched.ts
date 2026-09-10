/**
 * Which pairs a run may not have fetched at all, so their empty cells can say "not checked" instead
 * of "no availability".
 *
 * Ported from the web facade (src/lib/server/find.ts:210-246) with its behaviour unchanged. It lived
 * there because only the server built grids; the iOS shell (apps/ios/src/search/search.ts) now builds
 * them from the same `FindResult`, and a grid that reads a truncated pull differently on each shell
 * would be two answers about one set of data. The web file is not edited in this phase, so it keeps
 * its own copy for now. not-fetched.test.ts restates the web's cases (src/lib/server/find.test.ts:799-812)
 * so both copies answer to the same rule until the facade imports this one.
 */
import type { NotFetchedPair, RoutePair } from "../grid/types";
import type { FindResult } from "./find";

/**
 * i18n keys the grid shows for a cell whose fetch did not complete (never English text), defined in
 * i18n/dictionaries/en.ts:151-153. `upstream` is the partial run: one program's Get Routes failed
 * (the web's ResilientRoutesCatalog, src/lib/server/find.ts:122-150), so a pair with no rows that no
 * LOADED program monitors may belong to the failed program. The grid cannot say "not monitored" or
 * "no availability" for it (the web's `upstreamNotFetchedPairs`, src/lib/server/find.ts:292-305).
 */
export const NOT_FETCHED_REASON = {
  quota: "grid.cell.not_fetched_quota",
  truncated: "grid.cell.not_fetched",
  upstream: "grid.cell.not_fetched_error",
} as const;

/**
 * Map runFind's run-level warnings onto pairs. Truncation and quota headroom stop a run before
 * every pair/date was pulled (executePlan, find.ts:409-424), but the warnings do not say which: the
 * only honest claim is that a pair with NO rows in such a run may not have been fetched at all.
 * Pairs seats.aero does not monitor keep their own state; pairs with rows are "ok" (their empty
 * dates stay "none").
 *
 * `find.routes_skipped` is deliberately not one of these warnings. It means the Get Routes check ran
 * out of budget AFTER the pull, so the rows are complete and only the "not monitored" claim is
 * missing; the web marks those pairs from the routes catalog instead (src/lib/server/find.ts:393-402).
 */
export function notFetchedPairsFrom(result: Pick<FindResult, "rows" | "notices" | "unmonitored_pairs">, pairs: readonly RoutePair[]): NotFetchedPair[] {
  let reason: string | null = null;
  for (const n of result.notices) {
    if (n.code === "find.quota_headroom") {
      reason = NOT_FETCHED_REASON.quota;
      break;
    }
    if (n.code === "find.truncated_search" || n.code === "find.truncated_bulk") reason = NOT_FETCHED_REASON.truncated;
  }
  if (reason === null) return [];
  const withRows = new Set(result.rows.map((r) => `${r.origin}-${r.dest}`));
  const unmonitored = new Set(result.unmonitored_pairs.map((p) => p.key));
  const out: NotFetchedPair[] = [];
  for (const p of pairs) {
    if (withRows.has(p.key) || unmonitored.has(p.key)) continue;
    out.push({ pair: { origin: p.origin, dest: p.dest }, reason });
  }
  return out;
}
