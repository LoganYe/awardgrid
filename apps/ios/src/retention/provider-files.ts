/** OAuth files retain user configuration, never provider responses, including the older backup copies. */
import type { FileStore } from "../store/persistence";
import { watchReset } from "./short-term";
import { accountFavorite } from "../store/favorites-store";
import type { FavoriteV1 } from "@awardgrid/core/workspace/types";

const WATCH_FILE = /^watches(?:\.v1|\.damaged-[A-Za-z0-9-]+)?\.json$/;
const SLOT_FILE = /^(workspace-v1|favorites-v1)\.[ab]\.json$/;
const KNOWN_FILES = ["cache.json", "ask.json", "watches.json", "watches.v1.json", "workspace-v1.a.json", "workspace-v1.b.json", "favorites-v1.a.json", "favorites-v1.b.json"];
const known = (path: string) => path === "cache.json" || path === "ask.json" || WATCH_FILE.test(path) || SLOT_FILE.test(path);
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const errorText = (error: unknown) => error instanceof Error ? error.message || error.name : String(error);

interface Cleaned { value: unknown; uncertain?: boolean }

function cleanWatch(value: unknown): Cleaned {
  if (!record(value)) return { value, uncertain: true };
  return { value: { ...value, ...watchReset() }, uncertain: typeof value.id !== "string" || typeof value.text !== "string" };
}

function cleanResult(value: unknown, saved: boolean): Cleaned {
  if (!record(value)) return { value, uncertain: true };
  const source = saved && record(value.query) && typeof value.originalSnapshotId === "string" ? accountFavorite(value as unknown as FavoriteV1) as unknown as Record<string, unknown> : value;
  const origin = typeof source.originalSnapshotId === "string" ? source.originalSnapshotId.split("#")[0] : source.originalSnapshotId;
  return {
    value: {
      ...source,
      rows: [],
      coverage: { state: "unknown" },
      ...(saved ? { originalSnapshotId: origin, rowsRemoved: { at: source.savedAt, options: 0 } } : { receipt: { sentCalls: null, fromCache: false } }),
    },
    uncertain: source.schemaVersion !== 1 || !record(source.query),
  };
}

/** Only fields whose role is known are cleared. Unknown versions/shapes remain an explicit cleanup failure. */
function clean(path: string, value: unknown): Cleaned {
  if (!record(value)) return { value, uncertain: true };
  if (WATCH_FILE.test(path)) {
    if (!Array.isArray(value.watches)) return { value, uncertain: true };
    const watches = value.watches.map(cleanWatch);
    return { value: { ...value, watches: watches.map((entry) => entry.value) }, uncertain: ![1, 2].includes(value.version as number) || watches.some((entry) => entry.uncertain) };
  }
  if (path === "cache.json") {
    if (!Array.isArray(value.users)) return { value, uncertain: true };
    return { value: { ...value, users: value.users.map((user) => record(user) ? { ...user, rows: [], coverage: [] } : user) }, uncertain: value.version !== 1 || value.users.some((user) => !record(user)) };
  }
  if (path === "ask.json") {
    if (value.conversation === null) return { value, uncertain: value.version !== 1 };
    if (!record(value.conversation) || !Array.isArray(value.conversation.entries)) return { value, uncertain: true };
    const entries = value.conversation.entries.map((entry) => {
      if (!record(entry)) return entry;
      return { ...entry, texts: [], steps: [], proposals: Array.isArray(entry.proposals) ? entry.proposals.map((proposal) => record(proposal) ? { ...proposal, reason: "" } : proposal) : [], context: { sent: "none", snapshotId: null, revision: null, refs: [], earlier: 0 }, end: record(entry.end) ? { ...entry.end, committed: false, failure: null } : entry.end };
    });
    return {
      value: { ...value, conversation: { ...value.conversation, committed: [], entries, seenIds: [], bookingUrls: [], flightsMemo: [] } },
      uncertain: value.version !== 1 || entries.some((entry) => !record(entry) || typeof entry.question !== "string"),
    };
  }
  if (!record(value.value)) return { value, uncertain: true };
  const saved = path.startsWith("favorites-v1.");
  const field = saved ? "items" : "snapshots";
  const items = value.value[field];
  if (!Array.isArray(items)) return { value, uncertain: true };
  const cleaned = items.map((entry) => cleanResult(entry, saved));
  return {
    value: { ...value, value: { ...value.value, [field]: cleaned.map((entry) => entry.value), ...(saved ? {} : { selected: [], selection: [], selectionEntries: [] }) } },
    uncertain: value.value.schemaVersion !== 1 || cleaned.some((entry) => entry.uncertain),
  };
}

