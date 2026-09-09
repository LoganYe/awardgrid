/**
 * Kickoff §9 Phase-3 self-acceptance, end to end through the real worker wiring
 * (`startWorker` → node-cron seam → `tick` → `runSavedQuery` → findGridForUser with the
 * owner's own key → diff → notify's formatDigest → MockTransport):
 *
 *   t0        both saved queries fire (baseline, `first_run`), nothing is sent
 *   t0 + 3 h  one NEW fixture cell exists for user A ONLY → exactly one message, to A's chat,
 *             naming that cell; B gets nothing; both query_runs rows carry the notified flag
 *   t0 + 4 h  nothing is due (every 3 h) → no run rows, no messages
 *   quota     B's daily quota exhausted → B's run is recorded `quota`, no upstream call, no message
 *
 * No network (fake fetch over the synthetic fixture, keyed by the Partner-Authorization header
 * so A and B see different upstreams), no env keys (test MASTER_KEY passed in), fake clock,
 * a manual scheduler in place of node-cron. Every log line is asserted free of keys and chat ids.
 */
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MASTER_TICK_CRON, MASTER_TICK_NAME, startWorker, type ScheduleFn } from "@/cli/worker-main";
import { openTestDb, type Db } from "@/lib/db/client";
import { apiUsage, queryRuns, savedQueries, users, type SavedQuery } from "@/lib/db/schema";
import { seedUsers } from "@/lib/db/stores/testing";
import { setKey } from "@/lib/keys";
import { MockTransport } from "@/lib/notify";
import { QueryObject } from "@awardgrid/core/query/schema";
import { DEFAULT_CRON } from "@/lib/scheduler";
import type { Availability, Route, SearchResponse } from "@awardgrid/core/seatsaero/types";
import { SYNTHETIC_ORIGINS, SYNTHETIC_PROGRAMS } from "@awardgrid/core/test-fixtures/seatsaero/generate-synthetic";
import { fakeFetch, jsonResponse, loadFixture, textResponse } from "@awardgrid/core/test-fixtures/seatsaero/helpers";

const MASTER_HEX = "0f".repeat(32);
const ALICE_KEY = "alice_pro_key_SECRET_a1b2c3";
const BOB_KEY = "bob_pro_key_SECRET_z9y8x7";
const ALICE_CHAT = "100200300";
const BOB_CHAT = "400500600";
const T0 = new Date("2026-10-01T12:00:00Z");
const H = 60 * 60 * 1000;

/** The synthetic fixture has no american/HKG/SEA/2026-10-10 cell; this adds one (F, 62k). */
function extraCell(): Availability {
  const base = loadFixture<SearchResponse>("synthetic-example-query.json").data[0]!;
  return { ...base, ID: "NEWCELL0000000000000000000", Date: "2026-10-10", ParsedDate: "2026-10-10T00:00:00Z" };
}

const QUERY = QueryObject.parse({
  origins: [...SYNTHETIC_ORIGINS],
  destinations: ["SEA"],
  date_from: "2026-10-01",
  date_to: "2026-10-30",
  cabins: ["J", "F"],
  programs: [...SYNTHETIC_PROGRAMS],
  raw_text: "harness",
  language: "en",
});

function syntheticRoutes(source: string): Route[] {
  return SYNTHETIC_ORIGINS.filter((o) => o !== "GMP").map((o) => ({
    ID: `${source}-${o}`,
    OriginAirport: o,
    OriginRegion: "Asia",
    DestinationAirport: "SEA",
    DestinationRegion: "North America",
    NumDaysOut: 330,
    Distance: 5000,
    Source: source,
  }));
}

function saveQuery(db: Db, userId: string, over: Partial<SavedQuery> = {}): SavedQuery {
  const row: SavedQuery = {
    id: randomUUID(),
    userId,
    name: `${userId} Asia → SEA`,
    queryJson: JSON.stringify(QUERY),
    scheduleCron: DEFAULT_CRON,
    notifyOn: "both",
    dropThresholdPct: 10,
    enabled: true,
    createdAt: T0.toISOString(),
    lastRunAt: null,
    ...over,
  };
  db.insert(savedQueries).values(row).run();
  return row;
}

function runsFor(db: Db, savedQueryId: string) {
  return db.select().from(queryRuns).where(eq(queryRuns.savedQueryId, savedQueryId)).orderBy(queryRuns.ranAt).all();
}

