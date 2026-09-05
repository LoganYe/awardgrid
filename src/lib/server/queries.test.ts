/**
 * Data layer + integration seam for saved queries: per-user scoping, the API cron rule, link
 * tokens, and runNow through the scheduler (find with the OWNER's key, diff, record; mock
 * transport). No network — the seats.aero fixture is served by a fake fetch; keys are
 * encrypted with a test master key.
 */
import { describe, expect, it } from "vitest";
import { openTestDb, type Db } from "@/lib/db/client";
import { apiUsage, queryRuns } from "@/lib/db/schema";
import { seedUsers } from "@/lib/db/stores/testing";
import { setKey } from "@/lib/keys";
import { QueryObject } from "@/lib/query/schema";
import type { Route } from "@/lib/seatsaero/types";
import { fakeFetch, jsonResponse, textResponse } from "../../../test/fixtures/seatsaero/helpers";
import { SYNTHETIC_ORIGINS, SYNTHETIC_PROGRAMS, generateSynthetic } from "../../../test/fixtures/seatsaero/generate-synthetic";
import {
  createSavedQuery,
  createTelegramLinkToken,
  deleteSavedQuery,
  getSavedQuery,
  listRuns,
  listSavedQueries,
  runNow,
  telegramLinked,
  unlinkTelegram,
  updateSavedQuery,
  validateCron,
  DEFAULT_CRON,
} from "./queries";

const MASTER = Buffer.from("0f".repeat(32), "hex");
const ALICE_KEY = "alice_pro_key_SECRET_a1b2c3";
const NOW = new Date("2026-10-01T12:00:00Z");
const now = () => NOW;

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

function harness(): { db: Db; fetch: ReturnType<typeof fakeFetch> } {
  const db = openTestDb();
  seedUsers(db, ["alice", "bob"]);
  setKey(db, "alice", "seats_aero", ALICE_KEY, { masterKey: MASTER, now: NOW });
  const synthetic = generateSynthetic();
  const routes = (source: string): Route[] =>
    SYNTHETIC_ORIGINS.filter((o) => o !== "GMP").map((o) => ({
      ID: `${source}-${o}`,
      OriginAirport: o,
      OriginRegion: "Asia",
      DestinationAirport: "SEA",
      DestinationRegion: "North America",
      NumDaysOut: 330,
      Distance: 5000,
      Source: source,
    }));
  const fetch = fakeFetch((req) => {
    if (req.url.pathname === "/partnerapi/search") return jsonResponse(synthetic);
    if (req.url.pathname === "/partnerapi/routes") return jsonResponse(routes(req.url.searchParams.get("source")!));
    return textResponse("not found", 404);
  });
  return { db, fetch };
}

describe("validateCron", () => {
  it("accepts the presets and hourly-or-slower 5-field expressions", () => {
    for (const c of [DEFAULT_CRON, "0 */6 * * *", "0 */12 * * *", "0 8 * * *", "30 9 * * 1-5", "15 */2 1,15 * *"]) {
      expect(validateCron(c), c).toEqual({ ok: true });
    }
  });
  it("rejects malformed, 6-field and sub-hourly expressions", () => {
    expect(validateCron("")).toEqual({ ok: false, reason: "invalid" });
    expect(validateCron("every 3 hours")).toEqual({ ok: false, reason: "invalid" });
    expect(validateCron("0 0 */3 * * *")).toEqual({ ok: false, reason: "invalid" });
    expect(validateCron("99 * * * *")).toEqual({ ok: false, reason: "invalid" });
    expect(validateCron("* * * * *")).toEqual({ ok: false, reason: "too_frequent" });
    expect(validateCron("*/15 * * * *")).toEqual({ ok: false, reason: "too_frequent" });
    expect(validateCron("0,30 * * * *")).toEqual({ ok: false, reason: "too_frequent" });
  });
});

describe("saved query CRUD scoping", () => {
  it("scopes get / update / delete / listRuns to the owner", () => {
    const { db } = harness();
    const a = createSavedQuery(db, "alice", { name: "a", query: QUERY }, { now });
    expect(a).toMatchObject({ schedule_cron: DEFAULT_CRON, notify_on: "both", drop_threshold_pct: 10, enabled: true, created_at: NOW.toISOString() });
    expect(getSavedQuery(db, "bob", a.id)).toBeNull();
    expect(updateSavedQuery(db, "bob", a.id, { enabled: false })).toBeNull();
    expect(listRuns(db, "bob", a.id)).toBeNull();
    expect(deleteSavedQuery(db, "bob", a.id)).toBe(false);
    expect(getSavedQuery(db, "alice", a.id)?.enabled).toBe(true);
    expect(listSavedQueries(db, "bob")).toEqual([]);
    expect(updateSavedQuery(db, "alice", a.id, {})?.enabled).toBe(true);
    expect(deleteSavedQuery(db, "alice", a.id)).toBe(true);
    expect(listSavedQueries(db, "alice")).toEqual([]);
  });
});

