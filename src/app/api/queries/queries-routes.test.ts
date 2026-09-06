/**
 * Route-handler tests for /api/queries, /api/queries/[id], /api/queries/[id]/runs and
 * /api/queries/[id]/run against an in-memory SQLite (openTestDb) via the getServerDb() mock.
 * runNow is stubbed (vi.mock) so no key, quota or network is involved; the fallback runNow
 * itself is covered in src/lib/server/queries.test.ts.
 */
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSession, SESSION_COOKIE } from "@/lib/auth";
import { openTestDb, type Db } from "@/lib/db/client";
import { queryRuns, savedQueries, users } from "@/lib/db/schema";
import { NoKeyError } from "@/lib/keys";
import type { QueryObject } from "@/lib/query/schema";
import { RunInProgressError, RunQuotaError, type RunSummary, type SavedQuerySummary } from "@/lib/server/queries";

let db: Db;
vi.mock("@/lib/server/db", () => ({ getServerDb: () => db }));

const runNowMock = vi.fn<(db: Db, id: string, deps: unknown) => Promise<RunSummary>>();
vi.mock("@/lib/server/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/queries")>();
  return { ...actual, runNow: (...args: Parameters<typeof actual.runNow>) => runNowMock(...args) };
});

const { GET: listRoute, POST: createRoute } = await import("./route");
const { PATCH: patchRoute, DELETE: deleteRoute } = await import("./[id]/route");
const { GET: runsRoute } = await import("./[id]/runs/route");
const { POST: runRoute } = await import("./[id]/run/route");

const QUERY: QueryObject = {
  origins: ["HKG", "PVG", "NRT", "ICN"],
  destinations: ["SEA"],
  date_from: "2026-10-01",
  date_to: "2026-10-30",
  cabins: ["F"],
  direct_only: false,
  include_filtered: false,
  sort_by: "miles_asc",
  raw_text: "香港、上海、东京、首尔到西雅图，未来一个月最便宜的头等舱",
  language: "zh",
};

function seedUser(id: string): { id: string; token: string } {
  db.insert(users).values({ id, username: id, passwordHash: "x", createdAt: "2026-09-06T00:00:00.000Z" }).run();
  const { token } = createSession(db, id);
  return { id, token };
}

