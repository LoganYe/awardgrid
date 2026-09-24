/**
 * Coverage evidence (handoff docs/03 §1; plan 01 T03): how much of a query's scope a result really covers.
 *
 *   runEvidence(outcomes)                     what one fetch proves: ran to its end, hit the page cap, or stopped for quota
 *   recordEvidence(records, pair, scope, …)   what the cache's coverage records prove for one pair on a cache hit
 *   coverageFor(query, pairs)                 the CoverageEvidence for a result, one slice per pair
 *   restoreCoverage(input, expectedScope)     read persisted evidence back without trusting anything it cannot re-prove
 *
 * "complete" is a claim with proof behind it: every pair, day, cabin and program of the scope checked to the end,
 * or explicitly not monitored by the provider. A page cap, a quota stop, a legacy record with no evidence, or
 * evidence for another scope never becomes complete (acceptance A05).
 */
import { type CacheQuery, type CoverageRecord, type CoverageRecordEvidence, coverageSatisfies, readRecordEvidence } from "../seatsaero/cache";
import { CABIN_ORDER, type Cabin, type QueryObject } from "../query/schema";
import { scopeKey } from "./identity";
import { isRealDate } from "./semantics";
import type { CoverageEvidence, CoverageSlice, CoverageState } from "./types";

// ---- one fetch ---------------------------------------------------------------------------------------------

/**
 * How one planned request ended. `truncated`: stopped at the page budget with more reported. `skipped`: never
 * sent, because the budget was used up first. `incomplete`: the API reported more but returned an empty page.
 */
export interface RequestOutcome {
  truncated: boolean;
  skipped: boolean;
  incomplete?: boolean;
}

export interface RunEvidenceOptions {
  /** The run's page budget was set by the remaining daily quota, not by the page cap: a stop is a quota stop. */
  quotaBound?: boolean;
}

/** What a run proves for every pair it fetched. A run with no request that ran proves nothing complete. */
export function runEvidence(outcomes: readonly RequestOutcome[], opts: RunEvidenceOptions = {}): CoverageRecordEvidence {
  if (outcomes.length === 0) return { state: "partial", reason: "quota" };
  if (outcomes.some((o) => o.skipped)) return { state: "partial", reason: "quota" };
  if (outcomes.some((o) => o.truncated)) return { state: "partial", reason: opts.quotaBound ? "quota" : "page_cap" };
  if (outcomes.some((o) => o.incomplete)) return { state: "partial", reason: "upstream_error" };
  return { state: "complete", reason: "exhausted" };
}

/**
 * Whether a record's fetch may have replaced rows this scope serves: same pair, same row scope (include_filtered,
 * min_cabin_pct), and intersecting dates, cabins and programs. direct_only is ignored on purpose — a direct-only
 * fetch still deletes and rewrites the direct rows an all-flights query serves.
 */
function overlaps(r: CoverageRecord, pair: { origin: string; dest: string }, scope: CacheQuery): boolean {
  if (r.origin !== pair.origin || r.dest !== pair.dest) return false;
  if ((r.include_filtered ?? false) !== (scope.include_filtered ?? false)) return false;
  if ((r.min_cabin_pct ?? 100) !== (scope.min_cabin_pct ?? 100)) return false;
  if (r.date_from > scope.date_to || r.date_to < scope.date_from) return false;
  if (!r.cabins.some((c) => scope.cabins.includes(c))) return false;
  if (r.programs !== null && scope.programs !== undefined && !r.programs.some((p) => scope.programs!.includes(p))) return false;
  return true;
}

/**
 * The evidence the cache holds for one pair of a cache-served query.
 *
 * `records` must be in write order (the in-memory store appends; the SQLite store returns them oldest fetch first
 * and downgrades a cell's evidence itself when an older fetch is written after a newer one). The newest record that
 * satisfies the lookup AND proves completeness is the candidate; it stands only if no overlapping record written
 * after it failed to prove completeness — such a later fetch replaced some of the rows served here, so the pair is
 * partial (a later partial) or unknown (a later record with no evidence). With no complete candidate, the newest
 * satisfying partial record gives the reason; records with no evidence at all prove nothing (null = unknown).
 */
