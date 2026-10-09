/**
 * runSavedQuery / tick / runNow over an in-memory SQLite: seeded users with encrypted keys, a
 * fake fetch over the synthetic fixture, a recording transport. No network, no env keys.
 * Kickoff §9 Phase 3 self-acceptance: fires on schedule; one new fixture cell → exactly one
 * message to the right user; run recorded; quiet hours; quota; no key; no key/message mixing.
 */
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openTestDb, type Db } from "@/lib/db/client";
import { apiUsage, queryRuns, savedQueries, users, type SavedQuery } from "@/lib/db/schema";
import { seedUsers } from "@/lib/db/stores/testing";
import { connectForTests } from "@/lib/seats-oauth/testing";
import { purgeSeatsDataForUser } from "@/lib/seats-oauth/retention";
import { MockTransport } from "@/lib/notify/mock";
import { QueryObject } from "@awardgrid/core/query/schema";
import type { Availability, Route, SearchResponse } from "@awardgrid/core/seatsaero/types";
import { fakeFetch, jsonResponse, loadFixture, textResponse } from "@awardgrid/core/test-fixtures/seatsaero/helpers";
import { SYNTHETIC_ORIGINS, SYNTHETIC_PROGRAMS } from "@awardgrid/core/test-fixtures/seatsaero/generate-synthetic";
import { DEFAULT_CRON } from "./cron";
import { claimRun, findBaseline, pruneQueryRuns, RUN_CLAIM_WINDOW_MS, runSavedQuery } from "./run";
import { runNow, tick } from "./tick";
import type { RunDeps, Transport } from "./types";

const MASTER = Buffer.from("0f".repeat(32), "hex");
const ALICE_KEY = "seats:ota:alice_pro_key_SECRET_a1b2c3";
const BOB_KEY = "seats:ota:bob_pro_key_SECRET_z9y8x7";
const ALICE_CHAT = "100200300";
const BOB_CHAT = "400500600";
const T0 = new Date("2026-10-01T12:00:00Z"); // 20:00 Asia/Shanghai
const H = 60 * 60 * 1000;
const APP_URL = "https://awardgrid.test/";

/** The synthetic fixture has no american/HKG/SEA/2026-10-10 cell; this adds one (F, 62k). */
const NEW_CELL_KEY = "american|HKG|SEA|2026-10-10|F";
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
  raw_text: "test",
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

interface Sent {
  chatId: string;
  text: string;
}

function recorder(opts: { fail?: boolean } = {}): Transport & { sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    async sendMessage(chatId, text) {
      if (opts.fail) throw new Error("boom");
      sent.push({ chatId, text });
      return { ok: true };
    },
  };
}

function harness() {
  const db: Db = openTestDb();
  seedUsers(db, ["alice", "bob", "carol"]);
  db.update(users).set({ telegramChatId: ALICE_CHAT, timezone: "Asia/Shanghai", locale: "zh" }).where(eq(users.id, "alice")).run();
  db.update(users).set({ telegramChatId: BOB_CHAT }).where(eq(users.id, "bob")).run();
  connectForTests(db, "alice", { masterKey: MASTER, access: ALICE_KEY, now: T0 });
  connectForTests(db, "bob", { masterKey: MASTER, access: BOB_KEY, now: T0 });
  // carol: chat linked, no key.
  db.update(users).set({ telegramChatId: "700800900" }).where(eq(users.id, "carol")).run();

  const fixture = loadFixture<SearchResponse>("synthetic-example-query.json");
  const state = { extra: [] as Availability[], upstreamStatus: 200 };
  const fetch = fakeFetch((req) => {
    if (req.url.pathname === "/partnerapi/search") {
      if (state.upstreamStatus !== 200) return textResponse("upstream sad", state.upstreamStatus);
      return jsonResponse({ ...fixture, data: [...fixture.data, ...state.extra] });
    }
    if (req.url.pathname === "/partnerapi/routes") return jsonResponse(syntheticRoutes(req.url.searchParams.get("source")!));
    return textResponse("not found", 404);
  });
  const transport = recorder();
  const logs: { event: string; fields: Record<string, unknown> }[] = [];
  const deps = (at: Date, over: Partial<RunDeps> = {}): RunDeps => ({
    now: () => at,
    fetch,
    transport,
    appUrl: APP_URL,
    masterKey: MASTER,
    log: (event, fields) => logs.push({ event, fields }),
    ...over,
  });
  return { db, fetch, state, transport, deps, logs };
}