function req(path: string, init: { method?: string; body?: unknown; token?: string; contentType?: string | null } = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (init.contentType !== null) headers["content-type"] = init.contentType ?? "application/json";
  if (init.token) headers.cookie = `${SESSION_COOKIE}=${init.token}`;
  return new NextRequest(`http://localhost${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function create(token: string, extra: Record<string, unknown> = {}): Promise<SavedQuerySummary> {
  const res = await createRoute(req("/api/queries", { method: "POST", token, body: { name: "HKG… → SEA F", query: QUERY, ...extra } }));
  expect(res.status).toBe(201);
  return ((await res.json()) as { query: SavedQuerySummary }).query;
}

beforeEach(() => {
  db = openTestDb();
  runNowMock.mockReset();
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new Error("network access is not allowed in tests");
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("auth", () => {
  it("every handler answers 401 without a session", async () => {
    const id = "00000000-0000-4000-8000-000000000000";
    expect((await listRoute(req("/api/queries"))).status).toBe(401);
    expect((await createRoute(req("/api/queries", { method: "POST", body: { name: "x", query: QUERY } }))).status).toBe(401);
    expect((await patchRoute(req(`/api/queries/${id}`, { method: "PATCH", body: { enabled: false } }), ctx(id))).status).toBe(401);
    expect((await deleteRoute(req(`/api/queries/${id}`, { method: "DELETE" }), ctx(id))).status).toBe(401);
    expect((await runsRoute(req(`/api/queries/${id}/runs`), ctx(id))).status).toBe(401);
    expect((await runRoute(req(`/api/queries/${id}/run`, { method: "POST" }), ctx(id))).status).toBe(401);
    expect(runNowMock).not.toHaveBeenCalled();
  });
});

describe("POST + GET /api/queries", () => {
  it("creates with the §12 defaults and lists it with last_run = null", async () => {
    const alice = seedUser("alice");
    const created = await create(alice.token);
    expect(created).toMatchObject({
      name: "HKG… → SEA F",
      schedule_cron: "0 */3 * * *",
      notify_on: "both",
      drop_threshold_pct: 10,
      enabled: true,
      last_run_at: null,
      last_run: null,
    });
    expect(created.query).toEqual(QUERY);

    const res = await listRoute(req("/api/queries", { token: alice.token }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { queries: SavedQuerySummary[] };
    expect(body.queries).toHaveLength(1);
    expect(body.queries[0]!.id).toBe(created.id);
  });

  it("accepts explicit schedule / notify / threshold and trims the name", async () => {
    const alice = seedUser("alice");
    const created = await create(alice.token, { name: "  daily F  ", schedule_cron: "0 8 * * *", notify_on: "price_drop", drop_threshold_pct: 25 });
    expect(created).toMatchObject({ name: "daily F", schedule_cron: "0 8 * * *", notify_on: "price_drop", drop_threshold_pct: 25 });
  });

  it("lists the last run summary once runs exist", async () => {
    const alice = seedUser("alice");
    const created = await create(alice.token);
    db.insert(queryRuns)
      .values([
        { id: "r1", savedQueryId: created.id, ranAt: "2026-09-06T01:00:00.000Z", cellsHash: "a", newCells: 3, droppedCells: 0, notified: true, skippedReason: null },
        { id: "r2", savedQueryId: created.id, ranAt: "2026-09-06T04:00:00.000Z", cellsHash: "b", newCells: 0, droppedCells: 0, notified: false, skippedReason: "quota" },
      ])
      .run();
    const body = (await (await listRoute(req("/api/queries", { token: alice.token }))).json()) as { queries: SavedQuerySummary[] };
    expect(body.queries[0]!.last_run).toEqual({
      id: "r2",
      ran_at: "2026-09-06T04:00:00.000Z",
      new_cells: 0,
      dropped_cells: 0,
      notified: false,
      skipped_reason: "quota",
      calls_used: null, // inserted without a count: "not recorded", never a fabricated 0
    });
  });

  it.each([
    ["missing name", { query: QUERY }, "invalid_name"],
    ["empty name", { name: "   ", query: QUERY }, "invalid_name"],
    ["name > 60", { name: "x".repeat(61), query: QUERY }, "invalid_name"],
    ["bad cron", { name: "n", query: QUERY, schedule_cron: "every 3 hours" }, "invalid_cron"],
    ["six-field cron", { name: "n", query: QUERY, schedule_cron: "0 0 */3 * * *" }, "invalid_cron"],
    ["cron every minute", { name: "n", query: QUERY, schedule_cron: "* * * * *" }, "cron_too_frequent"],
    ["cron every 15 min", { name: "n", query: QUERY, schedule_cron: "*/15 * * * *" }, "cron_too_frequent"],
    ["threshold 0", { name: "n", query: QUERY, drop_threshold_pct: 0 }, "invalid_threshold"],
    ["threshold 91", { name: "n", query: QUERY, drop_threshold_pct: 91 }, "invalid_threshold"],
    ["threshold float", { name: "n", query: QUERY, drop_threshold_pct: 10.5 }, "invalid_threshold"],
    ["bad notify rule", { name: "n", query: QUERY, notify_on: "sms" }, "invalid_notify_on"],
    ["invalid query (span > 92 days)", { name: "n", query: { ...QUERY, date_to: "2027-03-01" } }, "invalid_query"],
    ["invalid query (bad IATA)", { name: "n", query: { ...QUERY, origins: ["Hong Kong"] } }, "invalid_query"],
    ["unknown field", { name: "n", query: QUERY, user_id: "bob" }, "invalid_body"],
  ])("rejects %s with 400", async (_label, body, code) => {
    const alice = seedUser("alice");
    const res = await createRoute(req("/api/queries", { method: "POST", token: alice.token, body }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: code });
    expect(db.select().from(savedQueries).all()).toHaveLength(0);
  });

  it("rejects a non-JSON body / content type", async () => {
    const alice = seedUser("alice");
    expect((await createRoute(req("/api/queries", { method: "POST", token: alice.token, body: "{not json" }))).status).toBe(400);
    const res = await createRoute(req("/api/queries", { method: "POST", token: alice.token, body: { name: "n", query: QUERY }, contentType: "text/plain" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_body" });
  });
});

describe("PATCH /api/queries/[id]", () => {
  it("toggles enabled and edits schedule / rule / threshold / name", async () => {
    const alice = seedUser("alice");
    const created = await create(alice.token);
    let res = await patchRoute(req(`/api/queries/${created.id}`, { method: "PATCH", token: alice.token, body: { enabled: false } }), ctx(created.id));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { query: SavedQuerySummary }).query.enabled).toBe(false);

    res = await patchRoute(
      req(`/api/queries/${created.id}`, { method: "PATCH", token: alice.token, body: { name: "renamed", schedule_cron: "0 */12 * * *", notify_on: "new_cells", drop_threshold_pct: 30 } }),
      ctx(created.id),
    );
    expect(res.status).toBe(200);
    const q = ((await res.json()) as { query: SavedQuerySummary }).query;
    expect(q).toMatchObject({ name: "renamed", schedule_cron: "0 */12 * * *", notify_on: "new_cells", drop_threshold_pct: 30, enabled: false });
    expect(q.query).toEqual(QUERY);
  });

  it("validates like create and rejects an empty patch", async () => {
    const alice = seedUser("alice");
    const created = await create(alice.token);
    const bad = async (body: unknown, code: string) => {
      const res = await patchRoute(req(`/api/queries/${created.id}`, { method: "PATCH", token: alice.token, body }), ctx(created.id));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: code });
    };
    await bad({}, "invalid_body");
    await bad({ schedule_cron: "nope" }, "invalid_cron");
    await bad({ schedule_cron: "*/5 * * * *" }, "cron_too_frequent");
    await bad({ drop_threshold_pct: 100 }, "invalid_threshold");
    await bad({ name: "" }, "invalid_name");
    // `query` is accepted (the edit drawer sends the chips back) but still validated.
    await bad({ query: { ...QUERY, origins: [] } }, "invalid_query");
    const row = db.select().from(savedQueries).get()!;
    expect(row.scheduleCron).toBe("0 */3 * * *");
  });

  it("replaces the stored chips when the edit drawer sends a query", async () => {
    const alice = seedUser("alice");
    const created = await create(alice.token);
    const next: QueryObject = { ...QUERY, destinations: ["SEA", "SFO"], cabins: ["J", "F"] };
    const res = await patchRoute(
      req(`/api/queries/${created.id}`, { method: "PATCH", token: alice.token, body: { query: next, name: "renamed" } }),
      ctx(created.id),
    );
    expect(res.status).toBe(200);
    const { query: q } = (await res.json()) as { query: SavedQuerySummary };
    expect(q.query).toEqual(next);
    expect(q.name).toBe("renamed");
    // Persisted, not just echoed back.
    expect(JSON.parse(db.select().from(savedQueries).get()!.queryJson)).toEqual(next);
  });
});

describe("DELETE /api/queries/[id]", () => {
  it("deletes the row and its runs; a second delete is 404", async () => {
    const alice = seedUser("alice");
    const created = await create(alice.token);
    db.insert(queryRuns).values({ id: "r1", savedQueryId: created.id, ranAt: "2026-09-06T01:00:00.000Z", cellsHash: "a" }).run();
    const res = await deleteRoute(req(`/api/queries/${created.id}`, { method: "DELETE", token: alice.token }), ctx(created.id));
    expect(res.status).toBe(204);
    expect(db.select().from(savedQueries).all()).toHaveLength(0);
    expect(db.select().from(queryRuns).all()).toHaveLength(0);
    const again = await deleteRoute(req(`/api/queries/${created.id}`, { method: "DELETE", token: alice.token }), ctx(created.id));
    expect(again.status).toBe(404);
  });
});

describe("two users", () => {
  it("bob cannot see, edit, delete, run or list runs of alice's query (404, nothing changed)", async () => {
    const alice = seedUser("alice");
    const bob = seedUser("bob");
    const created = await create(alice.token);
    await create(bob.token, { name: "bob's own" });

    const listed = (await (await listRoute(req("/api/queries", { token: bob.token }))).json()) as { queries: SavedQuerySummary[] };
    expect(listed.queries.map((q) => q.name)).toEqual(["bob's own"]);

    const patch = await patchRoute(req(`/api/queries/${created.id}`, { method: "PATCH", token: bob.token, body: { enabled: false } }), ctx(created.id));
    expect(patch.status).toBe(404);
    expect(await patch.json()).toEqual({ error: "not_found" });

    const del = await deleteRoute(req(`/api/queries/${created.id}`, { method: "DELETE", token: bob.token }), ctx(created.id));
    expect(del.status).toBe(404);

    const runs = await runsRoute(req(`/api/queries/${created.id}/runs`, { token: bob.token }), ctx(created.id));
    expect(runs.status).toBe(404);

    const run = await runRoute(req(`/api/queries/${created.id}/run`, { method: "POST", token: bob.token }), ctx(created.id));
    expect(run.status).toBe(404);
    expect(runNowMock).not.toHaveBeenCalled();

    const row = db.select().from(savedQueries).where(eq(savedQueries.id, created.id)).get()!;
    expect(row.enabled).toBe(true);
    expect(row.userId).toBe(alice.id);
  });
});

describe("GET /api/queries: next run and schedule shape (Phase 6 §4)", () => {
  it("gives every query a next_run_at and a schedule_label the UI can translate", async () => {
    const alice = seedUser("alice");
    await create(alice.token, { name: "every 3 h" });
    await create(alice.token, { name: "daily", schedule_cron: "0 8 * * *" });
    const body = (await (await listRoute(req("/api/queries", { token: alice.token }))).json()) as { queries: SavedQuerySummary[] };
    const byName = new Map(body.queries.map((q) => [q.name, q]));
    expect(byName.get("every 3 h")!.schedule_label).toEqual({ kind: "every_hours", n: 3 });
    expect(byName.get("daily")!.schedule_label).toEqual({ kind: "daily", hh: 8, mm: 0 });
    for (const q of body.queries) {
      // Never run yet → the next slot is ahead of now.
      expect(Date.parse(q.next_run_at!)).toBeGreaterThan(Date.now());
    }
  });
});

describe("GET /api/queries/[id]/runs", () => {
  it("returns the last 20 runs newest first", async () => {
    const alice = seedUser("alice");
    const created = await create(alice.token);
    const rows = Array.from({ length: 25 }, (_, i) => ({
      id: `r${i}`,
      savedQueryId: created.id,
      ranAt: `2026-09-${String(1 + Math.floor(i / 24)).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00:00.000Z`,
      cellsHash: "h",
      newCells: i,
      droppedCells: 0,
      notified: i % 2 === 0,
      skippedReason: i % 2 === 0 ? null : "quiet_hours",
    }));
    db.insert(queryRuns).values(rows).run();
    const res = await runsRoute(req(`/api/queries/${created.id}/runs`, { token: alice.token }), ctx(created.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runs: RunSummary[] };
    expect(body.runs).toHaveLength(20);
    expect(body.runs[0]).toEqual({
      id: "r24",
      ran_at: "2026-09-02T00:00:00.000Z",
      new_cells: 24,
      dropped_cells: 0,
      notified: true,
      skipped_reason: null,
      calls_used: null,
    });
    expect(body.runs[19]!.id).toBe("r5");
  });
});

describe("POST /api/queries/[id]/run", () => {
  it("calls runNow for the user's own query and returns the run summary", async () => {
    const alice = seedUser("alice");
    const created = await create(alice.token);
    const summary: RunSummary = { id: "run-1", ran_at: "2026-09-06T05:00:00.000Z", new_cells: 2, dropped_cells: 1, notified: true, skipped_reason: null, calls_used: 4 };
    runNowMock.mockResolvedValueOnce(summary);
    const res = await runRoute(req(`/api/queries/${created.id}/run`, { method: "POST", token: alice.token }), ctx(created.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ run: summary });
    expect(runNowMock).toHaveBeenCalledTimes(1);
    expect(runNowMock.mock.calls[0]![0]).toBe(db);
    expect(runNowMock.mock.calls[0]![1]).toBe(created.id);
  });

  it("maps quota → 429 with resetAt, missing key → 409, anything else → 500 without the message", async () => {
    const alice = seedUser("alice");
    const created = await create(alice.token);
    const resetAt = new Date("2026-09-07T00:00:00.000Z");
    runNowMock.mockRejectedValueOnce(new RunQuotaError(resetAt));
    let res = await runRoute(req(`/api/queries/${created.id}/run`, { method: "POST", token: alice.token }), ctx(created.id));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "quota", resetAt: resetAt.toISOString() });

    runNowMock.mockRejectedValueOnce(new NoKeyError("seats_aero"));
    res = await runRoute(req(`/api/queries/${created.id}/run`, { method: "POST", token: alice.token }), ctx(created.id));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "no_key" });

    // The worker is running this query right now (per-query claim) → 409 run_in_progress.
    runNowMock.mockRejectedValueOnce(new RunInProgressError());
    res = await runRoute(req(`/api/queries/${created.id}/run`, { method: "POST", token: alice.token }), ctx(created.id));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "run_in_progress" });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    runNowMock.mockRejectedValueOnce(new Error("secret pro_live_KEY123 leaked?"));
    res = await runRoute(req(`/api/queries/${created.id}/run`, { method: "POST", token: alice.token }), ctx(created.id));
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("KEY123");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("KEY123");
  });
});

describe("GET /api/queries/[id]/runs: the last run's diff cells", () => {
  const KEY_KEPT = "alaska|HKG|SEA|2026-10-05|J";
  const KEY_GONE = "american|PVG|SEA|2026-10-06|F";
  const KEY_NEW = "aeroplan|NRT|SEA|2026-10-07|J";

  function snapshot(keys: string[]): string {
    return JSON.stringify(keys.map((key) => ({ key, miles: 60000, fees_cents: 560, seats_left: 2, computed_last_seen: "2026-10-01T10:00:00.000Z" })));
  }

  it("returns new and dropped cells as grid rows next to the run list", async () => {
    const alice = seedUser("alice");
    const created = await create(alice.token);
    db.insert(queryRuns)
      .values([
        { id: "r1", savedQueryId: created.id, ranAt: "2026-10-01T09:00:00.000Z", cellsHash: "a", cellsJson: snapshot([KEY_KEPT, KEY_GONE]), newCells: 2, droppedCells: 0, notified: true, skippedReason: null },
        { id: "r2", savedQueryId: created.id, ranAt: "2026-10-01T12:00:00.000Z", cellsHash: "b", cellsJson: snapshot([KEY_KEPT, KEY_NEW]), newCells: 1, droppedCells: 1, notified: true, skippedReason: null, callsUsed: 27 },
      ])
      .run();
    const res = await runsRoute(req(`/api/queries/${created.id}/runs`, { token: alice.token }), ctx(created.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runs: RunSummary[]; diff: { new: Array<{ program: string }>; dropped: Array<{ program: string }> } };
    expect(body.runs[0]!.id).toBe("r2");
    expect(body.runs[0]!.calls_used).toBe(27); // query_runs.calls_used, read straight back
    expect(body.runs[1]!.calls_used).toBeNull(); // recorded before the column existed
    expect(body.diff.new.map((r) => r.program)).toEqual(["aeroplan"]);
    expect(body.diff.dropped.map((r) => r.program)).toEqual(["american"]);
    // The counts the run recorded and the rebuilt cells agree.
    expect(body.diff.new).toHaveLength(body.runs[0]!.new_cells);
    expect(body.diff.dropped).toHaveLength(body.runs[0]!.dropped_cells);
  });

  it("returns an empty diff when the query has never run", async () => {
    const alice = seedUser("alice");
    const created = await create(alice.token);
    const res = await runsRoute(req(`/api/queries/${created.id}/runs`, { token: alice.token }), ctx(created.id));
    expect(await res.json()).toEqual({ runs: [], diff: { new: [], dropped: [], price_drops: [] } });
  });
});
