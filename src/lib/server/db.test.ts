/**
 * The web server's first database open (src/lib/server/db.ts): the short-term caching sweep, and with Login with
 * Seats.aero paused (SEATS_OAUTH_WEB=off, src/lib/seats-oauth/pause.ts) the pause's purge, before anything reads the
 * database. Each test loads the module afresh: the sweep starts once per process. In-memory SQLite (a file in a temp
 * directory where a second connection has to hold a lock), no network.
 */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, openTestDb, type Db } from "@/lib/db/client";
import { availabilityCache, seatsConnections, seatsOauthStates } from "@/lib/db/schema";
import { seedUsers } from "@/lib/db/stores/testing";
import { beginConnect } from "@/lib/seats-oauth/state";
import { connectForTests } from "@/lib/seats-oauth/testing";

const MASTER = Buffer.alloc(32, 3);
const ACCESS = "seats:ota:db-test-access_SECRET";

let db: Db;

function seed(): void {
  db = openTestDb();
  seedUsers(db, ["alice"]);
  connectForTests(db, "alice", { masterKey: MASTER, access: ACCESS });
  beginConnect(db, "alice");
  const now = new Date().toISOString();
  db.insert(availabilityCache)
    .values({ userId: "alice", program: "alaska", origin: "HKG", dest: "SEA", date: "2026-10-20", cabin: "J", miles: 1, computedLastSeen: now, sourceId: "s", fetchedAt: now })
    .run();
}

/** drizzle's better-sqlite3 handle carries its connection as $client; the repo's Db alias does not declare it. */
function sqliteOf(d: Db): Database.Database {
  return (d as Db & { $client: Database.Database }).$client;
}

async function freshModule() {
  vi.resetModules();
  const mod = await import("./db");
  // A new process, as far as the module can tell: the line of the first purge is written once per process.
  delete (globalThis as Record<symbol, unknown>)[mod.PAUSE_PURGE_LOGGED];
  return mod;
}

beforeEach(seed);

afterEach(() => {
  delete process.env.SEATS_OAUTH_WEB;
  vi.restoreAllMocks();
});

describe("startRetentionSweep", () => {
  it("switch on: an hour-old result and a connection stay (only what is 24 hours old goes)", async () => {
    const { startRetentionSweep } = await freshModule();
    startRetentionSweep(db, 60_000);
    expect(db.select().from(seatsConnections).all()).toHaveLength(1);
    expect(db.select().from(availabilityCache).all()).toHaveLength(1);
  });

  it("SEATS_OAUTH_WEB=off: every token, sign-in under way and result goes at once; the log line is counts only", async () => {
    process.env.SEATS_OAUTH_WEB = "off";
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { startRetentionSweep } = await freshModule();
    startRetentionSweep(db, 60_000);
    expect(db.select().from(seatsConnections).all()).toEqual([]);
    expect(db.select().from(seatsOauthStates).all()).toEqual([]);
    expect(db.select().from(availabilityCache).all()).toEqual([]);
    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0]![0]);
    expect(line).toBe('[seats-oauth] paused: purged {"connections":1,"states":1,"rows":1,"coverage":0,"routes":0,"runs":0}');
    expect(line).not.toContain(ACCESS);
  });

  it("SEATS_OAUTH_WEB=off: a connection written later (another process) goes on the next sweep", async () => {
    process.env.SEATS_OAUTH_WEB = "off";
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      const { startRetentionSweep } = await freshModule();
      startRetentionSweep(db, 60_000);
      connectForTests(db, "alice", { masterKey: MASTER, access: ACCESS });
      expect(db.select().from(seatsConnections).all()).toHaveLength(1);
      vi.advanceTimersByTime(60_000);
      expect(db.select().from(seatsConnections).all()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("SEATS_OAUTH_WEB=off with nothing stored: the first purge logs its counts all the same, so the log shows the switch took effect", async () => {
    db = openTestDb();
    process.env.SEATS_OAUTH_WEB = "off";
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      const { startRetentionSweep } = await freshModule();
      startRetentionSweep(db, 60_000);
      expect(info.mock.calls).toEqual([['[seats-oauth] paused: purged {"connections":0,"states":0,"rows":0,"coverage":0,"routes":0,"runs":0}']]);
      // Later purges with nothing to do say nothing: the next request, the next sweep.
      startRetentionSweep(db, 60_000);
      vi.advanceTimersByTime(60_000);
      expect(info).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("SEATS_OAUTH_WEB=off: the app's copy of the module, after src/instrumentation.ts's, purges again but writes no second line of zeros", async () => {
    db = openTestDb();
    process.env.SEATS_OAUTH_WEB = "off";
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const startup = await freshModule();
    startup.startRetentionSweep(db, 60_000);
    vi.resetModules();
    const app = await import("./db");
    app.startRetentionSweep(openTestDb(), 60_000);
    expect(info).toHaveBeenCalledTimes(1);
  });

  it("a value the switch does not know pauses too", async () => {
    process.env.SEATS_OAUTH_WEB = "disabled";
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { startRetentionSweep } = await freshModule();
    startRetentionSweep(db, 60_000);
    expect(db.select().from(seatsConnections).all()).toEqual([]);
    expect(db.select().from(availabilityCache).all()).toEqual([]);
  });

  it("SEATS_OAUTH_WEB=off: a purge that fails (the database busy) is logged as the pause's and tried again on the next request, not 10 minutes later", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "awardgrid-server-db-"));
    const file = path.join(root, "awardgrid.db");
    const fileDb = openDb({ path: file });
    const other = new Database(file);
    vi.useFakeTimers();
    try {
      seedUsers(fileDb, ["alice"]);
      connectForTests(fileDb, "alice", { masterKey: MASTER, access: ACCESS });
      sqliteOf(fileDb).pragma("busy_timeout = 0");
      process.env.SEATS_OAUTH_WEB = "off";
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const info = vi.spyOn(console, "info").mockImplementation(() => {});
      const { startRetentionSweep } = await freshModule();

      // Another process is writing: the startup purge cannot.
      other.exec("BEGIN IMMEDIATE");
      startRetentionSweep(fileDb, 10 * 60_000);
      expect(error.mock.calls).toContainEqual(["[seats-oauth] paused: purge failed:", "SqliteError"]);
      expect(info).not.toHaveBeenCalled();
      expect(fileDb.select().from(seatsConnections).all()).toHaveLength(1);

      // The next getServerDb() tries again.
      other.exec("ROLLBACK");
      startRetentionSweep(fileDb, 10 * 60_000);
      expect(fileDb.select().from(seatsConnections).all()).toEqual([]);
      expect(info.mock.calls).toEqual([['[seats-oauth] paused: purged {"connections":1,"states":0,"rows":0,"coverage":0,"routes":0,"runs":0}']]);
      expect(JSON.stringify(error.mock.calls)).not.toContain(ACCESS);
    } finally {
      vi.useRealTimers();
      other.close();
      sqliteOf(fileDb).close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