export class ProviderConfigurationFiles implements FileStore {
  readonly #inner: FileStore;
  readonly #problems = new Map<string, string>();
  #queue: Promise<unknown> = Promise.resolve();

  constructor(inner: FileStore) { this.#inner = inner; }
  #queued<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(operation);
    this.#queue = next.catch(() => undefined);
    return next;
  }

  problems(): readonly string[] { return [...this.#problems.values()]; }

  async list(): Promise<string[]> {
    if (!this.#inner.list) throw new Error("Stored result copies could not be inspected on this device.");
    return this.#inner.list();
  }

  /** Inspect only names allocated by this app, never sample/ or unrelated device files. */
  async sweep(): Promise<void> {
    let paths = KNOWN_FILES;
    try {
      paths = [...new Set([...paths, ...(await this.list()).filter(known)])];
      this.#problems.delete("listing");
    } catch (error) {
      this.#problems.set("listing", errorText(error));
    }
    for (const path of paths) {
      try { await this.read(path); } catch { /* read records the precise failure */ }
    }
  }

  async read(path: string): Promise<string | null> {
    if (!known(path)) return this.#inner.read(path);
    return this.#queued(() => this.#readKnown(path));
  }

  async #readKnown(path: string): Promise<string | null> {
    try {
      const raw = await this.#inner.read(path);
      if (raw === null) { this.#problems.delete(path); return null; }
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { throw new Error(`${path} is damaged; its user configuration cannot be separated safely from stored results.`); }
      const result = clean(path, parsed);
      const text = JSON.stringify(result.value);
      if (text !== raw) {
        try { await this.#writeChecked(path, text); }
        catch (error) {
          this.#problems.set(path, `${path}: ${errorText(error)}`);
          // A failed disk cleanup is reported; its old response is still never restored into memory.
          return text;
        }
      }
      if (result.uncertain) this.#problems.set(path, `${path} has an unknown format; removal of all stored results cannot be verified.`);
      else this.#problems.delete(path);
      return text;
    } catch (error) {
      this.#problems.set(path, `${path}: ${errorText(error)}`);
      throw error;
    }
  }

  write(path: string, data: string): Promise<void> {
    if (!known(path)) return this.#inner.write(path, data);
    return this.#queued(async () => {
      try {
        const existing = await this.#inner.read(path);
        if (existing !== null) {
          let parsed: unknown;
          try { parsed = JSON.parse(existing); }
          catch { throw new Error(`${path} is damaged; its user configuration is preserved and cannot be replaced by this save.`); }
          if (clean(path, parsed).uncertain) throw new Error(`${path} has an unknown format; its user configuration is preserved and cannot be replaced by this save.`);
        }
        const result = clean(path, JSON.parse(data));
        // A raw damaged backup is never duplicated; the original remains held and the problem stays visible.
        if (result.uncertain) throw new Error(`${path} has an unknown format; its user configuration is preserved and result cleanup needs attention.`);
        await this.#writeChecked(path, JSON.stringify(result.value));
        this.#problems.delete(path);
      } catch (error) {
        this.#problems.set(path, `${path}: ${errorText(error)}`);
        throw error;
      }
    });
  }

  async #writeChecked(path: string, text: string): Promise<void> {
    await this.#inner.write(path, text);
    if (await this.#inner.read(path) !== text) throw new Error(`${path} could not be verified after saving.`);
  }

  async remove(path: string): Promise<void> {
    return this.#queued(() => this.#remove(path));
  }
  async #remove(path: string): Promise<void> {
    try {
      if (known(path)) {
        const raw = await this.#inner.read(path);
        if (raw !== null && clean(path, JSON.parse(raw)).uncertain) throw new Error(`${path} has an unknown format; its user configuration cannot be removed safely.`);
      }
      await this.#inner.remove(path);
      if (known(path) && await this.#inner.read(path) !== null) throw new Error(`${path} could not be removed.`);
      this.#problems.delete(path);
    } catch (error) {
      this.#problems.set(path, `${path}: ${errorText(error)}`);
      throw error;
    }
  }
}
