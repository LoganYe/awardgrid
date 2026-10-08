/**
 * One retry after a renewal (./refresh-retry.ts) on each path that spends a seats.aero call: the workspace's search
 * port, an option's details, and the watch runner. A refused token is renewed and the request sent once more; a second
 * refusal is the answer; a pasted key, with nothing to renew, is sent exactly once, as before.
 */
import { describe, expect, it, vi } from "vitest";
import { fixtureSnapshot } from "@awardgrid/core/test-fixtures/uiux/factory";
import type { Watch } from "@awardgrid/core/watch";
import type { QueryObject } from "@awardgrid/core/query/schema";
import { MemoryKeyStore } from "../native/keychain";
import type { ApiResult, FindValue } from "../search/search";
import { WatchStore } from "../store/watch-store";
import { baselineExpired, checkWatches } from "../watch/runner";
import { createDetailService } from "../workspace/detail-service";
import { createSearchPort } from "../workspace/search-port";
import { type RenewableKeys, refusedByProvider, renewedKey, withRenewal } from "./refresh-retry";

const refused = (status = 401): ApiResult<never> => ({ ok: false, status, error: "no_key", kind: `http_${status}`, message: "refused" });

/** Keys that hand out `first` and renew to `next` (or null), counting renewals. */
function renewable(first: string, next: string | null): RenewableKeys & { renewals: Array<string | null | undefined> } {
  let current = first;
  const renewals: Array<string | null | undefined> = [];
  return {
    renewals,
    get: async () => current,
    refresh: async (rejected) => {
      renewals.push(rejected);
      if (next) current = next;
      return next;
    },
  };
}

