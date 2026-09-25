/**
 * The selection set and what a comparison is made of (UI/UX v1 T12; docs/03 §2; docs/04 S05; acceptance A22).
 *
 *   - **At most four.** A fifth is refused and said so ("limit"); nothing already chosen is swapped out for it.
 *     Choosing a chosen option again clears it.
 *   - **A reference names its own snapshot.** The same row in a newer search is another reference: a selection keeps
 *     the version it was made from, and is never quietly moved to the latest row (docs/03 §2).
 *   - **A comparison fetches nothing.** Each chosen option is read from the snapshot it came from, or, once that
 *     snapshot has left the device's history, from the copy kept when it was chosen, labelled as such; an option
 *     found in neither is said to be gone, never invented.
 *   - **No ranking across programs.** The fields are shown side by side in a fixed order; nothing here scores,
 *     totals or converts (spec §13 "跨计划只显示数值差异，不推导兑换价值排名").
 */
import { feesState } from "./semantics";
import type { ISOInstant, ResultRef, ResultSnapshot, WorkspaceRow } from "./types";
import type { QueryObject } from "../query/schema";

/** Options a comparison can hold (docs/04 S05). */
export const MAX_COMPARE = 4;

export const sameRef = (a: ResultRef, b: ResultRef): boolean => a.snapshotId === b.snapshotId && a.rowKey === b.rowKey;

/** A stable string for a reference, for maps and React keys. */
export const refKey = (ref: ResultRef): string => `${ref.snapshotId}\u0000${ref.rowKey}`;

/**
 * Choose or clear one option. A new array every time; the one given is left as it was. At the limit, a new option is
 * refused with `reason: "limit"` and the selection is returned unchanged.
 */
export function toggleSelection(current: readonly ResultRef[], ref: ResultRef, max: number = MAX_COMPARE): { selected: ResultRef[]; reason?: "limit" } {
  if (current.some((item) => sameRef(item, ref))) return { selected: current.filter((item) => !sameRef(item, ref)) };
  if (current.length >= Math.max(1, max)) return { selected: [...current], reason: "limit" };
  return { selected: [...current, ref] };
}

/** What is kept of a chosen option when it is chosen, so the comparison can still show it if its snapshot is evicted. */
export interface SelectionFragment {
  ref: ResultRef;
  row: WorkspaceRow;
  query: QueryObject;
  /** When the snapshot it came from was made. */
  snapshotCreatedAt: ISOInstant;
}

export interface CompareEntry {
  ref: ResultRef;
  /**
   * Where the option was read from: its snapshot, still on the device; the copy kept when it was chosen, its snapshot
   * gone; or nowhere (the option is gone and is shown as such).
   */
  source: "snapshot" | "kept_copy" | "missing";
  row: WorkspaceRow | null;
  query: QueryObject | null;
  snapshotCreatedAt: ISOInstant | null;
}

/** Read each chosen option, in the order chosen, from its own snapshot or the copy kept of it. Nothing is fetched. */
export function resolveSelection(
  refs: readonly ResultRef[],
  snapshots: readonly ResultSnapshot[],
  fragments: ReadonlyMap<string, SelectionFragment> = new Map(),
): CompareEntry[] {
  return refs.map((ref) => {
    const snapshot = snapshots.find((s) => s.id === ref.snapshotId);
    const row = snapshot?.rows.find((r) => r.key === ref.rowKey);
    if (snapshot && row) return { ref, source: "snapshot", row, query: snapshot.query, snapshotCreatedAt: snapshot.createdAt };
    const kept = fragments.get(refKey(ref));
    if (kept) return { ref, source: "kept_copy", row: kept.row, query: kept.query, snapshotCreatedAt: kept.snapshotCreatedAt };
    return { ref, source: "missing", row: null, query: null, snapshotCreatedAt: null };
  });
}

/** The fields a comparison shows, in this order and no other (docs/04 S05). */
export const COMPARE_FIELDS = ["route_date", "cabin", "program", "miles", "fees", "itineraries", "seats", "source_time", "link"] as const;
export type CompareField = (typeof COMPARE_FIELDS)[number];

/**
 * What the comparison must say about its own figures, read the way the columns read them (semantics `feesState`): the
 * currencies of the fees that are known (normalised codes; they are not converted), how many fees are not known at
 * all, how many have an amount but no currency (not comparable, and not the same as unknown), and the programs
 * (miles from different programs are not worth the same).
 */
export function compareNotes(entries: readonly CompareEntry[]): { currencies: string[]; unknownFees: number; currencyMissing: number; programs: string[] } {
  const rows = entries.flatMap((e) => (e.row ? [e.row.value] : []));
  const fees = rows.map((r) => feesState(r.fees_cents, r.currency));
  const currencies = [...new Set(fees.flatMap((f) => (f.kind === "known" ? [f.currency] : [])))].sort();
  const unknownFees = fees.filter((f) => f.kind === "unknown").length;
  const currencyMissing = fees.filter((f) => f.kind === "currency_missing").length;
  const programs = [...new Set(rows.map((r) => r.program))].sort();
  return { currencies, unknownFees, currencyMissing, programs };
}

/**
 * How the comparison is laid out for a content width and text scale (docs/04 S05): one column at 320 or 200% text;
 * two at a time on a phone, the others reached through a picker; up to four side by side when each can have 220,
 * scrolling sideways if they cannot all fit.
 */
export function compareLayout(contentWidth: number, textScale: number, count: number): { columns: number; picker: boolean; scroll: boolean } {
  const n = Math.max(0, Math.min(count, MAX_COMPARE));
  if (n <= 1 || contentWidth < 340 || textScale >= 2) return { columns: Math.min(n, 1), picker: false, scroll: false };
  const WIDE_MIN = 220;
  const GAP = 16;
  if (contentWidth < 2 * WIDE_MIN + GAP) return { columns: 2, picker: n > 2, scroll: false };
  return { columns: n, picker: false, scroll: n * WIDE_MIN + (n - 1) * GAP > contentWidth };
}
