/**
 * The last successful grid search, for Ask and for the Search screen.
 *
 * Ask offers "Include my last search", and the Search screen keeps its grid when the person goes to Ask and
 * back (design §6.2). Both read this one value.
 *
 * In the app it is a view of the workspace (UI/UX v1 T05; docs/01 "迁移到版本化工作区适配，不复制数据源"): the last search
 * is whatever snapshot the workspace shows. For a snapshot this session produced it is the text that was typed and
 * the engine's answer; for one restored from disk it is rebuilt from the snapshot itself and says when it was saved
 * (spec §07: a relaunch restores the snapshot and shows its time; it never re-runs it). Nothing here is written to
 * disk; the workspace saves its own snapshots.
 */
import type { ResultSnapshot, SnapshotId } from "@awardgrid/core/workspace/types";
import type { FindValue } from "./search";

/**
 * What the Search screen and Ask read from a search: the engine's answer, or the same view rebuilt from a saved
 * snapshot. `api_calls_used` is null when it is not known, never 0; quota and notices belong to a fresh answer only.
 */
export type SearchView = Omit<FindValue, "api_calls_used" | "quota" | "notices"> & {
  api_calls_used: number | null;
  quota?: FindValue["quota"];
  notices?: FindValue["notices"];
};

export interface LastSearchEntry {
  /** The query as the person typed it (for a restored snapshot, the query's own raw text). */
  text: string;
  /** The search's result, whose `query` is what Ask describes to Claude. */
  value: SearchView;
  /** Set when the entry is a saved snapshot shown again: when that snapshot was made. */
  savedAt?: string;
}

export interface LastSearchStore {
  get(): LastSearchEntry | null;
  set(entry: LastSearchEntry): void;
}

/** A plain in-memory last search, for tests and screens rendered without a workspace. */
export function createLastSearch(): LastSearchStore {
  let last: LastSearchEntry | null = null;
  return {
    get: () => last,
    set(entry) {
      last = { text: entry.text, value: entry.value };
    },
  };
}

/** What the workspace view needs from the workspace. */
export interface ShownSnapshots {
  getState(): { displayedSnapshot: Pick<ResultSnapshot, "id"> | ResultSnapshot | null };
  history(): ReadonlyArray<{ id: SnapshotId }>;
  /** Whether a snapshot came back from disk at launch (as opposed to being produced in this session). */
  wasRestored?(id: SnapshotId): boolean;
}

function isSnapshot(value: Pick<ResultSnapshot, "id"> | ResultSnapshot): value is ResultSnapshot {
  return "query" in value && "rows" in value;
}

export interface WorkspaceLastSearch extends LastSearchStore {
  /** Remember what was typed for one published snapshot. Entries for snapshots the workspace dropped are forgotten. */
  record(snapshotId: SnapshotId, entry: LastSearchEntry): void;
}

/** Rebuilds the screen's view of a snapshot this session did not produce. */
export type SnapshotViewer = (snapshot: ResultSnapshot) => SearchView;

/** Recorded entries for snapshots the workspace has not shown yet (recorded just before it publishes one). */
const PENDING = 4;

export function createWorkspaceLastSearch(workspace: ShownSnapshots, view?: SnapshotViewer): WorkspaceLastSearch {
  const entries = new Map<SnapshotId, LastSearchEntry>();
  const record = (snapshotId: SnapshotId, entry: LastSearchEntry) => {
    entries.delete(snapshotId);
    entries.set(snapshotId, { text: entry.text, value: entry.value });
    // Keep entries for kept snapshots, plus the few most recent ones not published yet.
    const kept = new Set(workspace.history().map((s) => s.id));
    const pending = [...entries.keys()].filter((id) => !kept.has(id));
    for (const id of pending.slice(0, Math.max(0, pending.length - PENDING))) entries.delete(id);
  };
  return {
    get() {
      const shown = workspace.getState().displayedSnapshot;
      if (!shown) return null;
      const known = entries.get(shown.id);
      if (known) return known;
      if (!view || !isSnapshot(shown)) return null;
      // Built once per snapshot, then kept like a recorded entry. Only a snapshot restored from disk is labelled as
      // saved; the app records its own answers before the workspace shows them.
      let value: SearchView;
      try {
        value = view(shown);
      } catch {
        return null; // A snapshot that cannot be drawn is not offered, rather than taking the screen down.
      }
      const restored = workspace.wasRestored?.(shown.id) ?? true;
      const rebuilt: LastSearchEntry = restored ? { text: shown.query.raw_text, value, savedAt: shown.createdAt } : { text: shown.query.raw_text, value };
      entries.set(shown.id, rebuilt);
      return rebuilt;
    },
    /** For the snapshot on screen now. The app records by snapshot id instead (`record`). */
    set(entry) {
      const shown = workspace.getState().displayedSnapshot;
      if (shown) record(shown.id, entry);
    },
    record,
  };
}
