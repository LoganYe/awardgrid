/**
 * The web server's first database open (src/lib/server/db.ts): the short-term caching sweep, and with Login with
 * Seats.aero paused (SEATS_OAUTH_WEB=off, src/lib/seats-oauth/pause.ts) the pause's purge, before anything reads the
 * database. Each test loads the module afresh: the sweep starts once per process. In-memory SQLite, no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openTestDb, type Db } from "@/lib/db/client";
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

async function freshModule() {
  vi.resetModules();
  return import("./db");
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
});
