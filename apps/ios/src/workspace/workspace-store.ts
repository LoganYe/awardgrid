/**
 * The device's versioned workspace (UI/UX v1 plan 01 T05; docs/03 §3; acceptance A08).
 *
 * Every run of a query takes the next revision and an id, and only the run that is still current may publish its
 * snapshot: a late answer to an older run is dropped, whatever order the answers arrive in. A failed run changes the
 * run state and nothing else, so the snapshot on screen keeps its own query and rows and the failure is shown beside
 * it, not instead of it. Going back to an earlier snapshot, and changing the view, sort or local filter, only change
 * local state; nothing here fetches except `run`.
 *
 * The workspace is saved in its own namespace (`workspace-v1`), never over the older cache/quota/ask/watches files
 * (docs/02 D04). Restoring shows what was saved and runs nothing; coverage read back from disk is re-derived by
 * `restoreCoverage`, so a saved "complete" can only stay complete if its slices still prove it. At most ten snapshots
 * are kept, and their JSON is kept under 5 MiB: the oldest snapshot that is neither shown nor previous goes first, then
 * the previous one; the shown snapshot is always kept, so one snapshot larger than the limit is kept while it is
 * shown. A failed write reports itself and leaves the last good file as it was (the storage port writes
 * atomically). Nothing is written when nothing that is saved has changed since the last save or restore.
 *
 * This store does not serialise runs: two runs may be in flight here, which is what lets it prove the late-answer
 * guard. The production search port (./search-port.ts) runs them one after another against seats.aero, and skips a
 * queued run whose signal this store aborted when a newer run started.
 */
import { restoreCoverage } from "@awardgrid/core/workspace/coverage";
import { scopeKey } from "@awardgrid/core/workspace/identity";
import { isRealDate, parseInstant } from "@awardgrid/core/workspace/semantics";
import type {
  ResultRef,
  ResultSnapshot,
  RunState,
  SearchPort,
  SnapshotId,
  StoragePort,
  ViewPreferences,
  WorkspaceRow,
  WorkspaceState,
} from "@awardgrid/core/workspace/types";
import { Cabin, QueryObject, SortBy } from "@awardgrid/core/query/schema";

export const WORKSPACE_NAMESPACE = "workspace-v1";

/** docs/02 D04: engineering defaults, adjustable here, not a claim about the design. */
export const WORKSPACE_LIMITS = { maxSnapshots: 10, maxBytes: 5 * 1024 * 1024 } as const;

/**
 * A search that ran and failed for a reason the screen can name. `code` is the SearchEngine's ApiFailureCode
 * (no_key, quota, network, seatsaero, …) or a workspace code (invalid_query, invalid_snapshot, internal).
 */
export class SearchRunError extends Error {
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "SearchRunError";
    this.code = code;
  }
}

/**
 * How one run ended, for the caller that started it: shown, failed (with the code the run state carries), or
 * superseded by a newer run before it answered (its answer, if any, was dropped).
 */
export type RunOutcome =
  | { kind: "published"; runId: string; revision: number; snapshotId: SnapshotId }
  | { kind: "failed"; runId: string; revision: number; code: string }
  | { kind: "superseded"; runId: string; revision: number };

export type PersistResult = { ok: true } | { ok: false; code: "write_failed"; message: string };
export type RestoreResult = { restored: number; dropped: number };

export interface WorkspaceStoreOptions {
  search: SearchPort;
  /** The device clock as an ISO instant. */
  now: () => string;
  /** Where the workspace is saved. Without one, persist() and restore() do nothing. */
  storage?: StoragePort;
  limits?: Partial<{ maxSnapshots: number; maxBytes: number }>;
}

export const DEFAULT_PREFERENCES: ViewPreferences = { kind: "list", calendarCabin: "J", sort: "miles_asc", localFilter: {} };

interface SavedWorkspace {
  schemaVersion: 1;
  revision: number;
  displayedId: SnapshotId | null;
  previousId: SnapshotId | null;
  preferences: ViewPreferences;
  /** Oldest first. */
  snapshots: ResultSnapshot[];
}