function saveQuery(db: Db, userId: string, over: Partial<SavedQuery> = {}): SavedQuery {
  const row: SavedQuery = {
    id: randomUUID(),
    userId,
    name: `${userId}'s Asia → SEA`,
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

function reload(db: Db, id: string): SavedQuery {
  return db.select().from(savedQueries).where(eq(savedQueries.id, id)).get()!;
}

describe("runSavedQuery", () => {
  it("first run stores the baseline and notifies nothing; a later run with ONE new cell sends exactly one message to the owner's chat", async () => {
    const { db, fetch, state, transport, deps, logs } = harness();
    const sq = saveQuery(db, "alice");

    const first = await runSavedQuery(db, sq, deps(T0));
    expect(first).toMatchObject({ savedQueryId: sq.id, userId: "alice", notified: false, skippedReason: "first_run", diff: null, error: null, servedFromCache: false });
    expect(first.cells).toBeGreaterThan(0);
    expect(first.apiCallsUsed).toBe(1 + SYNTHETIC_PROGRAMS.length);
    expect(transport.sent).toEqual([]);
    const runs1 = runsFor(db, sq.id);
    expect(runs1).toHaveLength(1);
    expect(runs1[0]).toMatchObject({ id: first.runId, ranAt: T0.toISOString(), notified: false, skippedReason: "first_run", newCells: 0, droppedCells: 0 });
    // The stored row carries the same count the result reported — this is what the Queries page reads back.
    expect(runs1[0]!.callsUsed).toBe(first.apiCallsUsed);
    expect(runs1[0]!.cellsHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(runs1[0]!.cellsJson)).toHaveLength(first.cells);
    expect(reload(db, sq.id).lastRunAt).toBe(T0.toISOString());

    // Nothing changed → no message, clean run (skipped_reason null), still not notified.
    const same = await runSavedQuery(db, reload(db, sq.id), deps(new Date(T0.getTime() + 3 * H)));
    expect(same).toMatchObject({ notified: false, skippedReason: null, diff: { new: 0, dropped: 0, price_drops: 0 } });
    expect(same.diff!.unchanged).toBe(first.cells);
    expect(transport.sent).toEqual([]);

    // One new fixture cell (past the 45-min TTL, so a fresh fetch happens).
    state.extra = [extraCell()];
    const T2 = new Date(T0.getTime() + 6 * H);
    const third = await runSavedQuery(db, reload(db, sq.id), deps(T2));
    expect(third).toMatchObject({ notified: true, skippedReason: null, diff: { new: 1, dropped: 0, price_drops: 0 }, error: null });
    expect(third.cells).toBe(first.cells + 1);
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]!.chatId).toBe(ALICE_CHAT);
    expect(transport.sent[0]!.text).toContain("HKG→SEA 2026-10-10 F · american");
    expect(transport.sent[0]!.text).toContain("62,000 mi");
    expect(transport.sent[0]!.text).toContain(`<a href="${APP_URL.replace(/\/$/, "")}/grid?q=`);
    expect(transport.sent[0]!.text).toContain("打开表格"); // alice's locale is zh
    const runs3 = runsFor(db, sq.id);
    expect(runs3).toHaveLength(3);
    expect(runs3[2]).toMatchObject({ notified: true, skippedReason: null, newCells: 1, droppedCells: 0 });
    expect(JSON.parse(runs3[2]!.cellsJson).some((c: { key: string }) => c.key === NEW_CELL_KEY)).toBe(true);

    // Every upstream request carried alice's key; no key, chat id or message text reached the log.
    expect(fetch.calls.every((c) => c.headers["partner-authorization"] === `Bearer ${ALICE_KEY}`)).toBe(true);
    const logText = JSON.stringify(logs);
    expect(logText).not.toContain(ALICE_KEY);
    expect(logText).not.toContain(ALICE_CHAT);
    expect(logs.filter((l) => l.event === "scheduler.run")).toHaveLength(3);

    // A fourth run with nothing new since the notified baseline sends nothing.
    const fourth = await runSavedQuery(db, reload(db, sq.id), deps(new Date(T0.getTime() + 9 * H)));
    expect(fourth).toMatchObject({ notified: false, skippedReason: null, diff: { new: 0 } });
    expect(transport.sent).toHaveLength(1);
  });

  it("dropped cells are recorded but do not notify; a removed-then-returned cell is new again", async () => {
    const { db, state, transport, deps } = harness();
    const sq = saveQuery(db, "alice");
    state.extra = [extraCell()];
    await runSavedQuery(db, sq, deps(T0));
    state.extra = [];
    const gone = await runSavedQuery(db, reload(db, sq.id), deps(new Date(T0.getTime() + 3 * H)));
    expect(gone).toMatchObject({ notified: false, skippedReason: null, diff: { new: 0, dropped: 1 } });
    expect(runsFor(db, sq.id)[1]!.droppedCells).toBe(1);
    expect(transport.sent).toEqual([]);
    state.extra = [extraCell()];
    const back = await runSavedQuery(db, reload(db, sq.id), deps(new Date(T0.getTime() + 6 * H)));
    expect(back).toMatchObject({ notified: true, diff: { new: 1 } });
    expect(transport.sent).toHaveLength(1);
  });

  it("quiet hours: no message, run recorded as quiet_hours, and the next run outside quiet hours sends the accumulated change", async () => {
    const { db, state, transport, deps } = harness();
    db.update(users).set({ quietHoursStart: "22:00", quietHoursEnd: "07:00" }).where(eq(users.id, "alice")).run();
    const sq = saveQuery(db, "alice");
    await runSavedQuery(db, sq, deps(T0)); // 20:00 local — baseline

    state.extra = [extraCell()];
    const quiet = await runSavedQuery(db, reload(db, sq.id), deps(new Date("2026-10-01T15:00:00Z"))); // 23:00 local
    expect(quiet).toMatchObject({ notified: false, skippedReason: "quiet_hours", diff: { new: 1 } });
    expect(transport.sent).toEqual([]);
    expect(runsFor(db, sq.id)[1]).toMatchObject({ notified: false, skippedReason: "quiet_hours", newCells: 1 });

    const stillQuiet = await runSavedQuery(db, reload(db, sq.id), deps(new Date("2026-10-01T18:00:00Z"))); // 02:00 local
    expect(stillQuiet).toMatchObject({ notified: false, skippedReason: "quiet_hours", diff: { new: 1 } });
    expect(transport.sent).toEqual([]);

    const morning = await runSavedQuery(db, reload(db, sq.id), deps(new Date("2026-10-02T00:00:00Z"))); // 08:00 local
    expect(morning).toMatchObject({ notified: true, skippedReason: null, diff: { new: 1 } });
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]!.chatId).toBe(ALICE_CHAT);
    expect(transport.sent[0]!.text).toContain("2026-10-10");
  });

  it("no telegram chat: the run is stored with no_telegram and nothing is sent", async () => {
    const { db, state, transport, deps } = harness();
    db.update(users).set({ telegramChatId: null }).where(eq(users.id, "alice")).run();
    const sq = saveQuery(db, "alice");
    await runSavedQuery(db, sq, deps(T0));
    state.extra = [extraCell()];
    const r = await runSavedQuery(db, reload(db, sq.id), deps(new Date(T0.getTime() + 3 * H)));
    expect(r).toMatchObject({ notified: false, skippedReason: "no_telegram", diff: { new: 1 } });
    expect(transport.sent).toEqual([]);
  });

  it("notify_on rules: price_drop ignores new cells; new_cells ignores price drops", async () => {
    const { db, state, transport, deps } = harness();
    const sq = saveQuery(db, "alice", { notifyOn: "price_drop" });
    await runSavedQuery(db, sq, deps(T0));
    state.extra = [extraCell()];
    const onlyNew = await runSavedQuery(db, reload(db, sq.id), deps(new Date(T0.getTime() + 3 * H)));
    expect(onlyNew).toMatchObject({ notified: false, skippedReason: null, diff: { new: 1, price_drops: 0 } });
    expect(transport.sent).toEqual([]);

    // Now the same cell 20% cheaper → a price drop (≥ 10%).
    state.extra = [{ ...extraCell(), FMileageCost: "49600" }];
    const drop = await runSavedQuery(db, reload(db, sq.id), deps(new Date(T0.getTime() + 6 * H)));
    expect(drop).toMatchObject({ notified: true, diff: { new: 0, price_drops: 1 } });
    expect(transport.sent[0]!.text).toContain("62,000 mi → 49,600 mi (−20%)");

    // A saved query that only wants new cells does not fire on the same drop.
    const sq2 = saveQuery(db, "bob", { notifyOn: "new_cells" });
    state.extra = [extraCell()];
    await runSavedQuery(db, sq2, deps(new Date(T0.getTime() + 6 * H)));
    state.extra = [{ ...extraCell(), FMileageCost: "40000" }];
    const bobDrop = await runSavedQuery(db, reload(db, sq2.id), deps(new Date(T0.getTime() + 9 * H)));
    expect(bobDrop).toMatchObject({ notified: false, skippedReason: null, diff: { price_drops: 1, new: 0 } });
    expect(transport.sent).toHaveLength(1);
  });

  it("quota exhausted → skipped 'quota', no upstream request, run recorded, last_run_at bumped", async () => {
    const { db, fetch, transport, deps } = harness();
    db.insert(apiUsage).values({ userId: "alice", provider: "seats_aero", day: "2026-10-01", calls: 950 }).run();
    const sq = saveQuery(db, "alice");
    const r = await runSavedQuery(db, sq, deps(T0));
    expect(r).toMatchObject({ notified: false, skippedReason: "quota", cells: 0, diff: null, error: { code: "quota" } });
    expect(fetch.calls).toHaveLength(0);
    expect(transport.sent).toEqual([]);
    expect(runsFor(db, sq.id)).toHaveLength(1);
    expect(runsFor(db, sq.id)[0]).toMatchObject({ skippedReason: "quota", cellsHash: "", cellsJson: "[]", callsUsed: 0 });
    expect(reload(db, sq.id).lastRunAt).toBe(T0.toISOString());
  });

  it("no key → skipped 'no_key' with no upstream request; error carries no secret", async () => {
    const { db, fetch, deps } = harness();
    const sq = saveQuery(db, "carol");
    const r = await runSavedQuery(db, sq, deps(T0));
    expect(r).toMatchObject({ skippedReason: "no_key", error: { code: "no_key", detail: "SeatsNotConnectedError" } });
    expect(fetch.calls).toHaveLength(0);
    expect(runsFor(db, sq.id)[0]!.callsUsed).toBe(0);
    expect(JSON.stringify(r)).not.toContain("700800900");
  });

  it("upstream HTTP error → 'upstream_error' with the HTTP kind only", async () => {
    const { db, state, deps } = harness();
    state.upstreamStatus = 503;
    const sq = saveQuery(db, "alice");
    const r = await runSavedQuery(db, sq, deps(T0));
    expect(r).toMatchObject({ skippedReason: "upstream_error", error: { code: "upstream_error", detail: "unavailable" } });
    expect(JSON.stringify(r)).not.toContain("upstream sad");
    // The facade may have spent calls on the pages it completed and does not say how many, so the
    // row records "not recorded" rather than claiming zero.
    expect(runsFor(db, sq.id)[0]!.callsUsed).toBeNull();
  });

  it("a stored query written before min_cabin_pct existed runs unchanged, at the API default (issue #18)", async () => {
    const { db, fetch, deps } = harness();
    // Exactly what is on disk for every standing query created before #18: no such key.
    const legacy = JSON.parse(JSON.stringify(QUERY)) as Record<string, unknown>;
    delete legacy.min_cabin_pct;
    expect(legacy).not.toHaveProperty("min_cabin_pct");
    const sq = saveQuery(db, "alice", { queryJson: JSON.stringify(legacy) });

    const r = await runSavedQuery(db, sq, deps(T0));
    // It parses and runs: "first_run" is the baseline pass, not a refusal.
    expect(r.skippedReason).toBe("first_run");
    expect(r.error).toBeNull();
    expect(runsFor(db, sq.id)).toHaveLength(1);
    // The scheduler's requests are byte-identical to the pre-#18 ones: no min_cabin_pct on the
    // wire, and therefore the same cache scope as the rows it already has a baseline against.
    expect(fetch.calls.length).toBeGreaterThan(0);
    expect(fetch.calls.every((c) => !c.url.searchParams.has("min_cabin_pct"))).toBe(true);

    // And a second run is served from the SAME cache scope: no extra upstream call.
    const before = fetch.calls.length;
    await runSavedQuery(db, sq, deps(T0));
    expect(fetch.calls).toHaveLength(before);
  });

  it("invalid query_json → 'invalid_query' without touching the key or upstream", async () => {
    const { db, fetch, deps } = harness();
    const sq = saveQuery(db, "alice", { queryJson: '{"origins":[]}' });
    const r = await runSavedQuery(db, sq, deps(T0));
    expect(r).toMatchObject({ skippedReason: "invalid_query", error: { code: "invalid_query" } });
    expect(fetch.calls).toHaveLength(0);
    expect(runsFor(db, sq.id)[0]!.callsUsed).toBe(0);
  });

  it("a failing transport records send_failed and the change is retried on the next run", async () => {
    const { db, state, deps } = harness();
    const failing = recorder({ fail: true });
    const sq = saveQuery(db, "alice");
    await runSavedQuery(db, sq, deps(T0, { transport: failing }));
    state.extra = [extraCell()];
    const failed = await runSavedQuery(db, reload(db, sq.id), deps(new Date(T0.getTime() + 3 * H), { transport: failing }));
    expect(failed).toMatchObject({ notified: false, skippedReason: "send_failed", error: { code: "send_failed" } });
    const ok = recorder();
    const retried = await runSavedQuery(db, reload(db, sq.id), deps(new Date(T0.getTime() + 6 * H), { transport: ok }));
    expect(retried).toMatchObject({ notified: true, diff: { new: 1 } });
    expect(ok.sent).toHaveLength(1);
  });

  it("a transport that RETURNS { ok: false } (blocked bot, 429, 5xx — the real transports never throw) records send_failed and is retried", async () => {
    const { db, state, deps } = harness();
    let blocked = true;
    const mock = new MockTransport({ failWith: () => (blocked ? { ok: false, reason: "blocked" } : undefined) });
    const sq = saveQuery(db, "alice");
    await runSavedQuery(db, sq, deps(T0, { transport: mock }));
    state.extra = [extraCell()];
    const failed = await runSavedQuery(db, reload(db, sq.id), deps(new Date(T0.getTime() + 3 * H), { transport: mock }));
    expect(failed).toMatchObject({ notified: false, skippedReason: "send_failed", diff: { new: 1 }, error: { code: "send_failed", detail: "blocked" } });
    expect(mock.sent).toEqual([]);
    expect(runsFor(db, sq.id)[1]).toMatchObject({ notified: false, skippedReason: "send_failed", newCells: 1 });
    // The failed run is not the baseline: the same cell is still "new" next time and goes out once the bot is reachable.
    blocked = false;
    const retried = await runSavedQuery(db, reload(db, sq.id), deps(new Date(T0.getTime() + 6 * H), { transport: mock }));
    expect(retried).toMatchObject({ notified: true, skippedReason: null, diff: { new: 1 } });
    expect(mock.sent).toHaveLength(1);
    expect(mock.sent[0]!.chatId).toBe(ALICE_CHAT);
    expect(runsFor(db, sq.id)[2]).toMatchObject({ notified: true, skippedReason: null });
  });

  it("claim: a second runner inside the claim window gets in_progress — no fetch, no message, no run row", async () => {
    const { db, fetch, state, transport, deps } = harness();
    const sq = saveQuery(db, "alice");
    await runSavedQuery(db, sq, deps(T0));
    state.extra = [extraCell()];
    const T1 = new Date(T0.getTime() + 3 * H);
    // The worker claims T1 (simulating a tick still in flight in another process)...
    expect(claimRun(db, sq.id, T1.toISOString())).toBe(true);
    const calls = fetch.calls.length;
    // ...and the web process's "run now" 10 s later is refused.
    const refused = await runSavedQuery(db, reload(db, sq.id), deps(new Date(T1.getTime() + 10_000)));
    expect(refused).toMatchObject({ runId: null, notified: false, skippedReason: "in_progress", cells: 0, diff: null, error: { code: "in_progress" } });
    expect(fetch.calls).toHaveLength(calls);
    expect(transport.sent).toEqual([]);
    expect(runsFor(db, sq.id)).toHaveLength(1);
    // Exactly one window later the claim is free again and the change goes out once.
    const later = await runSavedQuery(db, reload(db, sq.id), deps(new Date(T1.getTime() + RUN_CLAIM_WINDOW_MS)));
    expect(later).toMatchObject({ notified: true, diff: { new: 1 } });
    expect(transport.sent).toHaveLength(1);
    expect(runsFor(db, sq.id)).toHaveLength(2);
    // Claims are monotonic: a claim older than last_run_at is refused too.
    expect(claimRun(db, sq.id, T0.toISOString())).toBe(false);
  });

  it("retention: query_runs is capped per saved query and the baseline survives the sweep", async () => {
    const { db, state, deps } = harness();
    const sq = saveQuery(db, "alice");
    await runSavedQuery(db, sq, deps(T0)); // baseline (first_run)
    const LAST = new Date(T0.getTime() + 15 * H);
    const baseline = findBaseline(db, sq.id, LAST)!;
    // Five later runs that never become the baseline (send_failed is a PENDING reason).
    state.extra = [extraCell()];
    const failing = recorder({ fail: true });
    for (let i = 1; i <= 5; i += 1) {
      await runSavedQuery(db, reload(db, sq.id), deps(new Date(T0.getTime() + i * 3 * H), { transport: failing }));
    }
    expect(runsFor(db, sq.id)).toHaveLength(6);
    expect(findBaseline(db, sq.id, LAST)!.id).toBe(baseline.id);
    expect(pruneQueryRuns(db, sq.id, 2, LAST)).toBe(3);
    const left = runsFor(db, sq.id);
    expect(left).toHaveLength(3);
    expect(left.map((r) => r.id)).toContain(baseline.id);
    expect(findBaseline(db, sq.id, LAST)!.id).toBe(baseline.id);
    expect(pruneQueryRuns(db, sq.id, 2, LAST)).toBe(0);
  });

  it("short-term caching: a baseline 24 hours old is none; the run says so, sends nothing and becomes the baseline", async () => {
    const { db, state, transport, deps } = harness();
    const sq = saveQuery(db, "alice");
    await runSavedQuery(db, sq, deps(T0)); // first_run
    // A new cell, but the baseline's cells are past the limit: nothing to compare with, so nothing is sent.
    state.extra = [extraCell()];
    const late = await runSavedQuery(db, reload(db, sq.id), deps(new Date(T0.getTime() + 24 * H + 60_000)));
    expect(late).toMatchObject({ notified: false, skippedReason: "baseline_expired", diff: null, error: null });
    expect(transport.sent).toEqual([]);
    // The next run compares with that one, as usual.
    const next = await runSavedQuery(db, reload(db, sq.id), deps(new Date(T0.getTime() + 27 * H)));
    expect(next).toMatchObject({ skippedReason: null, diff: { new: 0, dropped: 0 } });
  });

  it("short-term caching: a purged baseline (Disconnect, a revoked grant) is none either", async () => {
    const { db, state, transport, deps } = harness();
    const sq = saveQuery(db, "alice");
    await runSavedQuery(db, sq, deps(T0));
    purgeSeatsDataForUser(db, "alice", new Date(T0.getTime() + H));
    expect(runsFor(db, sq.id).every((r) => r.cellsJson === "[]" && r.cellsPurgedAt !== null)).toBe(true);
    state.extra = [extraCell()];
    const after = await runSavedQuery(db, reload(db, sq.id), deps(new Date(T0.getTime() + 3 * H)));
    expect(after).toMatchObject({ notified: false, skippedReason: "baseline_expired" });
    expect(transport.sent).toEqual([]);
  });

  it("uses the injected formatter (src/lib/notify/format.ts contract) when given", async () => {
    const { db, state, transport, deps } = harness();
    const sq = saveQuery(db, "alice");
    await runSavedQuery(db, sq, deps(T0));
    state.extra = [extraCell()];
    const seen: unknown[] = [];
    await runSavedQuery(db, reload(db, sq.id), deps(new Date(T0.getTime() + 3 * H), {
      format: (input) => {
        seen.push({ name: input.savedQuery.name, locale: input.locale, gridUrl: input.gridUrl, newKeys: input.diff.new.map((c) => c.key) });
        return "<b>custom</b>";
      },
    }));
    expect(seen).toEqual([{ name: sq.name, locale: "zh", gridUrl: expect.stringMatching(/^https:\/\/awardgrid\.test\/grid\?q=[A-Za-z0-9_-]+$/), newKeys: [NEW_CELL_KEY] }]);
    expect(transport.sent).toEqual([{ chatId: ALICE_CHAT, text: "<b>custom</b>" }]);
  });
});