async function harness() {
  const db = openTestDb();
  seedUsers(db, ["alice", "bob"]);
  db.update(users).set({ telegramChatId: ALICE_CHAT }).where(eq(users.id, "alice")).run();
  db.update(users).set({ telegramChatId: BOB_CHAT, locale: "zh", timezone: "Asia/Shanghai" }).where(eq(users.id, "bob")).run();
  const master = Buffer.from(MASTER_HEX, "hex");
  setKey(db, "alice", "seats_aero", ALICE_KEY, { masterKey: master, now: T0 });
  setKey(db, "bob", "seats_aero", BOB_KEY, { masterKey: master, now: T0 });
  const a = saveQuery(db, "alice");
  const b = saveQuery(db, "bob");

  const fixture = loadFixture<SearchResponse>("synthetic-example-query.json");
  /** Cells only the request signed with this key can see. */
  const extraFor = new Map<string, Availability[]>();
  const fetch = fakeFetch((req) => {
    if (req.url.pathname === "/partnerapi/search") {
      const extra = extraFor.get(req.headers["partner-authorization"] ?? "") ?? [];
      return jsonResponse({ ...fixture, data: [...fixture.data, ...extra] });
    }
    if (req.url.pathname === "/partnerapi/routes") return jsonResponse(syntheticRoutes(req.url.searchParams.get("source")!));
    return textResponse("not found", 404);
  });

  const clock = { now: T0 };
  const transport = new MockTransport({ now: () => clock.now });
  const logs: { event: string; fields: Record<string, unknown> }[] = [];
  const scheduled: { expression: string; options: Record<string, unknown> }[] = [];
  const schedule: ScheduleFn = (expression, _fn, options) => {
    scheduled.push({ expression, options: { ...options } });
    return { stop: () => {}, destroy: () => {} };
  };
  const worker = await startWorker({
    env: { MASTER_KEY: MASTER_HEX, APP_URL: "https://awardgrid.test/" },
    db,
    fetch,
    now: () => clock.now,
    transport,
    schedule,
    tickOnStart: false,
    log: (event, fields = {}) => logs.push({ event, fields }),
  });
  const tickAt = async (t: Date) => {
    clock.now = t;
    return (await worker.tickOnce())!;
  };
  return { db, a, b, fetch, extraFor, clock, transport, logs, scheduled, worker, tickAt };
}

function callsSignedWith(fetch: ReturnType<typeof fakeFetch>, key: string): number {
  return fetch.calls.filter((c) => c.url.pathname === "/partnerapi/search" && c.headers["partner-authorization"] === key).length;
}

