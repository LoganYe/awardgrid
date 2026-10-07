/**
 * The production search port (UI/UX v1 T05): the workspace's runs go through SearchEngine.searchQuery one at a time,
 * with the key read when the run starts, and come back as snapshots that hold no key.
 */
import { describe, expect, it } from "vitest";
import { fixtureQuery, fixtureRows, FIXTURE_NOW } from "@awardgrid/core/test-fixtures/uiux/factory";
import { scopeKey } from "@awardgrid/core/workspace/identity";
import type { QueryObject } from "@awardgrid/core/query/schema";
import type { ApiResult, FindValue } from "../search/search";
import { createSearchPort, snapshotFromFind } from "./search-port";
import { SearchRunError } from "./workspace-store";

const KEY = "pro_test_key_ABC123xyz_DO_NOT_LEAK";

function value(query: QueryObject = fixtureQuery(), overrides: Partial<FindValue> = {}): FindValue {
  const rows = fixtureRows().filter((r) => query.origins.includes(r.origin));
  return {
    grid: { rows: [], columns: [] } as unknown as FindValue["grid"],
    query,
    warnings: [],
    notices: [],
    quota: { used: 1, remaining: 949, softLimit: 950, resetAt: "2026-10-19T00:00:00.000Z" },
    served_from_cache: false,
    api_calls_used: 2,
    fetched_at_min: null,
    rows,
    coverage: { state: "complete", scopeKey: scopeKey(query), slices: [] },
    ...overrides,
  };
}

/** An engine whose answers the test releases one at a time, recording when each call starts. */
function heldEngine() {
  const started: Array<{ query: QueryObject; key: string | null; release: (r: ApiResult<FindValue>) => void }> = [];
  const engine = {
    searchQuery: (query: QueryObject, key: string | null) => new Promise<ApiResult<FindValue>>((release) => started.push({ query, key, release })),
  };
  return { engine, started };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createSearchPort", () => {
  it("reads the key when the run starts and returns a snapshot with the run's revision", async () => {
    let key: string | null = null;
    const { engine, started } = heldEngine();
    const port = createSearchPort({ engine, keys: { get: async () => key }, now: () => new Date(FIXTURE_NOW) });
    key = KEY;
    const pending = port.execute(fixtureQuery(), { id: "run-3", revision: 3 });
    await tick();
    expect(started[0]!.key).toBe(KEY);
    started[0]!.release({ ok: true, value: value() });
    const snapshot = await pending;
    expect(snapshot.revision).toBe(3);
    expect(snapshot.id).toBe(`run-3@${new Date(FIXTURE_NOW).toISOString()}`);
    expect(snapshot.receipt).toEqual({ sentCalls: 2, fromCache: false });
    expect(JSON.stringify(snapshot)).not.toContain(KEY);
  });

  it("runs one search at a time: the second starts only when the first has answered", async () => {
    const { engine, started } = heldEngine();
    const port = createSearchPort({ engine, keys: { get: async () => KEY }, now: () => new Date(FIXTURE_NOW) });
    const first = port.execute(fixtureQuery(), { id: "run-1", revision: 1 });
    const second = port.execute({ ...fixtureQuery(), date_to: "2026-10-31" }, { id: "run-2", revision: 2 });
    await tick();
    expect(started).toHaveLength(1);
    started[0]!.release({ ok: false, status: 504, error: "network", message: "stopped waiting" });
    await expect(first).rejects.toBeInstanceOf(SearchRunError);
    await tick();
    expect(started).toHaveLength(2);
    started[1]!.release({ ok: true, value: value() });
    await expect(second).resolves.toMatchObject({ revision: 2 });
  });

  it("a failure is a SearchRunError with the engine's code, and the full answer is kept once for the caller", async () => {
    const { engine, started } = heldEngine();
    const port = createSearchPort({ engine, keys: { get: async () => null }, now: () => new Date(FIXTURE_NOW) });
    const pending = port.execute(fixtureQuery(), { id: "run-1", revision: 1 });
    await tick();
    started[0]!.release({ ok: false, status: 400, error: "no_key", message: "Connect your seats.aero account in Settings." });
    await expect(pending).rejects.toMatchObject({ code: "no_key" });
    expect(port.takeResult("run-1")).toMatchObject({ ok: false, error: "no_key" });
    expect(port.takeResult("run-1")).toBeNull();
  });

  it("a Keychain read that throws is treated as no key, not as a crash", async () => {
    const { engine, started } = heldEngine();
    const port = createSearchPort({ engine, keys: { get: async () => Promise.reject(new Error("locked")) }, now: () => new Date(FIXTURE_NOW) });
    const pending = port.execute(fixtureQuery(), { id: "run-1", revision: 1 });
    await tick();
    expect(started[0]!.key).toBeNull();
    started[0]!.release({ ok: false, status: 400, error: "no_key" });
    await expect(pending).rejects.toMatchObject({ code: "no_key" });
  });
});