describe("telegram link tokens", () => {
  it("mints a base64url payload ≤ 64 chars with a 15-minute expiry; unlink clears everything", () => {
    const { db } = harness();
    const link = createTelegramLinkToken(db, "alice", { now: NOW });
    expect(link.token).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(link.expiresAt).toBe("2026-10-01T12:15:00.000Z");
    expect(link.deepLink("@my_bot")).toBe(`https://t.me/my_bot?start=${link.token}`);
    expect(telegramLinked(db, "alice")).toBe(false);
    unlinkTelegram(db, "alice");
    unlinkTelegram(db, "alice");
    expect(telegramLinked(db, "alice")).toBe(false);
  });
});

describe("runNow (through the scheduler)", () => {
  it("runs with the owner's own key, records a first_run baseline, then a no-change run", async () => {
    const { db, fetch } = harness();
    const saved = createSavedQuery(db, "alice", { name: "a", query: QUERY }, { now });
    const env = { APP_URL: "https://grid.example" }; // no TELEGRAM_BOT_TOKEN → mock transport

    const first = await runNow(db, saved.id, { now, fetch, masterKey: MASTER, env });
    expect(first.ran_at).toBe(NOW.toISOString());
    expect(first.new_cells).toBe(0);
    expect(first.dropped_cells).toBe(0);
    expect(first.notified).toBe(false);
    expect(first.skipped_reason).toBe("first_run");
    expect(fetch.calls.length).toBeGreaterThan(0);
    expect(fetch.calls.every((c) => c.headers["partner-authorization"] === ALICE_KEY)).toBe(true);
    expect(db.select().from(apiUsage).all().every((r) => r.userId === "alice")).toBe(true);
    expect(getSavedQuery(db, "alice", saved.id)?.last_run_at).toBe(NOW.toISOString());

    const later = () => new Date(NOW.getTime() + 10 * 60_000);
    const second = await runNow(db, saved.id, { now: later, fetch, masterKey: MASTER, env });
    expect(second.new_cells).toBe(0);
    expect(second.dropped_cells).toBe(0);
    expect(second.skipped_reason).toBeNull();
    expect(second.notified).toBe(false);
    const runs = db.select().from(queryRuns).all();
    expect(runs).toHaveLength(2);
    expect(runs[0]!.cellsHash).toBe(runs[1]!.cellsHash);
    expect(runs[0]!.cellsJson.length).toBeGreaterThan(2);
    expect(listRuns(db, "alice", saved.id)!.map((r) => r.id)).toEqual([second.id, first.id]);
  });

  it("a concurrent run (the worker's claim) surfaces as RunInProgressError without fetching or recording", async () => {
    const { db, fetch } = harness();
    const saved = createSavedQuery(db, "alice", { name: "a", query: QUERY }, { now });
    const env = { APP_URL: "https://grid.example" };
    await runNow(db, saved.id, { now, fetch, masterKey: MASTER, env });
    const calls = fetch.calls.length;
    const tenSecondsLater = () => new Date(NOW.getTime() + 10_000);
    await expect(runNow(db, saved.id, { now: tenSecondsLater, fetch, masterKey: MASTER, env })).rejects.toMatchObject({ name: "RunInProgressError" });
    expect(fetch.calls).toHaveLength(calls);
    expect(db.select().from(queryRuns).all()).toHaveLength(1);
  });

  it("refuses to run for a user without a key (NoKeyError) and never uses another user's key", async () => {
    const { db, fetch } = harness();
    const saved = createSavedQuery(db, "bob", { name: "b", query: QUERY }, { now });
    await expect(runNow(db, saved.id, { now, fetch, masterKey: MASTER, env: {} })).rejects.toMatchObject({ name: "NoKeyError" });
    expect(fetch.calls).toHaveLength(0);
    // The scheduler records the skipped run (reason no_key); the API surfaces it as 409.
    const runs = db.select().from(queryRuns).all();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.skippedReason).toBe("no_key");
  });
});
