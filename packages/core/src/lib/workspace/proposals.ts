/**
 * Structured query-change proposals and the trusted scope (UI/UX v1 T16; docs/02 D08; docs/03 §5; acceptance A27).
 *
 * The person authorizes a search by including it with their question. Inside that search's conditions, Ask may look
 * again (a subset of its airports, days, cabins and programs; stricter filters), which costs nothing new in scope. A
 * search that changes any hard condition — airports, dates, cabins, programs, nonstop, mixed cabin, dynamic pricing or
 * the mileage cap — is outside it: the tool layer refuses it before any request, and Claude may only propose it. A
 * proposal is a validated QueryObject tied to the revision it was made for; it runs only when the person applies it,
 * once, and not after the query has changed (stale). A model's words ("the user agreed") are never consent.
 */
import type { QueryObject } from "../query/schema";
import type { QueryChangeProposal } from "./types";

/** The status to show and act on: a pending proposal made for another revision is stale. */
export function proposalStatus(proposal: QueryChangeProposal, currentRevision: number): QueryChangeProposal["status"] {
  return proposal.status === "pending" && proposal.baseRevision !== currentRevision ? "stale" : proposal.status;
}

const within = (requested: readonly string[], authorized: readonly string[]) => {
  const allowed = new Set(authorized.map((code) => code.toUpperCase()));
  return requested.length > 0 && requested.every((code) => allowed.has(code.toUpperCase()));
};

/**
 * Whether `requested` stays inside what the person authorized: the same or fewer airports, days, cabins and programs,
 * and no looser filter. The order rows are shown in (sort) is not a condition. Airports are compared as given: a
 * model's metro code is expanded to its airports before this is called; the authorized query is airports as stored.
 */
export function sameAuthorizedScope(requested: QueryObject, authorized: QueryObject): boolean {
  if (!within(requested.origins, authorized.origins) || !within(requested.destinations, authorized.destinations)) return false;
  if (requested.date_from < authorized.date_from || requested.date_to > authorized.date_to || requested.date_from > requested.date_to) return false;
  if (!within(requested.cabins, authorized.cabins)) return false;
  const authorizedPrograms = authorized.programs && authorized.programs.length > 0 ? authorized.programs : null;
  if (authorizedPrograms !== null) {
    const programs = requested.programs && requested.programs.length > 0 ? requested.programs : null;
    // Every program is wider than the ones chosen.
    if (programs === null || !within(programs, authorizedPrograms)) return false;
  }
  if (authorized.direct_only && !requested.direct_only) return false;
  if (typeof authorized.max_miles === "number" && !(typeof requested.max_miles === "number" && requested.max_miles <= authorized.max_miles)) return false;
  if (requested.min_cabin_pct < authorized.min_cabin_pct) return false;
  if (requested.include_filtered && !authorized.include_filtered) return false;
  return true;
}

/** One condition a proposal changes, for a diff the UI renders from typed values, never from the model's words. */
export type ProposalField = "route" | "dates" | "cabins" | "programs" | "direct_only" | "max_miles" | "min_cabin_pct" | "include_filtered";

export interface ProposalChange {
  field: ProposalField;
  before: QueryObject;
  after: QueryObject;
}

const sameSet = (a: readonly string[] | null | undefined, b: readonly string[] | null | undefined) => {
  const x = [...(a ?? [])].map((s) => s.toUpperCase()).sort();
  const y = [...(b ?? [])].map((s) => s.toUpperCase()).sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

/** The hard conditions `after` changes from `before`, in the order the editor lists them. */
export function proposalChanges(before: QueryObject, after: QueryObject): ProposalField[] {
  const changed: ProposalField[] = [];
  if (!sameSet(before.origins, after.origins) || !sameSet(before.destinations, after.destinations)) changed.push("route");
  if (before.date_from !== after.date_from || before.date_to !== after.date_to) changed.push("dates");
  if (!sameSet(before.cabins, after.cabins)) changed.push("cabins");
  if (!sameSet(before.programs, after.programs)) changed.push("programs");
  if (before.direct_only !== after.direct_only) changed.push("direct_only");
  if ((before.max_miles ?? null) !== (after.max_miles ?? null)) changed.push("max_miles");
  if (before.min_cabin_pct !== after.min_cabin_pct) changed.push("min_cabin_pct");
  if (before.include_filtered !== after.include_filtered) changed.push("include_filtered");
  return changed;
}
