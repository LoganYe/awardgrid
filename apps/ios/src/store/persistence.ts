/**
 * The JSON snapshot on disk (docs/PIVOT.md §6 Phase 2: "in-memory cache with a JSON snapshot.
 * Device SQLite can wait for watches").
 *
 * Two files under the app's Data directory — not `localStorage`, which the WebView may evict under
 * storage pressure, and not Preferences, which is a plist meant for small settings:
 *
 *   cache.json  — availability rows + coverage. Hundreds of KB. Losing it costs one cold search.
 *   quota.json  — today's call count. Tiny, but the one file whose loss actually costs the user
 *                 something, because a forgotten count means the app offers headroom that
 *                 seats.aero will not honour. (Mitigated by the X-RateLimit-Remaining rule in
 *                 `quota-store.ts`, which re-anchors the count from the first response.)
 *
 * Every read is best-effort by design. A corrupt or truncated snapshot must degrade to a cold
 * start, never to a crash on launch: the cache is an optimisation, and treating it as load-bearing
 * would turn a bad write into a bricked app.
 */
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import type { CacheSnapshot } from "@awardgrid/core/seatsaero/cache";
import type { QuotaSnapshot } from "./quota-store";

export const CACHE_FILE = "cache.json";
export const QUOTA_FILE = "quota.json";

/** The filesystem surface used here, so tests need no device. */
export interface FileStore {
  read(path: string): Promise<string | null>;
  write(path: string, data: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export const capacitorFiles: FileStore = {
  async read(path) {
    try {
      const res = await Filesystem.readFile({ path, directory: Directory.Data, encoding: Encoding.UTF8 });
      return typeof res.data === "string" ? res.data : null;
    } catch {
      return null; // absent is the normal first-run case
    }
  },
  async write(path, data) {
    await Filesystem.writeFile({ path, directory: Directory.Data, encoding: Encoding.UTF8, data, recursive: true });
  },
  async remove(path) {
    try {
      await Filesystem.deleteFile({ path, directory: Directory.Data });
    } catch {
      // Already gone.
    }
  },
};

export class MemoryFileStore implements FileStore {
  readonly files = new Map<string, string>();
  async read(path: string) {
    return this.files.get(path) ?? null;
  }
  async write(path: string, data: string) {
    this.files.set(path, data);
  }
  async remove(path: string) {
    this.files.delete(path);
  }
}

/** Parse JSON without ever throwing at the caller. A bad snapshot is a cold start, not a crash. */
function parse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * watches.json — the user's watches and their baselines. Unlike the cache this is the user's own
 * data, not a copy of seats.aero's, so nothing that "clears cached results" may remove it.
 */
export const WATCHES_FILE = "watches.json";

type WatchSnapshot = import("./watch-store").WatchSnapshot;

export class SnapshotStore {
  readonly #files: FileStore;

  constructor(files: FileStore = capacitorFiles) {
    this.#files = files;
  }

  async loadCache(): Promise<CacheSnapshot | null> {
    return parse<CacheSnapshot>(await this.#files.read(CACHE_FILE));
  }

  async saveCache(snapshot: CacheSnapshot): Promise<void> {
    await this.#files.write(CACHE_FILE, JSON.stringify(snapshot));
  }

  async loadQuota(): Promise<QuotaSnapshot | null> {
    return parse<QuotaSnapshot>(await this.#files.read(QUOTA_FILE));
  }

  async saveQuota(snapshot: QuotaSnapshot): Promise<void> {
    await this.#files.write(QUOTA_FILE, JSON.stringify(snapshot));
  }

  async loadWatches(): Promise<WatchSnapshot | null> {
    return parse<WatchSnapshot>(await this.#files.read(WATCHES_FILE));
  }

  async saveWatches(snapshot: WatchSnapshot): Promise<void> {
    await this.#files.write(WATCHES_FILE, JSON.stringify(snapshot));
  }

  /**
   * The file half of "Clear cached results" in Settings. It removes the availability cache and
   * NOTHING else — which is a correction, not the original behaviour.
   *
   * Phase 2 shipped this as `clearAll()`, removing cache.json AND quota.json. Two things were wrong
   * with that. Forgetting the quota counter meant clearing cached results silently forgot calls
   * already spent today, while the confirmation told the user only that results were cleared. And
   * removing a file was never enough on its own: the in-memory cache still held every row, and the
   * next `persist()` — which runs after every search — wrote them straight back. So the claim
   * "Cached results cleared" stopped being true within one search. `AppServices.clearCache` now
   * empties the in-memory cache first and then calls this.
   *
   * Quota survives, watches survive, and the Keychain is never touched.
   */
  async clearCache(): Promise<void> {
    await this.#files.remove(CACHE_FILE);
  }
}
