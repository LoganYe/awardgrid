/**
 * SQLite via better-sqlite3 + Drizzle. One file, volume-mounted (kickoff §2).
 * WAL mode + foreign keys on. Migrations are the SQL files drizzle-kit generated in ./drizzle.
 */
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import path from "node:path";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

export interface OpenDbOptions {
  /** File path or ":memory:" (tests). Defaults to env DATABASE_PATH or ./data/runtime/awardgrid.db */
  path?: string;
  /** Run pending migrations on open (default true). */
  migrate?: boolean;
  /** Folder with drizzle-kit SQL migrations (default <repo>/drizzle). */
  migrationsFolder?: string;
}

export const DEFAULT_DB_PATH = "./data/runtime/awardgrid.db";

export function resolveDbPath(p?: string): string {
  return p ?? process.env.DATABASE_PATH ?? DEFAULT_DB_PATH;
}

export function openDb(opts: OpenDbOptions = {}): Db {
  const file = resolveDbPath(opts.path);
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });
  if (opts.migrate !== false) {
    migrate(db, { migrationsFolder: opts.migrationsFolder ?? path.resolve(process.cwd(), "drizzle") });
  }
  return db;
}

/** In-memory database with the full schema applied — for tests. */
export function openTestDb(migrationsFolder?: string): Db {
  return openDb({ path: ":memory:", migrationsFolder });
}

let singleton: Db | null = null;
/** Process-wide handle for the Next.js app and worker (lazy). */
export function getDb(): Db {
  if (!singleton) singleton = openDb();
  return singleton;
}
