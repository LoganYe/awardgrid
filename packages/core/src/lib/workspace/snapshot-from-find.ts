/**
 * A ResultSnapshot from one find answer (UI/UX v1 T05; moved to core in T18 so the Web and iOS build the same
 * snapshot from the same kind of answer). Row keys are derived from the query's scope; a row that repeats an identity
 * is the same row and is kept once. Coverage that is missing, describes another scope, or comes without its rows is
 * unknown; a count of calls that is not known stays null, never 0.
 */
import type { AvailabilityRow } from "../grid/types";
import type { QueryObject } from "../query/schema";
import { rowKey, scopeKey } from "./identity";
import { rowTimeEvidence } from "./semantics";
import type { CoverageEvidence, ResultSnapshot, WorkspaceRow } from "./types";

export interface FindAnswer {
  query: QueryObject;
  /** The rows the answer was built from; absent when the answer did not carry them. */
  rows?: AvailabilityRow[];
  coverage?: CoverageEvidence | null;
  /** Calls the transport recorded as sent; null or absent when not known. */
  api_calls_used?: number | null;
  served_from_cache: boolean;
}

export function snapshotFromFind(value: FindAnswer, run: { id: string; revision: number }, createdAt: string): ResultSnapshot {
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
    receipt: { sentCalls: typeof value.api_calls_used === "number" ? value.api_calls_used : null, fromCache: value.served_from_cache },
  };
}
