/**
 * The UI/UX v1 workspace contract (docs/uiux-v1; handoff docs/03). One place for every shared type, so the iOS
 * shell, the web and the tests agree on what a query version, a result snapshot and a reference are.
 *
 * The rule these types exist to hold: every view (list, calendar, matrix, details, compare, AI) reads the same
 * snapshot of the same query version, and nothing unknown is ever presented as zero, success or "just now".
 *
 * Runtime-independent: no Next, Capacitor, Node-only or key-handling import may appear in this directory.
 */
import type { AvailabilityRow } from "../grid/types";
import type { Cabin, QueryObject } from "../query/schema";
import type { TripSummary } from "../seatsaero/trips";

/** A validated ISO 8601 instant with a zone (…Z or …±hh:mm). Never UI text. */
export type ISOInstant = string;
/** A validated real Gregorian calendar day, YYYY-MM-DD. A query day, not shifted by any device zone. */
export type ISODate = string;
export type QueryRevision = number;
export type SnapshotId = string;
/** Canonical scope + program + source id + pair + day + cabin (+ row scope). Never an array index. */
export type RowKey = string;

/**
 * Where a row's time came from.
 * - provider_last_seen: seats.aero ComputedLastSeen.
 * - provider_updated:   seats.aero UpdatedAt (the documented update time).
 * - local_fallback:     the provider sent no usable time; only this device's fetch time is known.
 * - unknown:            the time's provenance was never recorded (a row from before it was, or from a store that
 *                       drops it), or there is no valid time at all. `fetchedAt` may still be shown on its own.
 */
export type TimeBasis = "provider_last_seen" | "provider_updated" | "local_fallback" | "unknown";

export interface TimeEvidence {
  basis: TimeBasis;
  /** The provider's time, only when `basis` is a provider basis. */
  providerAt: ISOInstant | null;
  /** When this device fetched it. Shown separately; never used as the provider's freshness. */
  fetchedAt: ISOInstant | null;
}

export type CoverageState = "complete" | "partial" | "unmonitored" | "unknown";

export interface CoverageSlice {
  origin: string;
  destination: string;
  dateFrom: ISODate;
  dateTo: ISODate;
  cabins: Cabin[];
  /** null = every program in scope, not an empty proof. */
  programs: string[] | null;
  state: CoverageState;
  reason: "exhausted" | "page_cap" | "quota" | "upstream_error" | "not_monitored" | "missing_evidence";
}

export interface CoverageEvidence {
  state: "complete" | "partial" | "unknown";
  scopeKey: string;
  slices: CoverageSlice[];
}

export interface WorkspaceRow {
  key: RowKey;
  value: AvailabilityRow;
  time: TimeEvidence;
}

export interface RequestReceipt {
  /** Calls actually sent, from the transport's own record. Unknown is null, never 0. */
  sentCalls: number | null;
  fromCache: boolean;
}

export interface ResultSnapshot {
  schemaVersion: 1;
  id: SnapshotId;
  revision: QueryRevision;
  query: QueryObject;
  scopeKey: string;
  createdAt: ISOInstant;
  rows: WorkspaceRow[];
  coverage: CoverageEvidence;
  receipt: RequestReceipt;
}

export type ViewKind = "list" | "calendar" | "matrix";

export interface ViewPreferences {
  kind: ViewKind;
  calendarCabin: Cabin;
  sort: QueryObject["sort_by"];
  localFilter: { maxMiles?: number; onlyKnownSeats?: boolean };
}

/** A reference to one row of one snapshot. The only way views, selection, details and AI point at a result. */
export interface ResultRef {
  snapshotId: SnapshotId;
  rowKey: RowKey;
}

// ---- query drafts (T06) -------------------------------------------------------------------------------------

export type DateRule = { kind: "fixed"; from: ISODate; to: ISODate } | { kind: "relative_days"; days: number; clock: "UTC" };

export interface QueryDraft {
  query: QueryObject;
  dates: DateRule;
}

// ---- projection (T08) ---------------------------------------------------------------------------------------

export interface ProjectedDay {
  date: ISODate;
  cabin: Cabin;
  rowKeys: RowKey[];
  minMiles: number | null;
  /**
   * What the search proved for this day and cabin (additive, T08): "complete" when every monitored route was checked
   * to the end for every program asked; "unmonitored" when no route is monitored; otherwise the weakest of "partial"
   * and "unknown" — and never stronger than the snapshot's own coverage verdict. An empty day reads "no matches" only
   * when complete, and a minimum is "the lowest retrieved" otherwise.
   */
  coverage: "complete" | "partial" | "unknown" | "unmonitored";
  /** Rows for this day and cabin that the local filter hides (additive, T08): such a day is never "no matches". */
  hidden: number;
}

export interface ProjectedCell {
  origin: string;
  dest: string;
  date: ISODate;
  cabin: Cabin;
  rowKeys: RowKey[];
  /** Rows of this route, day and cabin the local filter hides (additive, T08); a cell may hold only hidden rows. */
  hidden: number;
}