export class WorkspaceStore {
  readonly #search: SearchPort;
  readonly #now: () => string;
  readonly #storage: StoragePort | null;
  readonly #limits: { maxSnapshots: number; maxBytes: number };
  readonly #listeners = new Set<() => void>();
  /** Oldest first; always contains the displayed and previous snapshots. */
  #history: ResultSnapshot[] = [];
  /** Whether anything that is saved (snapshots, what is shown, preferences) changed since the last save or restore. */
  #dirty = false;
  /** Aborted when the next run starts: the current run is then no longer wanted. */
  #current: AbortController | null = null;
  /** Ids of the snapshots that came back from disk at launch. */
  readonly #restored = new Set<SnapshotId>();
  #state: WorkspaceState = {
    revision: 0,
    draft: null,
    run: { kind: "idle" },
    displayedSnapshot: null,
    previousSnapshot: null,
    selected: [],
    preferences: DEFAULT_PREFERENCES,
  };

  constructor(opts: WorkspaceStoreOptions) {
    this.#search = opts.search;
    this.#now = opts.now;
    this.#storage = opts.storage ?? null;
    this.#limits = { ...WORKSPACE_LIMITS, ...opts.limits };
  }

  /**
   * The current state. A new object after every change, so React's useSyncExternalStore sees each one. `getState`
   * and `subscribe` are bound, so a screen can pass them to useSyncExternalStore as they are.
   */
  readonly getState = (): WorkspaceState => this.#state;

  /** The kept snapshots, oldest first. */
  history(): readonly ResultSnapshot[] {
    return this.#history;
  }

  /** Whether a snapshot came back from disk at launch rather than from a run in this session. */
  wasRestored(id: SnapshotId): boolean {
    return this.#restored.has(id);
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /**
   * Run a structured query. Never throws: every outcome ends in the run state, and the returned outcome says how
   * THIS run ended. An invalid query (schema, or a date that is not on the calendar) fails as `invalid_query`
   * before the search port is called.
   */
  async run(query: QueryObject, meta?: unknown): Promise<RunOutcome> {
    const revision = this.#state.revision + 1;
    const runId = `run-${revision}`;
    this.#current?.abort();
    const controller = new AbortController();
    this.#current = controller;
    const fail = (code: string): RunOutcome => {
      this.#set({ run: { kind: "failed", runId, revision, code } });
      return { kind: "failed", runId, revision, code };
    };
    const parsed = QueryObject.safeParse(query);
    if (!parsed.success || !isRealDate(parsed.data.date_from) || !isRealDate(parsed.data.date_to)) {
      this.#set({ revision });
      return fail("invalid_query");
    }
    this.#set({ revision, run: { kind: "running", runId, revision, startedAt: this.#now() } });

    let snapshot: ResultSnapshot;
    try {
      snapshot = await this.#search.execute(parsed.data, { id: runId, revision, signal: controller.signal, meta });
    } catch (err) {
      if (!this.#isCurrent(runId, revision)) return { kind: "superseded", runId, revision };
      return fail(err instanceof SearchRunError ? err.code : "internal");
    }
    // Only the matching run may publish its snapshot.
    if (!this.#isCurrent(runId, revision)) return { kind: "superseded", runId, revision };
    if (snapshot.revision !== revision || typeof snapshot.id !== "string" || snapshot.id === "") return fail("invalid_snapshot");
    this.#history = [...this.#history.filter((s) => s.id !== snapshot.id), snapshot];
    this.#dirty = true;
    const previous = this.#state.displayedSnapshot;
    this.#set({
      run: { kind: "finished", runId, revision, snapshotId: snapshot.id },
      displayedSnapshot: snapshot,
      previousSnapshot: previous && previous.id !== snapshot.id ? previous : this.#state.previousSnapshot,
    });
    this.#evict();
    return { kind: "published", runId, revision, snapshotId: snapshot.id };
  }

  /** Show a kept snapshot again. Local only: no request, no new revision. */
  showSnapshot(id: SnapshotId): void {
    const target = this.#history.find((s) => s.id === id);
    if (!target) throw new Error(`Unknown snapshot: ${id}`);
    const shown = this.#state.displayedSnapshot;
    if (shown?.id === id) return;
    this.#dirty = true;
    this.#set({ displayedSnapshot: target, previousSnapshot: shown });
  }

  /**
   * Select or clear one result of a snapshot. Local only: never fetches, never changes what is shown. (Limits and the
   * compare bar arrive with T12.)
   */
  setSelected(ref: ResultRef, on: boolean): void {
    const has = this.#state.selected.some((r) => r.snapshotId === ref.snapshotId && r.rowKey === ref.rowKey);
    if (on === has) return;
    const selected = on ? [...this.#state.selected, ref] : this.#state.selected.filter((r) => !(r.snapshotId === ref.snapshotId && r.rowKey === ref.rowKey));
    this.#set({ selected });
  }

  /** View, sort, calendar cabin and local filter. Local only: never fetches. */
  setPreferences(patch: Partial<ViewPreferences>): void {
    this.#dirty = true;
    this.#set({ preferences: { ...this.#state.preferences, ...patch } });
  }

  /** Save to the workspace namespace. Never throws; a failed write leaves the previous file as it was. */
  async persist(): Promise<PersistResult> {
    if (!this.#storage || !this.#dirty) return { ok: true };
    const saved: SavedWorkspace = {
      schemaVersion: 1,
      revision: this.#state.revision,
      displayedId: this.#state.displayedSnapshot?.id ?? null,
      previousId: this.#state.previousSnapshot?.id ?? null,
      preferences: this.#state.preferences,
      snapshots: this.#history,
    };
    // Cleared before the write, so a change made while it is in flight marks the store dirty again.
    this.#dirty = false;
    try {
      await this.#storage.writeAtomically(WORKSPACE_NAMESPACE, saved);
      return { ok: true };
    } catch (err) {
      this.#dirty = true;
      return { ok: false, code: "write_failed", message: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Read the saved workspace. Runs nothing. Anything damaged is dropped (the whole file if it is not a workspace,
   * a snapshot if any part of it is unreadable); coverage is re-derived, never trusted.
   */
  async restore(): Promise<RestoreResult> {
    if (!this.#storage) return { restored: 0, dropped: 0 };
    let raw: unknown;
    try {
      raw = await this.#storage.read(WORKSPACE_NAMESPACE);
    } catch {
      return { restored: 0, dropped: 0 };
    }
    if (!isRecord(raw) || raw.schemaVersion !== 1 || !Array.isArray(raw.snapshots)) {
      return { restored: 0, dropped: raw === null || raw === undefined ? 0 : 1 };
    }
    const snapshots: ResultSnapshot[] = [];
    let dropped = 0;
    for (const candidate of raw.snapshots) {
      const snapshot = readSnapshot(candidate);
      if (snapshot && !snapshots.some((s) => s.id === snapshot.id)) snapshots.push(snapshot);
      else dropped++;
    }
    const byId = (id: unknown) => (typeof id === "string" ? (snapshots.find((s) => s.id === id) ?? null) : null);
    const displayed = byId(raw.displayedId) ?? snapshots.at(-1) ?? null;
    const previous = byId(raw.previousId);
    const maxRevision = Math.max(0, ...snapshots.map((s) => s.revision), Number.isSafeInteger(raw.revision) ? (raw.revision as number) : 0);
    this.#history = snapshots;
    for (const s of snapshots) this.#restored.add(s.id);
    this.#set({
      revision: Math.max(this.#state.revision, maxRevision),
      run: { kind: "idle" },
      displayedSnapshot: displayed,
      previousSnapshot: previous && previous.id !== displayed?.id ? previous : null,
      preferences: readPreferences(raw.preferences),
    });
    this.#evict();
    // What is in memory is what is on disk, unless something had to be dropped on the way in.
    this.#dirty = dropped > 0 || this.#history.length < snapshots.length;
    return { restored: snapshots.length, dropped };
  }

  #isCurrent(runId: string, revision: number): boolean {
    const current: RunState = this.#state.run;
    return current.kind === "running" && current.runId === runId && current.revision === revision;
  }

  /**
   * Drop the oldest snapshots that are neither shown nor previous until both limits hold; if they still do not, drop
   * the previous one too. The shown snapshot always stays. Sizes are the snapshots' UTF-8 JSON bytes; the file's
   * own wrapper (preferences, ids, the slot envelope) is a few hundred bytes on top.
   */
  #evict(): void {
    const shownId = this.#state.displayedSnapshot?.id;
    const previousId = this.#state.previousSnapshot?.id;
    const size = (s: ResultSnapshot) => new TextEncoder().encode(JSON.stringify(s)).length;
    let bytes = this.#history.reduce((sum, s) => sum + size(s), 0);
    const over = (list: ResultSnapshot[]) => list.length > this.#limits.maxSnapshots || bytes > this.#limits.maxBytes;
    let kept = [...this.#history];
    for (const protect of [new Set([shownId, previousId]), new Set([shownId])]) {
      for (let i = 0; i < kept.length && over(kept); ) {
        const s = kept[i]!;
        if (protect.has(s.id)) {
          i++;
          continue;
        }
        bytes -= size(s);
        kept = kept.filter((_, j) => j !== i);
      }
    }
    if (kept.length !== this.#history.length) this.#dirty = true;
    this.#history = kept;
    if (previousId && !kept.some((s) => s.id === previousId)) this.#set({ previousSnapshot: null });
  }

  #set(patch: Partial<WorkspaceState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of [...this.#listeners]) {
      try {
        listener();
      } catch {
        // One broken subscriber must not stop the others.
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const TIME_BASES = new Set(["provider_last_seen", "provider_updated", "local_fallback", "unknown"]);

function isRow(value: unknown): value is WorkspaceRow {
  if (!isRecord(value) || typeof value.key !== "string" || !isRecord(value.value) || !isRecord(value.time)) return false;
  const row = value.value;
  const time = value.time;
  return (
    typeof row.origin === "string" &&
    typeof row.dest === "string" &&
    typeof row.program === "string" &&
    isRealDate(row.date) &&
    Cabin.safeParse(row.cabin).success &&
    TIME_BASES.has(time.basis as string)
  );
}

/** A saved snapshot, re-checked field by field; null if any part is unreadable. */
function readSnapshot(value: unknown): ResultSnapshot | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null;
  if (typeof value.id !== "string" || value.id === "" || !Number.isSafeInteger(value.revision)) return null;
  // The screen dates the snapshot from createdAt, so it must be a real instant.
  if (typeof value.createdAt !== "string" || parseInstant(value.createdAt) === null) return null;
  const query = QueryObject.safeParse(value.query);
  if (!query.success || !isRealDate(query.data.date_from) || !isRealDate(query.data.date_to)) return null;
  if (!Array.isArray(value.rows) || !value.rows.every(isRow)) return null;
  const scope = scopeKey(query.data);
  const receipt = isRecord(value.receipt) ? value.receipt : {};
  return {
    schemaVersion: 1,
    id: value.id,
    revision: value.revision as number,
    query: query.data,
    scopeKey: scope,
    createdAt: value.createdAt,
    rows: value.rows,
    coverage: restoreCoverage(value.coverage, scope),
    receipt: {
      sentCalls: Number.isSafeInteger(receipt.sentCalls) && (receipt.sentCalls as number) >= 0 ? (receipt.sentCalls as number) : null,
      fromCache: receipt.fromCache === true,
    },
  };
}

function readPreferences(value: unknown): ViewPreferences {
  if (!isRecord(value)) return DEFAULT_PREFERENCES;
  const kind = value.kind === "list" || value.kind === "calendar" || value.kind === "matrix" ? value.kind : DEFAULT_PREFERENCES.kind;
  const cabin = Cabin.safeParse(value.calendarCabin);
  const sort = SortBy.safeParse(value.sort);
  const filter = isRecord(value.localFilter) ? value.localFilter : {};
  const localFilter: ViewPreferences["localFilter"] = {};
  if (Number.isSafeInteger(filter.maxMiles) && (filter.maxMiles as number) > 0) localFilter.maxMiles = filter.maxMiles as number;
  if (filter.onlyKnownSeats === true) localFilter.onlyKnownSeats = true;
  return {
    kind,
    calendarCabin: cabin.success ? cabin.data : DEFAULT_PREFERENCES.calendarCabin,
    sort: sort.success ? sort.data : DEFAULT_PREFERENCES.sort,
    localFilter,
  };
}