describe("createSearchPort and superseded runs", () => {
  it("a queued run whose signal was aborted is skipped before anything is sent", async () => {
    const { engine, started } = heldEngine();
    const port = createSearchPort({ engine, keys: { get: async () => KEY }, now: () => new Date(FIXTURE_NOW) });
    const second = new AbortController();
    const first = port.execute(fixtureQuery(), { id: "run-1", revision: 1 });
    const queued = port.execute(fixtureQuery(), { id: "run-2", revision: 2, signal: second.signal });
    const third = port.execute(fixtureQuery(), { id: "run-3", revision: 3 });
    second.abort();
    await tick();
    started[0]!.release({ ok: true, value: value() });
    await first;
    await expect(queued).rejects.toMatchObject({ code: "superseded" });
    await tick();
    // run-2 never reached the engine; run-3 is the second call it sees.
    expect(started).toHaveLength(2);
    started[1]!.release({ ok: true, value: value() });
    await expect(third).resolves.toMatchObject({ revision: 3 });
  });

  it("hands each answer to onAnswer before the snapshot goes back to the caller", async () => {
    const { engine, started } = heldEngine();
    const order: string[] = [];
    const port = createSearchPort({
      engine,
      keys: { get: async () => KEY },
      now: () => new Date(FIXTURE_NOW),
      onAnswer: (snapshot, answerValue, run) => order.push(`answer:${snapshot.id}:${String(run.meta)}:${answerValue.api_calls_used}`),
    });
    const pending = port.execute(fixtureQuery(), { id: "run-1", revision: 1, meta: "typed" }).then((s) => order.push(`resolved:${s.id}`));
    await tick();
    started[0]!.release({ ok: true, value: value() });
    await pending;
    const id = `run-1@${new Date(FIXTURE_NOW).toISOString()}`;
    expect(order).toEqual([`answer:${id}:typed:2`, `resolved:${id}`]);
  });
});

describe("snapshotFromFind", () => {
  it("keys every row by the query's scope, once per identity, with its time evidence", () => {
    const v = value();
    const doubled = { ...v, rows: [...v.rows!, ...v.rows!] };
    const snapshot = snapshotFromFind(doubled, { id: "r", revision: 1 }, FIXTURE_NOW);
    expect(snapshot.rows).toHaveLength(v.rows!.length);
    expect(new Set(snapshot.rows.map((r) => r.key)).size).toBe(snapshot.rows.length);
    expect(snapshot.scopeKey).toBe(scopeKey(v.query));
    for (const row of snapshot.rows) expect(row.time.basis).toBe("provider_last_seen");
  });

  it("coverage for another scope, or an answer without its rows, is unknown, never complete", () => {
    const other = snapshotFromFind(value(fixtureQuery(), { coverage: { state: "complete", scopeKey: "v1|other", slices: [] } }), { id: "r", revision: 1 }, FIXTURE_NOW);
    expect(other.coverage.state).toBe("unknown");
    const rowless = snapshotFromFind(value(fixtureQuery(), { rows: undefined }), { id: "r", revision: 1 }, FIXTURE_NOW);
    expect(rowless.coverage.state).toBe("unknown");
    expect(rowless.rows).toEqual([]);
  });
});
