/**
 * What goes to Claude beside a question (UI/UX v1 T15; docs/04 S09; docs/02 D08; acceptance A26).
 *
 * One function decides it, and the screen's context line is built from its result, the same result a question
 * sends: so the line can never say "2 results attached" while only the search goes out. Everything comes from the
 * trusted snapshot on screen (the workspace's displayed snapshot, the one every view projects):
 *
 *   - the search's conditions, always, when the person includes their search;
 *   - the results they selected, only when they choose to attach them, each found in that snapshot by its key. A
 *     reference to another snapshot, or to a row this one does not have, is refused, never replaced by a guess, and
 *     nothing is sent;
 *   - each attached result as awardgrid read it, never a model's numbers: what seats.aero reported, with unknown taxes,
 *     seats and age as null.
 *
 * Attached results are named R1, R2… in the order sent, so an answer can refer to them and the entry can show which
 * card each one is (a link back into that snapshot, which the details page resolves from the workspace again).
 */
import type { EntryContext, EntryProposal } from "@awardgrid/core/ask/conversation";
import { QueryObject } from "@awardgrid/core/query/schema";
import type { AttachedRow, LastSearch } from "@awardgrid/core/ask/prompt";
import type { AIContext, ResultRef, ResultSnapshot, WorkspaceRow } from "@awardgrid/core/workspace/types";

/** As many results as the comparison holds (T12): the selection they come from. */
export const MAX_ATTACHED_ROWS = 4;

export type ContextRefusal = "context_snapshot_mismatch" | "unknown_result_reference" | "too_many_rows";

export class ContextError extends Error {
  constructor(readonly code: ContextRefusal) {
    super(code);
    this.name = "ContextError";
  }
}

/**
 * The context for a question about `snapshot`: its query, and the selected rows when `sendRows`. `sent` says what the
 * rows really are: asking to attach with nothing selected sends the query only, and says so.
 */
export function buildAIContext(snapshot: ResultSnapshot, selectedRefs: readonly ResultRef[], sendRows: boolean): { context: AIContext; rows: WorkspaceRow[] } {
  const rows: WorkspaceRow[] = [];
  if (sendRows) {
    if (selectedRefs.length > MAX_ATTACHED_ROWS) throw new ContextError("too_many_rows");
    for (const ref of selectedRefs) {
      if (ref.snapshotId !== snapshot.id) throw new ContextError("context_snapshot_mismatch");
      const row = snapshot.rows.find((item) => item.key === ref.rowKey);
      if (!row) throw new ContextError("unknown_result_reference");
      if (!rows.includes(row)) rows.push(row);
    }
  }
  const sent = rows.length > 0 ? ("query_and_selected_rows" as const) : ("query_only" as const);
  return {
    context: {
      revision: snapshot.revision,
      snapshotId: snapshot.id,
      sent,
      query: snapshot.query,
      selectedRefs: rows.map((row) => ({ snapshotId: snapshot.id, rowKey: row.key })),
    },
    rows,
  };
}

/** The search as core's prompt describes it (ask/prompt.ts LastSearch), from the snapshot's own query. */
export function lastSearchOf(query: ResultSnapshot["query"]): LastSearch {
  return {
    origins: query.origins,
    destinations: query.destinations,
    date_from: query.date_from,
    date_to: query.date_to,
    cabins: query.cabins,
    programs: query.programs ?? null,
    direct_only: query.direct_only,
    max_miles: query.max_miles ?? null,
    min_cabin_pct: query.min_cabin_pct,
    include_filtered: query.include_filtered,
  };
}

/** The attached rows as sent: R1, R2…, each as seats.aero reported it, unknowns as null. */
export function attachedRows(rows: readonly WorkspaceRow[], now: Date): AttachedRow[] {
  return rows.map((row, i) => {
    const v = row.value;
    return {
      ref: `R${i + 1}`,
      date: v.date,
      origin: v.origin,
      destination: v.dest,
      program: v.program,
      cabin: v.cabin,
      miles: v.miles,
      taxes: v.fees_cents === null ? null : { cents: v.fees_cents, currency: v.currency },
      // 0 is "not provided by the program" (grid/types.ts): unknown, never "no seats".
      seats: v.seats_left > 0 ? v.seats_left : null,
      direct: v.direct,
      airlines: [...v.airlines],
      age_minutes: providerAgeMinutes(row, now),
    };
  });
}

/** Minutes since seats.aero's own time for the row; null when only this device's fetch time is known, or it is ahead. */
function providerAgeMinutes(row: WorkspaceRow, now: Date): number | null {
  const { basis, providerAt } = row.time;
  if ((basis !== "provider_last_seen" && basis !== "provider_updated") || !providerAt) return null;
  const ms = now.getTime() - Date.parse(providerAt);
  return Number.isFinite(ms) && ms >= 0 ? Math.floor(ms / 60_000) : null;
}

/** What an entry records of what went with it, from the context actually built (or none). */
export function entryContext(context: AIContext | null, earlier: number): EntryContext {
  if (context === null) return { sent: "none", snapshotId: null, revision: null, refs: [], earlier };
  return { sent: context.sent, snapshotId: context.snapshotId, revision: context.revision, refs: context.selectedRefs.map((ref) => ({ ...ref })), earlier };
}

/** An entry's proposals this version can read (T16); anything else in ask.json is left out, never applied. */
export function readEntryProposals(value: unknown): EntryProposal[] {
  if (!Array.isArray(value)) return [];
  const statuses = new Set(["pending", "applied", "dismissed", "stale"]);
  return value.flatMap((item): EntryProposal[] => {
    if (!item || typeof item !== "object") return [];
    const p = item as Partial<EntryProposal>;
    const proposed = QueryObject.safeParse(p.proposed);
    const base = p.base === null ? null : QueryObject.safeParse(p.base);
    if (typeof p.id !== "string" || typeof p.reason !== "string" || typeof p.baseRevision !== "number" || !statuses.has(String(p.status)) || !proposed.success) return [];
    if (base !== null && !base.success) return [];
    return [{ id: p.id, reason: p.reason, baseRevision: p.baseRevision, status: p.status!, proposed: proposed.data, base: base === null ? null : base.data }];
  });
}

/** An entry's record, if it is one this version can read (ask.json may come from elsewhere); otherwise null. */
export function readEntryContext(value: unknown): EntryContext | null {
  if (!value || typeof value !== "object") return null;
  const c = value as Partial<EntryContext>;
  const sentOk = c.sent === "none" || c.sent === "query_only" || c.sent === "query_and_selected_rows";
  const refsOk = Array.isArray(c.refs) && c.refs.every((ref) => ref && typeof ref.snapshotId === "string" && typeof ref.rowKey === "string");
  if (!sentOk || !refsOk || typeof c.earlier !== "number") return null;
  return { sent: c.sent!, snapshotId: typeof c.snapshotId === "string" ? c.snapshotId : null, revision: typeof c.revision === "number" ? c.revision : null, refs: c.refs!, earlier: c.earlier };
}
