/**
 * The worker's heartbeat (UI/UX v1 T20; A33): the one way the web server learns that scheduled checks are configured
 * and how the last one went. The worker is a separate process; the only things the two share are the database file's
 * directory and its environment. After every tick the worker writes a small JSON file beside the database (never into
 * it: no schema change), and the /queries page reads it.
 *
 * No file means no worker has ever ticked against this database: scheduled checks are not confirmed, and the page
 * says so ("watch.unavailable") rather than promising a schedule nobody runs. A file says when the last tick finished
 * and whether it failed; its age is judged by the reader (core runHealth), so a worker that stopped reads as stale.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveDbPath } from "@/lib/db/client";

export interface WorkerHeartbeat {
  version: 1;
  /** When the tick finished, ISO. */
  tickAt: string;
  /** False when the tick threw, or any due query's run failed to be recorded. */
  ok: boolean;
  /** The worker's delivery: a real Telegram bot, or the mock that only logs. */
  transport: "telegram" | "mock";
}

/** Beside the database the worker and the web server share; null for an in-memory database (tests). */
export function heartbeatPath(databasePath?: string): string | null {
  const db = resolveDbPath(databasePath);
  if (db === ":memory:" || db.startsWith("file::memory:")) return null;
  return `${path.resolve(db)}.worker-heartbeat.json`;
}

/** Written atomically (a temporary file renamed over), so a reader never sees half of it. Never throws. */
export function writeHeartbeat(file: string, beat: Omit<WorkerHeartbeat, "version">): boolean {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, ...beat }), { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

/** The last heartbeat, or null when there is none or it cannot be read as one. Never throws. */
export function readHeartbeat(file: string | null): WorkerHeartbeat | null {
  if (!file) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const beat = raw as Record<string, unknown>;
  if (beat.version !== 1 || typeof beat.tickAt !== "string" || !Number.isFinite(Date.parse(beat.tickAt))) return null;
  if (typeof beat.ok !== "boolean" || (beat.transport !== "telegram" && beat.transport !== "mock")) return null;
  return { version: 1, tickAt: beat.tickAt, ok: beat.ok, transport: beat.transport };
}