/** Why a matrix slot or calendar day has no options shown: the view filter, or what the search proved. */
export type EmptyKind = "hidden" | ProjectedDay["coverage"];

/** One cabin of one matrix cell (T09): its rows, the one it shows (lowest miles), or why it is empty. */
export interface MatrixSlot {
  cabin: Cabin;
  rowKeys: RowKey[];
  /** The row whose miles the slot shows: the lowest, ties by fees within one currency (projection order). */
  best: RowKey | null;
  hidden: number;
  state: "results" | EmptyKind;
  /** What the search proved for this route, day and cabin; with results, "lowest" needs "complete". */
  coverage: ProjectedDay["coverage"];
}

/** The matrix (T09): the query's dates by its routes, each cell a slot per cabin asked, in cabin order. */
export interface MatrixModel {
  dates: ISODate[];
  routes: Array<{ origin: string; dest: string }>;
  cabins: Cabin[];
  /** cells[dateIndex][routeIndex]. */
  cells: Array<Array<{ origin: string; dest: string; date: ISODate; slots: MatrixSlot[] }>>;
}

export interface ProjectedResults {
  rows: WorkspaceRow[];
  days: ProjectedDay[];
  cells: ProjectedCell[];
  coverage: CoverageEvidence;
  /** Rows of the snapshot the local filter hides (additive, T08): the views say so rather than "no results". */
  hiddenByFilter: number;
  /**
   * Rows the snapshot holds that the query itself leaves out (additive, T09 review) — above its mileage cap, another
   * cabin or program, not nonstop when it asks for nonstop — never shown and never counted as hidden; of them, the
   * dynamically priced ones the query did not ask for are counted, so a view can say they exist.
   */
  dynamicNotShown: number;
}

// ---- run state and platform ports (T05) --------------------------------------------------------------------

export type RunState =
  | { kind: "idle" }
  | { kind: "running"; runId: string; revision: number; startedAt: ISOInstant }
  | { kind: "failed"; runId: string; revision: number; code: string }
  | { kind: "finished"; runId: string; revision: number; snapshotId: SnapshotId };

export interface WorkspaceState {
  revision: number;
  draft: QueryDraft | null;
  run: RunState;
  displayedSnapshot: ResultSnapshot | null;
  previousSnapshot: ResultSnapshot | null;
  selected: ResultRef[];
  preferences: ViewPreferences;
}

/**
 * One run as the search port receives it. `signal` is aborted once a newer run has started, so a port that queues
 * runs can skip one nobody is waiting for before it sends anything (it cannot recall a request already sent).
 * `meta` is the caller's own data for this run, passed through untouched (additive, UI/UX v1 T05).
 */
export interface SearchRun {
  id: string;
  revision: number;
  signal?: AbortSignal;
  meta?: unknown;
}

export interface SearchPort {
  execute(query: QueryObject, run: SearchRun): Promise<ResultSnapshot>;
}

export interface StoragePort {
  read(name: string): Promise<unknown>;
  writeAtomically(name: string, value: unknown): Promise<void>;
  remove(name: string): Promise<void>;
}

// ---- details (T10) ------------------------------------------------------------------------------------------

export interface DetailResult {
  status: "ready" | "partial" | "unavailable";
  sourceId: string;
  cabin: Cabin;
  /** The repository's validated trip summaries; never a raw API payload. */
  trips: TripSummary[];
  evidence: TimeEvidence;
  receipt: RequestReceipt;
}

export interface DetailPort {
  load(ref: ResultRef): Promise<DetailResult>;
}

// ---- AI context and proposals (T15/T16) --------------------------------------------------------------------

export interface AIContext {
  revision: number;
  snapshotId: SnapshotId | null;
  /** What was actually serialised and sent, not what a checkbox said. */
  sent: "query_only" | "query_and_selected_rows";
  query: QueryObject;
  selectedRefs: ResultRef[];
}

export interface QueryChangeProposal {
  id: string;
  baseRevision: number;
  proposed: QueryObject;
  reason: string;
  status: "pending" | "applied" | "dismissed" | "stale";
}

// ---- watches and favourites (T13/T14/T20) ------------------------------------------------------------------

/** What a platform can really do. The UI reads this; it never infers background ability from the viewport. */
export interface WatchCapabilities {
  checkOnForeground: boolean;
  scheduledChecks: boolean;
  pushEnabled: boolean;
}

export interface SavedQueryV2 {
  schemaVersion: 2;
  id: string;
  title: string;
  draft: QueryDraft;
  enabled: boolean;
  legacyRawText?: string;
}

export interface FavoriteV1 {
  schemaVersion: 1;
  id: string;
  savedAt: ISOInstant;
  query: QueryObject;
  rows: WorkspaceRow[];
  coverage: CoverageEvidence;
  originalSnapshotId: SnapshotId;
}
