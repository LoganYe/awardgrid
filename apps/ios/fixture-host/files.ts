/**
 * TEST-ONLY: the file store the fixture host gives bootstrap() in place of Capacitor Filesystem.
 *
 * Backed by the host page's localStorage under one namespace, so a test can relaunch the app and see what it
 * saved (preserveStorage). The namespace is emptied at every launch unless the test asked to keep it; nothing
 * outside the namespace is touched. Every mutation (write or remove) is counted; contents are never logged.
 */
import type { FileStore } from "../src/store/persistence";
import type { FixtureRequestLog } from "./protocol";

export const FILES_NAMESPACE = "uiux-fixture:files:";

export class FixtureWriteFailedError extends Error {
  constructor(path: string) {
    super(`The fixture file store refused a write to ${path} (storage-failure scenario).`);
    this.name = "FixtureWriteFailedError";
  }
}

export class LocalFixtureFiles implements FileStore {
  readonly #log: FixtureRequestLog;
  readonly #failWrites: boolean;

  constructor(log: FixtureRequestLog, opts: { preserve: boolean; seed: Record<string, string>; failWrites: boolean }) {
    this.#log = log;
    this.#failWrites = opts.failWrites;
    if (!opts.preserve) {
      for (const key of Object.keys(localStorage)) if (key.startsWith(FILES_NAMESPACE)) localStorage.removeItem(key);
    }
    // Seeded files stand for what was on disk before this launch, so seeding is not counted as the app's write.
    for (const [path, data] of Object.entries(opts.seed)) localStorage.setItem(FILES_NAMESPACE + path, data);
  }

  async read(path: string): Promise<string | null> {
    return localStorage.getItem(FILES_NAMESPACE + path);
  }

  async write(path: string, data: string): Promise<void> {
    this.#log.writes += 1;
    if (this.#failWrites) throw new FixtureWriteFailedError(path);
    localStorage.setItem(FILES_NAMESPACE + path, data);
  }

  async remove(path: string): Promise<void> {
    this.#log.writes += 1;
    if (this.#failWrites) throw new FixtureWriteFailedError(path);
    localStorage.removeItem(FILES_NAMESPACE + path);
  }
}