describe("withRenewal", () => {
  it("sends once more with the renewed token after a 401 or 403, and only once", async () => {
    for (const status of [401, 403]) {
      const keys = renewable("Bearer seats:ota:old", "Bearer seats:ota:new");
      const sent: Array<string | null> = [];
      const res = await withRenewal(keys, async (key) => {
        sent.push(key);
        return key === "Bearer seats:ota:new" ? { ok: true as const, value: 1 } : refused(status);
      });
      expect(res).toEqual({ ok: true, value: 1 });
      expect(sent).toEqual(["Bearer seats:ota:old", "Bearer seats:ota:new"]);
      expect(keys.renewals).toEqual(["Bearer seats:ota:old"]);
    }
    const stubborn = renewable("Bearer seats:ota:old", "Bearer seats:ota:new");
    const attempt = vi.fn(async () => refused());
    expect(await withRenewal(stubborn, attempt)).toEqual(refused());
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("does not resend for another failure, a pasted key, a renewal that gave nothing new, or a request no longer wanted", async () => {
    const other = vi.fn(async (): Promise<ApiResult<number>> => ({ ok: false, status: 504, error: "network" }));
    await withRenewal(renewable("a", "b"), other);
    expect(other).toHaveBeenCalledTimes(1);
    const key = new MemoryKeyStore();
    await key.set("pasted-key");
    const once = vi.fn(async () => refused());
    await withRenewal(key, once);
    expect(once).toHaveBeenCalledTimes(1);
    const same = vi.fn(async () => refused());
    await withRenewal(renewable("a", null), same);
    expect(same).toHaveBeenCalledTimes(1);
    const unwanted = vi.fn(async () => refused());
    const keys = renewable("a", "b");
    await withRenewal(keys, unwanted, () => false);
    expect(unwanted).toHaveBeenCalledTimes(1);
    expect(keys.renewals).toEqual([]);
  });

  it("reads seats.aero's refusal from the engine's failure shape only", async () => {
    expect(refusedByProvider(refused(401))).toBe(true);
    expect(refusedByProvider({ ok: false, status: 400, error: "no_key" })).toBe(false);
    expect(refusedByProvider({ ok: false, status: 401, error: "seatsaero" })).toBe(false);
    expect(await renewedKey({ get: async () => "k" }, "k")).toBeNull();
    expect(await renewedKey(renewable("a", "a"), "a")).toBeNull();
    expect(await renewedKey({ get: async () => "a", refresh: async () => Promise.reject(new Error("x")) }, "a")).toBeNull();
  });
});

describe("the search port", () => {
  const query = fixtureSnapshot().query;
  const value = { query, rows: [], coverage: null, served_from_cache: false, api_calls_used: 1 } as unknown as FindValue;

  it("renews a refused token and runs the search once more", async () => {
    const keys = renewable("Bearer seats:ota:old", "Bearer seats:ota:new");
    const used: Array<string | null> = [];
    const port = createSearchPort({
      engine: { searchQuery: async (_q: QueryObject, key: string | null) => (used.push(key), key === "Bearer seats:ota:new" ? { ok: true, value } : refused()) },
      keys,
      now: () => new Date("2026-10-06T12:00:00Z"),
    });
    const snapshot = await port.execute(query, { id: "run-1", revision: 1 });
    expect(snapshot.revision).toBe(1);
    expect(used).toEqual(["Bearer seats:ota:old", "Bearer seats:ota:new"]);
  });

  it("does not send a run again once a newer run replaced it", async () => {
    const keys = renewable("Bearer seats:ota:old", "Bearer seats:ota:new");
    const controller = new AbortController();
    const searchQuery = vi.fn(async () => {
      controller.abort();
      return refused();
    });
    const port = createSearchPort({ engine: { searchQuery }, keys, now: () => new Date() });
    await expect(port.execute(query, { id: "run-1", revision: 1, signal: controller.signal })).rejects.toThrow();
    expect(searchQuery).toHaveBeenCalledTimes(1);
    expect(keys.renewals).toEqual([]);
  });
});

describe("an option's details", () => {
  it("renews a refused token and sends the lookup once more; a pasted key sends it once", async () => {
    const snapshot = fixtureSnapshot();
    const row = snapshot.rows[0]!;
    const workspace = { getState: () => ({ displayedSnapshot: snapshot, previousSnapshot: null }), history: () => [snapshot] };
    const keys: string[] = [];
    const getTrips = vi.fn(async (_o: unknown, key: string | null) => {
      keys.push(String(key));
      return key === "new" ? { ok: true as const, value: { trips: [], booking_links: [], api_calls_used: 1 } as never } : refused();
    });
    const details = createDetailService({ workspace, getTrips, readKey: async () => "old", renewKey: async () => "new", now: () => new Date() });
    expect((await details.load({ snapshotId: snapshot.id, rowKey: row.key })).kind).toBe("loaded");
    expect(keys).toEqual(["old", "new"]);
    const once = vi.fn(async () => refused());
    const keyed = createDetailService({ workspace, getTrips: once, readKey: async () => "pasted", now: () => new Date() });
    expect((await keyed.load({ snapshotId: snapshot.id, rowKey: row.key })).kind).toBe("failed");
    expect(once).toHaveBeenCalledTimes(1);
  });

  it("forgets loaded itineraries past the short-term limit, and on clear(); a load that ends after clear() keeps nothing", async () => {
    const snapshot = fixtureSnapshot();
    const ref = { snapshotId: snapshot.id, rowKey: snapshot.rows[0]!.key };
    const workspace = { getState: () => ({ displayedSnapshot: snapshot, previousSnapshot: null }), history: () => [snapshot] };
    let now = Date.parse("2026-10-06T12:00:00Z");
    const getTrips = vi.fn(async () => ({ ok: true as const, value: { trips: [], booking_links: [], api_calls_used: 1 } as never }));
    const details = createDetailService({ workspace, getTrips, readKey: async () => "k", now: () => new Date(now), maxAgeMs: 24 * 3600_000 });
    await details.load(ref);
    expect(details.peek(ref)).not.toBeNull();
    now += 24 * 3600_000 + 1;
    expect(details.peek(ref)).toBeNull();
    await details.load(ref);
    expect(getTrips).toHaveBeenCalledTimes(2);
    details.clear();
    expect(details.peek(ref)).toBeNull();
    let release: () => void = () => {};
    const slow = createDetailService({
      workspace,
      getTrips: () => new Promise((resolve) => (release = () => resolve({ ok: true, value: { trips: [], booking_links: [], api_calls_used: 1 } as never }))),
      readKey: async () => "k",
      now: () => new Date(now),
    });
    const pending = slow.load(ref);
    await vi.waitFor(() => expect(slow.pending(ref)).not.toBeNull());
    slow.clear();
    release();
    expect((await pending).kind).toBe("loaded");
    expect(slow.peek(ref)).toBeNull();
  });
});

describe("the watch runner", () => {
  const NOW = new Date("2026-10-06T12:00:00Z");
  function watch(over: Partial<Watch> = {}): Watch {
    return { id: "w1", name: "HKG to SEA", text: "HKG to SEA next 30 days business", lastCheckedAt: null, baseline: [], dropThresholdPct: 10, enabled: true, createdAt: NOW.toISOString(), ...over };
  }
  const engine = (answer: (key: string | null) => ApiResult<FindValue>) => ({
    search: vi.fn(async (_t: string, key: string | null) => answer(key)),
    searchQuery: vi.fn(async (_q: QueryObject, key: string | null) => answer(key)),
    quotaView: async () => ({ used: 0, remaining: 900, softLimit: 950, resetAt: NOW.toISOString() }),
  });
  const grid = { cells: [] } as unknown as FindValue["grid"];
  const ok = (): ApiResult<FindValue> => ({ ok: true, value: { grid, query: { date_from: "2026-10-06", date_to: "2026-11-05" } } as unknown as FindValue });

  it("renews a refused token once per run and checks the watch again with it", async () => {
    const store = new WatchStore();
    store.restore({ version: 2, watches: [watch(), watch({ id: "w2", text: "LAX to NRT next month" })] });
    const e = engine((key) => (key === "new" ? ok() : refused()));
    const renewKey = vi.fn(async () => "new");
    const results = await checkWatches({ engine: e, store, apiKey: "old", now: () => NOW, renewKey });
    expect(results.map((r) => r.outcome.status)).toEqual(["checked", "checked"]);
    expect(renewKey).toHaveBeenCalledTimes(1);
    expect(e.search.mock.calls.map((c) => c[1])).toEqual(["old", "new", "new"]);
  });

  it("without renewKey (a pasted key) a refusal is recorded after one send, as before", async () => {
    const store = new WatchStore();
    store.restore({ version: 2, watches: [watch()] });
    const e = engine(() => refused());
    const [result] = await checkWatches({ engine: e, store, apiKey: "pasted", now: () => NOW });
    expect(result!.outcome.status).toBe("failed");
    expect(e.search).toHaveBeenCalledTimes(1);
    expect(store.get("w1")!.lastResult).toMatchObject({ status: "failed", refused: true });
  });

  it("a baseline older than the short-term limit is not compared against: the check sets a new one and reports nothing", async () => {
    const old = new Date(NOW.getTime() - 25 * 3600_000).toISOString();
    const recent = new Date(NOW.getTime() - 3600_000).toISOString();
    const stale = watch({ lastCheckedAt: old, lastAttemptAt: old, baseline: [], baselineWindow: null });
    expect(baselineExpired(stale, NOW, 24 * 3600_000)).toBe(true);
    expect(baselineExpired({ lastCheckedAt: recent }, NOW, 24 * 3600_000)).toBe(false);
    expect(baselineExpired(stale, NOW, null)).toBe(false);
    const store = new WatchStore();
    store.restore({ version: 2, watches: [stale] });
    const [result] = await checkWatches({ engine: engine(() => ok()), store, apiKey: "k", now: () => NOW, baselineMaxAgeMs: 24 * 3600_000 });
    expect(result!.firstCheck).toBe(true);
    expect(store.get("w1")!.lastResult).toMatchObject({ status: "checked", firstCheck: true, compared: null });
    expect(store.get("w1")!.unseen ?? null).toBeNull();
  });
});