export function recordEvidence(
  records: readonly CoverageRecord[],
  pair: { origin: string; dest: string },
  scope: CacheQuery,
  ttlMinutes: number,
  now: Date,
): CoverageRecordEvidence | null {
  const satisfies = (r: CoverageRecord) => r.origin === pair.origin && r.dest === pair.dest && coverageSatisfies(r, scope, ttlMinutes, now);
  let candidate = -1;
  for (let i = records.length - 1; i >= 0; i--) {
    if (satisfies(records[i]!) && readRecordEvidence(records[i]!.evidence)?.state === "complete") {
      candidate = i;
      break;
    }
  }
  if (candidate >= 0) {
    const later = records.slice(candidate + 1).filter((r) => overlaps(r, pair, scope));
    const laterEvidence = later.map((r) => readRecordEvidence(r.evidence));
    const laterPartial = laterEvidence.find((e) => e?.state === "partial");
    if (laterPartial) return laterPartial;
    if (laterEvidence.some((e) => e === null)) return null;
    return { state: "complete", reason: "exhausted" };
  }
  for (let i = records.length - 1; i >= 0; i--) {
    const e = satisfies(records[i]!) ? readRecordEvidence(records[i]!.evidence) : null;
    if (e?.state === "partial") return e;
  }
  return null;
}

export interface PairEvidence {
  origin: string;
  dest: string;
  /** null = no evidence (legacy record). */
  evidence: CoverageRecordEvidence | null;
  /** The provider's route catalog proves the pair is not monitored. */
  unmonitored: boolean;
}

/** The CoverageEvidence of one result: a slice per pair over the query's dates, cabins and programs. */
export function coverageFor(query: QueryObject, pairs: readonly PairEvidence[]): CoverageEvidence {
  const programs = query.programs && query.programs.length > 0 ? [...new Set(query.programs)].sort() : null;
  const cabins = sortedCabins(query.cabins);
  const slices: CoverageSlice[] = pairs.map((p) => {
    const base = { origin: p.origin, destination: p.dest, dateFrom: query.date_from, dateTo: query.date_to, cabins: [...cabins], programs: programs ? [...programs] : null };
    if (p.unmonitored) return { ...base, state: "unmonitored", reason: "not_monitored" };
    if (p.evidence === null) return { ...base, state: "unknown", reason: "missing_evidence" };
    return { ...base, state: p.evidence.state, reason: p.evidence.reason };
  });
  return { state: stateOf(slices), scopeKey: scopeKey(query), slices };
}

function sortedCabins(cabins: readonly Cabin[]): Cabin[] {
  return [...new Set(cabins)].sort((a, b) => CABIN_ORDER.indexOf(a) - CABIN_ORDER.indexOf(b));
}

/** Weakest wins: any partial slice → partial; else any unknown → unknown; else complete. */
function stateOf(slices: readonly CoverageSlice[]): CoverageEvidence["state"] {
  if (slices.length === 0) return "unknown";
  if (slices.some((s) => s.state === "partial")) return "partial";
  if (slices.some((s) => s.state === "unknown")) return "unknown";
  return "complete";
}

// ---- persisted evidence ------------------------------------------------------------------------------------

/** What a v1 scope key (identity.ts) says the scope is. Only what completeness is checked against. */
export interface ParsedScope {
  origins: string[];
  destinations: string[];
  dateFrom: string;
  dateTo: string;
  cabins: Cabin[];
  /** null = every program. */
  programs: string[] | null;
}

const CABINS: ReadonlySet<string> = new Set(["Y", "W", "J", "F"]);

function decodeList(value: string): string[] | null {
  if (value === "") return null;
  try {
    return value.split(",").map(decodeURIComponent);
  } catch {
    return null;
  }
}

export function parseScopeKey(scope: string): ParsedScope | null {
  const parts = scope.split("|");
  if (parts[0] !== "v1") return null;
  const fields = new Map<string, string>();
  for (const part of parts.slice(1)) {
    const eq = part.indexOf("=");
    if (eq < 1) return null;
    fields.set(part.slice(0, eq), part.slice(eq + 1));
  }
  const origins = decodeList(fields.get("o") ?? "");
  const destinations = decodeList(fields.get("d") ?? "");
  const cabins = decodeList(fields.get("c") ?? "");
  const dateFrom = fields.get("f") ?? "";
  const dateTo = fields.get("t") ?? "";
  const programsField = fields.get("p");
  const programs = programsField === "*" ? null : decodeList(programsField ?? "");
  if (!origins || !destinations || !cabins || !isRealDate(dateFrom) || !isRealDate(dateTo) || dateFrom > dateTo) return null;
  if (!cabins.every((c) => CABINS.has(c))) return null;
  if (programsField !== "*" && !programs) return null;
  return { origins, destinations, dateFrom, dateTo, cabins: cabins as Cabin[], programs };
}