describe("scheduler harness (kickoff §9 Phase 3)", () => {
  it("registers one master tick (every minute, UTC, noOverlap) and logs the mock transport", async () => {
    const { scheduled, logs, worker } = await harness();
    expect(scheduled).toEqual([{ expression: MASTER_TICK_CRON, options: { name: MASTER_TICK_NAME, timezone: "UTC", noOverlap: true } }]);
    expect(worker.transportKind).toBe("mock");
    expect(logs.find((l) => l.event === "worker.transport")?.fields).toMatchObject({ kind: "mock", message: "mock transport" });
    await worker.stop();
    expect(logs.at(-1)?.event).toBe("worker.stopped");
  });

  it("fires on schedule; ONE new cell for A → exactly one message to A's chat; B gets none; nothing due at t0+4h", async () => {
    const { db, a, b, fetch, extraFor, transport, logs, worker, tickAt } = await harness();

    // t0: both due (never ran) → baseline runs, nothing sent.
    const t1 = await tickAt(T0);
    expect(t1).toMatchObject({ considered: 2, due: 2, notified: 0, skipped: 2 });
    expect(t1.results.map((r) => [r.savedQueryId, r.skippedReason])).toEqual([
      [a.id, "first_run"],
      [b.id, "first_run"],
    ]);
    expect(transport.sent).toHaveLength(0);
    expect(callsSignedWith(fetch, ALICE_KEY)).toBeGreaterThan(0);
    expect(callsSignedWith(fetch, BOB_KEY)).toBeGreaterThan(0);

    // t0 + 3h: one new fixture cell visible to A's key only.
    extraFor.set(ALICE_KEY, [extraCell()]);
    const t2 = await tickAt(new Date(T0.getTime() + 3 * H));
    expect(t2).toMatchObject({ considered: 2, due: 2, notified: 1 });
    const aRun = t2.results.find((r) => r.savedQueryId === a.id)!;
    const bRun = t2.results.find((r) => r.savedQueryId === b.id)!;
    expect(aRun).toMatchObject({ userId: "alice", notified: true, skippedReason: null, diff: { new: 1, dropped: 0, price_drops: 0 } });
    expect(bRun).toMatchObject({ userId: "bob", notified: false, skippedReason: null, diff: { new: 0, dropped: 0, price_drops: 0 } });

    // Exactly one message, to A's chat, naming the cell (notify's digest: "HKG→SEA 10-10 F 62k").
    expect(transport.sent).toHaveLength(1);
    expect(transport.forChat(BOB_CHAT)).toHaveLength(0);
    const [msg] = transport.forChat(ALICE_CHAT);
    expect(msg).toBeDefined();
    expect(msg!.html).toContain("HKG→SEA 10-10 F");
    expect(msg!.html).toContain("<b>62k</b>");
    expect(msg!.html).toContain("American");
    expect(msg!.html).toContain('<a href="https://awardgrid.test/grid?q=');
    expect(msg!.html).toContain("1 new");
    expect(msg!.html).not.toContain(ALICE_KEY);

    // query_runs rows recorded with the notified flags.
    expect(runsFor(db, a.id).map((r) => [r.notified, r.skippedReason, r.newCells])).toEqual([
      [false, "first_run", 0],
      [true, null, 1],
    ]);
    expect(runsFor(db, b.id).map((r) => [r.notified, r.skippedReason, r.newCells])).toEqual([
      [false, "first_run", 0],
      [false, null, 0],
    ]);
    expect(db.select().from(savedQueries).where(eq(savedQueries.id, a.id)).get()?.lastRunAt).toBe(new Date(T0.getTime() + 3 * H).toISOString());

    // t0 + 4h: neither is due (every 3 h) → no runs, no messages.
    const before = fetch.calls.length;
    const t3 = await tickAt(new Date(T0.getTime() + 4 * H));
    expect(t3).toMatchObject({ considered: 2, due: 0, notified: 0, skipped: 0, results: [] });
    expect(runsFor(db, a.id)).toHaveLength(2);
    expect(runsFor(db, b.id)).toHaveLength(2);
    expect(transport.sent).toHaveLength(1);
    expect(fetch.calls.length).toBe(before);

    // Each request carried only its owner's key; no log line carries a key or a chat id.
    for (const c of fetch.calls) {
      expect([ALICE_KEY, BOB_KEY]).toContain(c.headers["partner-authorization"]);
    }
    const logText = JSON.stringify(logs);
    for (const secret of [ALICE_KEY, BOB_KEY, ALICE_CHAT, BOB_CHAT, MASTER_HEX]) expect(logText).not.toContain(secret);
    expect(logs.filter((l) => l.event === "scheduler.tick")).toHaveLength(3);
    await worker.stop();
  });

  it("B's exhausted quota → B's run recorded 'quota' with no upstream call and no message; A unaffected", async () => {
    const { db, a, b, fetch, transport, logs, worker, tickAt } = await harness();
    await tickAt(T0);
    // The baseline run already wrote today's usage row for bob; push it to the soft limit.
    db.update(apiUsage).set({ calls: 950 }).where(and(eq(apiUsage.userId, "bob"), eq(apiUsage.day, "2026-10-01"))).run();
    expect(db.select().from(apiUsage).where(eq(apiUsage.userId, "bob")).all()).toHaveLength(1);
    const bobBefore = callsSignedWith(fetch, BOB_KEY);

    const t2 = await tickAt(new Date(T0.getTime() + 3 * H));
    expect(t2).toMatchObject({ due: 2, notified: 0, skipped: 1 });
    expect(t2.results.find((r) => r.savedQueryId === b.id)).toMatchObject({
      notified: false,
      skippedReason: "quota",
      cells: 0,
      apiCallsUsed: 0,
      error: { code: "quota" },
    });
    expect(t2.results.find((r) => r.savedQueryId === a.id)).toMatchObject({ notified: false, skippedReason: null });
    expect(callsSignedWith(fetch, BOB_KEY)).toBe(bobBefore);
    expect(runsFor(db, b.id).at(-1)).toMatchObject({ notified: false, skippedReason: "quota", cellsHash: "", cellsJson: "[]" });
    expect(transport.sent).toHaveLength(0);
    expect(JSON.stringify(logs)).not.toContain(BOB_CHAT);
    await worker.stop();
  });
});
