/**
 * The watch runner, against a real SearchEngine and a fake seats.aero, with an injected clock.
 *
 * The fake answers Cached Search with rows inside whatever window the request asks for, so these
 * exercise the real parse -> plan -> fetch -> pivot -> snapshot -> diff path. The cases that only
 * need to prove a watch did NOT reach the network use a stub engine, because "zero calls" is the
 * assertion and a stub makes it exact.
 */
import { describe, expect, it, vi } from "vitest";
import { fakeFetch, jsonResponse, textResponse } from "@awardgrid/core/test-fixtures/seatsaero/helpers";
import { Quota } from "@awardgrid/core/seatsaero/quota";
import type { Watch } from "@awardgrid/core/watch";
import { SearchEngine, type ApiResult, type FindValue, type QuotaSnapshotView } from "../search/search";
import { DeviceQuotaStore } from "../store/quota-store";
import { WatchStore } from "../store/watch-store";
import { checkWatches } from "./runner";

const KEY = "pro_test_key_ABC123xyz_DO_NOT_LEAK";

function watch(over: Partial<Watch> = {}): Watch {
  return {
    id: "w1",
    name: "HKG to SEA",
    text: "HKG to SEA next 30 days business",
    lastCheckedAt: null,
    baseline: [],
    dropThresholdPct: 10,
    enabled: true,
    createdAt: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

function apiRow(date: string, miles = "80000") {
  return {
    ID: `id-${date}-${miles}`,
    RouteID: "r1",
    Route: { ID: "r1", OriginAirport: "HKG", DestinationAirport: "SEA", Source: "alaska" },
    Date: date,
    ParsedDate: `${date}T00:00:00Z`,
    Source: "alaska",
    JAvailable: true,
    JMileageCost: miles,
    JRemainingSeats: 2,
    JAirlines: "AS",
    JDirect: true,
    YAvailable: false,
    WAvailable: false,
    FAvailable: false,
  };
}

/** A clock the test can move, shared by the engine, its quota and the runner. */
function clock(startIso: string) {
  let t = Date.parse(startIso);
  return {
    now: () => new Date(t),
    advanceDays: (d: number) => (t += d * 86_400_000),
    advanceMinutes: (m: number) => (t += m * 60_000),
  };
}

/** A fake seats.aero whose Cached Search returns whichever of `dates` fall inside the request window. */
function seatsAero(dates: () => Array<[string, string?]>) {
  return fakeFetch((req) => {
    if (req.url.pathname.endsWith("/routes")) return jsonResponse([]);
    const from = req.url.searchParams.get("start_date") ?? "0000-00-00";
    const to = req.url.searchParams.get("end_date") ?? "9999-12-31";
    const rows = dates()
      .filter(([d]) => d >= from && d <= to)
      .map(([d, miles]) => apiRow(d, miles));
    return jsonResponse({ data: rows, hasMore: false });
  });
}

function realEngine(fetchImpl: typeof fetch, now: () => Date) {
  return new SearchEngine({ fetchImpl, quota: new Quota({ store: new DeviceQuotaStore(), now }), now });
}

function stubEngine(remaining: number[] = [900]) {
  let i = 0;
  const search = vi.fn(async (): Promise<ApiResult<FindValue>> => {
    throw new Error("stub search must not be called in this test");
  });
  const quotaView = vi.fn(
    async (): Promise<QuotaSnapshotView> => ({
      used: 0,
      remaining: remaining[Math.min(i++, remaining.length - 1)]!,
      softLimit: 950,
      resetAt: "2026-10-02T00:00:00.000Z",
    }),
  );
  return { search, quotaView };
}

describe("checkWatches", () => {
  it("sets a baseline on the first check and reports nothing as changed", async () => {
    const c = clock("2026-10-01T12:00:00.000Z");
    const store = new WatchStore();
    store.add(watch());
    const fetchImpl = seatsAero(() => [["2026-10-05"], ["2026-10-20"]]);

    const [r] = await checkWatches({ engine: realEngine(fetchImpl, c.now), store, apiKey: KEY, now: c.now });

    expect(r!.firstCheck).toBe(true);
    expect(r!.outcome.status).toBe("checked");
    if (r!.outcome.status === "checked") expect(r!.outcome.changed).toBe(false);
    expect(store.get("w1")!.baseline).toHaveLength(2);
    expect(store.get("w1")!.lastCheckedAt).toBe("2026-10-01T12:00:00.000Z");
    expect(store.get("w1")!.baselineWindow).toEqual({ date_from: "2026-10-01", date_to: "2026-10-30" });
  });

  it("reports a seat that appeared on a later check", async () => {
    const c = clock("2026-10-01T12:00:00.000Z");
    const store = new WatchStore();
    store.add(watch());
    let dates: Array<[string, string?]> = [["2026-10-05"]];
    const engine = realEngine(seatsAero(() => dates), c.now);

    await checkWatches({ engine, store, apiKey: KEY, now: c.now });
    c.advanceMinutes(60); // past both the watch TTL and the availability cache TTL
    dates = [["2026-10-05"], ["2026-10-20"]];
    const [r] = await checkWatches({ engine, store, apiKey: KEY, now: c.now });

    expect(r!.firstCheck).toBe(false);
    expect(r!.outcome.status).toBe("checked");
    if (r!.outcome.status === "checked") {
      expect(r!.outcome.changed).toBe(true);
      expect(r!.outcome.diff.new.map((x) => x.key)).toEqual(["alaska|HKG|SEA|2026-10-20|J"]);
    }
  });

  it("re-parses the text each check, so a relative window keeps moving (the web app's issue #47)", async () => {
    const c = clock("2026-10-01T12:00:00.000Z");
    const store = new WatchStore();
    store.add(watch());
    const fetchImpl = seatsAero(() => []);
    const engine = realEngine(fetchImpl, c.now);

    await checkWatches({ engine, store, apiKey: KEY, now: c.now });
    c.advanceDays(100); // long past the 92 days after which a frozen standing query goes silent
    await checkWatches({ engine, store, apiKey: KEY, now: c.now });

    const starts = fetchImpl.calls
      .filter((call) => call.url.pathname.endsWith("/search"))
      .map((call) => call.url.searchParams.get("start_date"));
    expect(starts[0]).toBe("2026-10-01");
    expect(starts.at(-1)).toBe("2027-01-09");
  });

  it("does not cry wolf when dates merely age out of a sliding window", async () => {
    const c = clock("2026-10-01T12:00:00.000Z");
    const store = new WatchStore();
    store.add(watch());
    // The same two seats exist throughout; only the calendar moves.
    const engine = realEngine(seatsAero(() => [["2026-10-05"], ["2026-10-25"]]), c.now);

    await checkWatches({ engine, store, apiKey: KEY, now: c.now });
    c.advanceDays(7); // Oct 5 is now outside "next 30 days"
    const [r] = await checkWatches({ engine, store, apiKey: KEY, now: c.now });

    expect(r!.outcome.status).toBe("checked");
    if (r!.outcome.status === "checked") {
      expect(r!.outcome.diff.dropped).toEqual([]);
      expect(r!.outcome.changed).toBe(false);
    }
  });

  it("skips a watch checked inside the TTL without reaching the network", async () => {
    const engine = stubEngine();
    const store = new WatchStore();
    store.add(watch({ lastCheckedAt: "2026-10-01T11:50:00.000Z" }));
    const [r] = await checkWatches({
      engine,
      store,
      apiKey: KEY,
      now: () => new Date("2026-10-01T12:00:00.000Z"),
    });
    expect(r!.outcome).toEqual({ status: "skipped", reason: "checked_recently" });
    expect(engine.search).not.toHaveBeenCalled();
  });

  it("skips every watch without a key, spending nothing", async () => {
    const engine = stubEngine();
    const store = new WatchStore();
    store.add(watch());
    const [r] = await checkWatches({ engine, store, apiKey: null, now: () => new Date("2026-10-01T12:00:00.000Z") });
    expect(r!.outcome).toEqual({ status: "skipped", reason: "no_key" });
    expect(engine.search).not.toHaveBeenCalled();
  });

  it("never checks a paused watch", async () => {
    const engine = stubEngine();
    const store = new WatchStore();
    store.add(watch({ enabled: false }));
    const [r] = await checkWatches({ engine, store, apiKey: KEY, now: () => new Date("2026-10-01T12:00:00.000Z") });
    expect(r!.outcome).toEqual({ status: "skipped", reason: "disabled" });
    expect(engine.search).not.toHaveBeenCalled();
  });

  it("re-reads quota between watches, so a later watch sees what an earlier one spent", async () => {
    // A stub, deliberately. The first version of this test measured one real check's cost and
    // assumed the next watches would each spend the same. They spent nothing: all three were on
    // the same route, so the second and third were served from the shared availability cache.
    // That is the quota discipline working, not a runner bug — but it means "what a check costs"
    // is not a constant a test can budget against. The property here is the SEQUENCING, so the
    // quota the runner sees is scripted: headroom for the first watch, not for the second.
    const engine = stubEngine([30, 10]);
    engine.search.mockImplementation(
      async () =>
        ({
          ok: true,
          value: { grid: { cells: [] }, query: { date_from: "2026-10-01", date_to: "2026-10-30" } },
        }) as unknown as ApiResult<FindValue>,
    );
    const store = new WatchStore();
    store.add(watch({ id: "a", text: "HKG to SEA next 30 days business" }));
    store.add(watch({ id: "b", text: "SFO to NRT next 30 days business" }));

    const results = await checkWatches({
      engine,
      store,
      apiKey: KEY,
      now: () => new Date("2026-10-01T12:00:00.000Z"),
      minQuota: 25,
    });

    expect(results.map((r) => r.outcome.status)).toEqual(["checked", "skipped"]);
    expect(results[1]!.outcome).toEqual({ status: "skipped", reason: "quota_low" });
    expect(engine.quotaView).toHaveBeenCalledTimes(2); // read again before the second watch
    expect(engine.search).toHaveBeenCalledTimes(1); // and the second never reached seats.aero
  });

  it("leaves the baseline alone on a failed check, and starts the attempt clock so it cannot retry-storm", async () => {
    const c = clock("2026-10-01T12:00:00.000Z");
    const store = new WatchStore();
    const baseline = [{ key: "alaska|HKG|SEA|2026-10-05|J", miles: 80_000, fees_cents: 5_600, seats_left: 2, computed_last_seen: "x" }];
    store.add(watch({ lastCheckedAt: "2026-09-30T00:00:00.000Z", baseline }));
    const engine = realEngine(fakeFetch(() => textResponse("boom", 500)), c.now);

    const [r] = await checkWatches({ engine, store, apiKey: KEY, now: c.now });

    expect(r!.outcome.status).toBe("failed");
    const after = store.get("w1")!;
    expect(after.baseline).toEqual(baseline); // a failure says nothing about availability
    expect(after.lastCheckedAt).toBe("2026-09-30T00:00:00.000Z"); // not reported as "checked"
    expect(after.lastAttemptAt).toBe("2026-10-01T12:00:00.000Z"); // but it did cost a call

    // So the very next open, inside the TTL, does not hit seats.aero again.
    c.advanceMinutes(5);
    const [again] = await checkWatches({ engine, store, apiKey: KEY, now: c.now });
    expect(again!.outcome).toEqual({ status: "skipped", reason: "checked_recently" });
  });
});

describe("changes the user has not seen yet", () => {
  it("survive a later quiet check instead of being erased by it", async () => {
    const c = clock("2026-10-01T12:00:00.000Z");
    const store = new WatchStore();
    store.add(watch());
    let dates: Array<[string, string?]> = [["2026-10-05"]];
    const engine = realEngine(seatsAero(() => dates), c.now);

    await checkWatches({ engine, store, apiKey: KEY, now: c.now }); // baseline
    c.advanceMinutes(60);
    dates = [["2026-10-05"], ["2026-10-20"]];
    await checkWatches({ engine, store, apiKey: KEY, now: c.now }); // finds one new seat
    expect(store.get("w1")!.unseen).toMatchObject({ new: 1, dropped: 0, cheaper: 0 });

    c.advanceMinutes(60);
    await checkWatches({ engine, store, apiKey: KEY, now: c.now }); // nothing changed this time

    // The baseline moved forward twice; the news from the second check must still be there.
    expect(store.get("w1")!.unseen).toMatchObject({ new: 1, dropped: 0, cheaper: 0 });
  });

  it("accumulate across checks, keeping when the first unseen change was found", async () => {
    const c = clock("2026-10-01T12:00:00.000Z");
    const store = new WatchStore();
    store.add(watch());
    let dates: Array<[string, string?]> = [["2026-10-05"]];
    const engine = realEngine(seatsAero(() => dates), c.now);

    await checkWatches({ engine, store, apiKey: KEY, now: c.now });
    c.advanceMinutes(60);
    dates = [["2026-10-05"], ["2026-10-20"]];
    await checkWatches({ engine, store, apiKey: KEY, now: c.now });
    const since = store.get("w1")!.unseen!.since;

    c.advanceMinutes(60);
    dates = [["2026-10-20"]]; // Oct 5 is gone
    await checkWatches({ engine, store, apiKey: KEY, now: c.now });

    expect(store.get("w1")!.unseen).toEqual({ new: 1, dropped: 1, cheaper: 0, since });
  });

  it("are not touched by a failed check, which records the failure separately", async () => {
    const c = clock("2026-10-01T12:00:00.000Z");
    const store = new WatchStore();
    const unseen = { new: 2, dropped: 0, cheaper: 1, since: "2026-09-30T09:00:00.000Z" };
    store.add(watch({ lastCheckedAt: "2026-09-30T09:00:00.000Z", unseen }));
    const engine = realEngine(fakeFetch(() => textResponse("boom", 500)), c.now);

    await checkWatches({ engine, store, apiKey: KEY, now: c.now });

    const after = store.get("w1")!;
    expect(after.unseen).toEqual(unseen);
    expect(after.lastResult).toMatchObject({ status: "failed", at: "2026-10-01T12:00:00.000Z" });
  });

  it("are never created by the first check, which only sets the baseline", async () => {
    const c = clock("2026-10-01T12:00:00.000Z");
    const store = new WatchStore();
    store.add(watch());
    const engine = realEngine(seatsAero(() => [["2026-10-05"], ["2026-10-20"]]), c.now);

    await checkWatches({ engine, store, apiKey: KEY, now: c.now });

    expect(store.get("w1")!.unseen ?? null).toBeNull();
    expect(store.get("w1")!.lastResult).toMatchObject({ status: "checked", firstCheck: true });
  });
});