const SLICE_STATES: ReadonlySet<string> = new Set(["complete", "partial", "unmonitored", "unknown"]);
/** Each state's reasons. A slice whose reason does not belong to its state is malformed. */
const REASONS_BY_STATE: Record<CoverageState, ReadonlySet<string>> = {
  complete: new Set(["exhausted"]),
  partial: new Set(["page_cap", "quota", "upstream_error"]),
  unmonitored: new Set(["not_monitored"]),
  unknown: new Set(["missing_evidence"]),
};

function validSlice(value: unknown): CoverageSlice | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const { origin, destination, dateFrom, dateTo, cabins, programs, state, reason } = v;
  if (typeof origin !== "string" || typeof destination !== "string" || origin === "" || destination === "") return null;
  if (!isRealDate(dateFrom) || !isRealDate(dateTo) || dateFrom > dateTo) return null;
  if (!Array.isArray(cabins) || cabins.length === 0 || !cabins.every((c) => typeof c === "string" && CABINS.has(c))) return null;
  if (programs !== null && !(Array.isArray(programs) && programs.every((p) => typeof p === "string"))) return null;
  if (typeof state !== "string" || !SLICE_STATES.has(state)) return null;
  if (typeof reason !== "string" || !REASONS_BY_STATE[state as CoverageState].has(reason)) return null;
  return {
    origin,
    destination,
    dateFrom,
    dateTo,
    cabins: [...(cabins as Cabin[])],
    programs: programs === null ? null : [...(programs as string[])],
    state: state as CoverageState,
    reason: reason as CoverageSlice["reason"],
  };
}

/** Whether complete/unmonitored slices prove every pair × day × cabin × program of the scope. */
function provesScope(slices: readonly CoverageSlice[], scope: ParsedScope): boolean {
  const proving = slices.filter((s) => s.state === "complete" || s.state === "unmonitored");
  const covers = (s: CoverageSlice, origin: string, dest: string, program: string | null) =>
    s.origin === origin &&
    s.destination === dest &&
    s.dateFrom <= scope.dateFrom &&
    s.dateTo >= scope.dateTo &&
    scope.cabins.every((c) => s.cabins.includes(c)) &&
    (s.programs === null || (program !== null && s.programs.includes(program)));
  return scope.origins.every((o) =>
    scope.destinations.every((d) => (scope.programs === null ? [null] : scope.programs).every((p) => proving.some((s) => covers(s, o, d, p)))),
  );
}

/**
 * Read persisted evidence back. Anything that is not evidence for `expectedScope`, or has a malformed slice, is no
 * evidence (unknown). The state is re-derived from the slices, "complete" is kept only when the slices prove the
 * whole scope (which needs a readable v1 scope key), and a stored partial or unknown is never upgraded.
 */
export function restoreCoverage(input: unknown, expectedScope: string): CoverageEvidence {
  const unknown: CoverageEvidence = { state: "unknown", scopeKey: expectedScope, slices: [] };
  if (input === null || typeof input !== "object") return unknown;
  const v = input as Record<string, unknown>;
  if (v.scopeKey !== expectedScope) return unknown;
  if (v.state !== "complete" && v.state !== "partial" && v.state !== "unknown") return unknown;
  if (!Array.isArray(v.slices)) return unknown;
  const slices: CoverageSlice[] = [];
  for (const raw of v.slices) {
    const s = validSlice(raw);
    if (!s) return unknown;
    slices.push(s);
  }
  let state = stateOf(slices);
  if (state === "complete") {
    const scope = parseScopeKey(expectedScope);
    if (!scope || !provesScope(slices, scope)) state = "unknown";
  }
  // Never upgrade what was saved: re-derivation may only weaken a claim.
  if (v.state !== "complete" && state === "complete") state = v.state;
  return { state, scopeKey: expectedScope, slices };
}
