/**
 * A tiny JSON-file RoutesStore for the CLI, so the 7-day Get Routes cache (routes.ts) survives
 * between `pnpm run find` invocations. Without it every run that hits an empty pair re-spends
 * up to 26 calls on route lists that rarely change.
 *
 * Layout: `{ "<userId>": { "<source>": { routes, fetched_at } } }`. The CLI's userId is a hash of
 * the key (see cliUserId), so two keys on one machine never share entries (§12 cache scope).
 * Route lists are public catalogue data — no key material is ever written.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { RoutesEntry, RoutesStore } from "@awardgrid/core/seatsaero/routes";

export interface FileRoutesStoreOptions {
  path: string;
  readFile?: (path: string) => Promise<string>;
  writeFile?: (path: string, content: string) => Promise<void>;
  mkdir?: (dir: string) => Promise<void>;
}

type FileShape = Record<string, Record<string, RoutesEntry>>;

/** The CLI "user": one per seats.aero key, derived without storing the key anywhere. */
export function cliUserId(apiKey: string): string {
  return `cli:${createHash("sha256").update(apiKey).digest("hex").slice(0, 16)}`;
}

/** `$AWARDGRID_CACHE_DIR` › `$XDG_CACHE_HOME/awardgrid` › `~/.cache/awardgrid`. */
export function defaultRoutesCachePath(env: Record<string, string | undefined>): string {
  const dir = env.AWARDGRID_CACHE_DIR ?? (env.XDG_CACHE_HOME ? join(env.XDG_CACHE_HOME, "awardgrid") : join(homedir(), ".cache", "awardgrid"));
  return join(dir, "routes.json");
}

export class FileRoutesStore implements RoutesStore {
  readonly #path: string;
  readonly #read: (path: string) => Promise<string>;
  readonly #write: (path: string, content: string) => Promise<void>;
  readonly #mkdir: (dir: string) => Promise<void>;
  #data: FileShape | null = null;

  constructor(opts: FileRoutesStoreOptions) {
    this.#path = opts.path;
    this.#read = opts.readFile ?? ((p) => readFile(p, "utf8"));
    this.#write = opts.writeFile ?? ((p, c) => writeFile(p, c, "utf8"));
    this.#mkdir = opts.mkdir ?? (async (d) => void (await mkdir(d, { recursive: true })));
  }

  async get(userId: string, source: string): Promise<RoutesEntry | null> {
    const data = await this.#load();
    const entry = data[userId]?.[source];
    return entry ? { routes: [...entry.routes], fetched_at: entry.fetched_at } : null;
  }

  async put(userId: string, source: string, entry: RoutesEntry): Promise<void> {
    const data = await this.#load();
    const perUser = data[userId] ?? {};
    perUser[source] = { routes: [...entry.routes], fetched_at: entry.fetched_at };
    data[userId] = perUser;
    await this.#mkdir(dirname(this.#path));
    await this.#write(this.#path, JSON.stringify(data));
  }

  /** A missing or corrupt file is an empty cache, never an error: this is only an optimisation. */
  async #load(): Promise<FileShape> {
    if (this.#data) return this.#data;
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(await this.#read(this.#path));
    } catch {
      parsed = null;
    }
    this.#data = isFileShape(parsed) ? parsed : {};
    return this.#data;
  }
}

function isFileShape(v: unknown): v is FileShape {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  return Object.values(v).every(
    (perUser) =>
      typeof perUser === "object" &&
      perUser !== null &&
      Object.values(perUser as Record<string, unknown>).every(
        (e) => typeof e === "object" && e !== null && Array.isArray((e as RoutesEntry).routes) && typeof (e as RoutesEntry).fetched_at === "string",
      ),
  );
}