describe("tick / runNow", () => {
  it("fires on schedule: due at first tick, not 5 minutes later, due again after 3 h; two users never mix keys or chats", async () => {
    const { db, fetch, state, transport, deps } = harness();
    const a = saveQuery(db, "alice");
    const b = saveQuery(db, "bob");
    saveQuery(db, "carol", { enabled: false }); // disabled: never considered

    const t1 = await tick(db, deps(T0));
    expect(t1).toMatchObject({ considered: 2, due: 2, notified: 0, skipped: 2, errors: [] });
    expect(t1.results.map((r) => [r.savedQueryId, r.skippedReason])).toEqual([
      [a.id, "first_run"],
      [b.id, "first_run"],
    ]);
    const aliceCalls = fetch.calls.filter((c) => c.headers["partner-authorization"] === `Bearer ${ALICE_KEY}`).length;
    const bobCalls = fetch.calls.filter((c) => c.headers["partner-authorization"] === `Bearer ${BOB_KEY}`).length;
    expect(aliceCalls).toBe(1 + SYNTHETIC_PROGRAMS.length);
    expect(bobCalls).toBe(1 + SYNTHETIC_PROGRAMS.length);
    expect(fetch.calls).toHaveLength(aliceCalls + bobCalls);

    const t2 = await tick(db, deps(new Date(T0.getTime() + 5 * 60 * 1000)));
    expect(t2).toMatchObject({ considered: 2, due: 0, results: [] });

    state.extra = [extraCell()];
    const before = fetch.calls.length;
    const t3 = await tick(db, deps(new Date(T0.getTime() + 3 * H)));
    expect(t3).toMatchObject({ due: 2, notified: 2, skipped: 0 });
    expect(transport.sent).toHaveLength(2);
    expect(transport.sent.map((m) => m.chatId).sort()).toEqual([ALICE_CHAT, BOB_CHAT].sort());
    expect(transport.sent.every((m) => m.text.includes("2026-10-10"))).toBe(true);
    // The message to alice's chat is about alice's query and vice versa.
    const toAlice = transport.sent.find((m) => m.chatId === ALICE_CHAT)!;
    const toBob = transport.sent.find((m) => m.chatId === BOB_CHAT)!;
    expect(toAlice.text).toContain(a.name);
    expect(toBob.text).toContain(b.name);
    expect(toAlice.text).not.toContain(b.name);
    // Runs since t1 still used only the owner's key.
    const later = fetch.calls.slice(before);
    expect(later.length).toBeGreaterThan(0);
    expect(later.every((c) => c.headers["partner-authorization"] === `Bearer ${ALICE_KEY}` || c.headers["partner-authorization"] === `Bearer ${BOB_KEY}`)).toBe(true);
    expect(runsFor(db, a.id)).toHaveLength(2);
    expect(runsFor(db, b.id)).toHaveLength(2);
  });

  it("one user's exhausted quota skips only that user's query", async () => {
    const { db, transport, deps, state } = harness();
    const a = saveQuery(db, "alice");
    const b = saveQuery(db, "bob");
    await tick(db, deps(T0));
    db.insert(apiUsage).values({ userId: "alice", provider: "seats_aero", day: "2026-10-02", calls: 950 }).run();
    state.extra = [extraCell()];
    const t = await tick(db, deps(new Date("2026-10-02T00:00:00Z")));
    expect(t.results.map((r) => [r.savedQueryId, r.skippedReason, r.notified])).toEqual([
      [a.id, "quota", false],
      [b.id, null, true],
    ]);
    expect(transport.sent).toEqual([expect.objectContaining({ chatId: BOB_CHAT })]);
  });

  it("runNow ignores enabled/cron, enforces ownership, and returns null for unknown ids", async () => {
    const { db, deps } = harness();
    const sq = saveQuery(db, "alice", { enabled: false, lastRunAt: T0.toISOString() });
    expect(await runNow(db, sq.id, deps(new Date(T0.getTime() + 60_000)), { userId: "bob" })).toBeNull();
    expect(await runNow(db, "missing", deps(T0))).toBeNull();
    const r = await runNow(db, sq.id, deps(new Date(T0.getTime() + 60_000)), { userId: "alice" });
    expect(r).toMatchObject({ savedQueryId: sq.id, skippedReason: "first_run" });
    expect(runsFor(db, sq.id)).toHaveLength(1);
  });
});
