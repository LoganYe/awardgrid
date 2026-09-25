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
import { draftFromQuery } from "@awardgrid/core/workspace/query-editor";
import { fixtureQuery } from "@awardgrid/core/test-fixtures/uiux/factory";
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
  // T14: structured watches search by query; the stub refuses that too.
  const searchQuery = vi.fn(async (): Promise<ApiResult<FindValue>> => {
    throw new Error("stub searchQuery must not be called in this test");
  });
  const quotaView = vi.fn(
    async (): Promise<QuotaSnapshotView> => ({
      used: 0,
      remaining: remaining[Math.min(i++, remaining.length - 1)]!,
      softLimit: 950,
      resetAt: "2026-10-02T00:00:00.000Z",
    }),
  );
  return { search, searchQuery, quotaView };
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

describe("structured watches (T14)", () => {
  /** A structured HKG→SEA business watch, the next 30 days, with edits a text could not carry. */
  function structured(over: Partial<Watch> = {}): Watch {
    const query = { ...fixtureQuery(), origins: ["HKG"], destinations: ["SEA"], cabins: ["J" as const], programs: undefined, direct_only: true, min_cabin_pct: 100, raw_text: "HKG to SEA next 30 days business" };
    return watch({ draft: { ...draftFromQuery(query), dates: { kind: "relative_days", days: 30, clock: "UTC" } }, ...over });
  }

  it("runs its structured query for today, not its text read again: edited fields go through, the window moves", async () => {
    const c = clock("2026-10-01T12:00:00.000Z");
    const store = new WatchStore();
    store.add(structured());
    const engine = realEngine(seatsAero(() => [["2026-10-05"]]), c.now);
    const byQuery = vi.spyOn(engine, "searchQuery");
    const byText = vi.spyOn(engine, "search");

    await checkWatches({ engine, store, apiKey: KEY, now: c.now });
    expect(byText).not.toHaveBeenCalled();
    expect(byQuery.mock.calls[0]![0]).toMatchObject({ date_from: "2026-10-01", date_to: "2026-10-30", direct_only: true, min_cabin_pct: 100 });

    c.advanceDays(2);
    await checkWatches({ engine, store, apiKey: KEY, now: c.now });
    expect(byQuery.mock.calls[1]![0]).toMatchObject({ date_from: "2026-10-03", date_to: "2026-11-01" });
  });

  it("fixed dates that have all passed are not checked: nothing is spent, and the reason is said", async () => {
    const engine = stubEngine();
    const store = new WatchStore();
    const draft = { ...structured().draft!, dates: { kind: "fixed" as const, from: "2026-09-01", to: "2026-09-10" } };
    store.add(structured({ draft }));
    const [r] = await checkWatches({ engine, store, apiKey: KEY, now: () => new Date("2026-10-01T12:00:00.000Z") });
    expect(r!.outcome).toEqual({ status: "skipped", reason: "dates_passed" });
    expect(engine.searchQuery).not.toHaveBeenCalled();
  });

  it("a watch under review reads its text, as it always did", async () => {
    const c = clock("2026-10-01T12:00:00.000Z");
    const store = new WatchStore();
    store.add(structured({ review: "dates", text: "HKG to SEA next 30 days business" }));
    const engine = realEngine(seatsAero(() => [["2026-10-05"]]), c.now);
    const byQuery = vi.spyOn(engine, "searchQuery");
    await checkWatches({ engine, store, apiKey: KEY, now: c.now });
    expect(byQuery).not.toHaveBeenCalled();
    expect(store.get("w1")!.lastResult).toMatchObject({ status: "checked" });
  });

  it("first check: a baseline, nothing new, nothing compared; then changes are kept with old and new values; a quiet check keeps them; a failed one changes nothing", async () => {
    const c = clock("2026-10-01T12:00:00.000Z");
    const store = new WatchStore();
    store.add(structured());
    let dates: Array<[string, string?]> = [["2026-10-05", "80000"], ["2026-10-06", "90000"]];
    let fail = false;
    const engine = realEngine(
      fakeFetch((req) => {
        if (fail) return textResponse("boom", 500);
        if (req.url.pathname.endsWith("/routes")) return jsonResponse([]);
        return jsonResponse({ data: dates.map(([d, m]) => apiRow(d, m)), hasMore: false });
      }),
      c.now,
    );

    await checkWatches({ engine, store, apiKey: KEY, now: c.now });
    const first = store.get("w1")!;
    expect(first.unseen ?? null).toBeNull();
    expect(first.unseenChanges ?? null).toBeNull();
    expect(first.lastResult).toMatchObject({ status: "checked", firstCheck: true, compared: null });

    c.advanceMinutes(60);
    dates = [["2026-10-05", "60000"], ["2026-10-07", "70000"]];
    await checkWatches({ engine, store, apiKey: KEY, now: c.now });
    const second = store.get("w1")!;
    expect(second.unseen).toMatchObject({ new: 1, dropped: 1, cheaper: 1 });
    expect(second.unseenChanges!.map((x) => [x.kind, x.key.split("|")[3], x.before?.miles ?? null, x.after?.miles ?? null])).toEqual([
      ["new", "2026-10-07", null, 70000],
      ["cheaper", "2026-10-05", 80000, 60000],
      ["gone", "2026-10-06", 90000, null],
    ]);
    expect(second.lastResult!.compared).toEqual({ date_from: "2026-10-01", date_to: "2026-10-30" });

    c.advanceMinutes(60);
    await checkWatches({ engine, store, apiKey: KEY, now: c.now });
    expect(store.get("w1")!.unseenChanges).toEqual(second.unseenChanges);
    expect(store.get("w1")!.unseen).toEqual(second.unseen);

    c.advanceMinutes(60);
    fail = true;
    const baseline = store.get("w1")!.baseline;
    await checkWatches({ engine, store, apiKey: KEY, now: c.now });
    const failed = store.get("w1")!;
    expect(failed.baseline).toEqual(baseline);
    expect(failed.unseenChanges).toEqual(second.unseenChanges);
    expect(failed.lastResult).toMatchObject({ status: "failed" });
  });

  it("an edit saved while its check is out wins: that check writes nothing, and the next one only sets a baseline (T14 review RUN-01)", async () => {
    const c = clock("2026-10-01T12:00:00.000Z");
    const store = new WatchStore();
    store.add(structured());
    let during: (() => void) | null = null;
    const engine = realEngine(
      fakeFetch((req) => {
        if (req.url.pathname.endsWith("/routes")) return jsonResponse([]);
        during?.();
        during = null;
        return jsonResponse({ data: [apiRow("2026-10-05"), apiRow("2026-10-06")], hasMore: false });
      }),
      c.now,
    );
    await checkWatches({ engine, store, apiKey: KEY, now: c.now });
    c.advanceMinutes(60);
    // What the editor's Save watch writes, while the second check's request is out.
    const edited = { ...store.get("w1")!.draft!, query: { ...store.get("w1")!.draft!.query, cabins: ["F" as const] } };
    during = () => store.update("w1", { draft: edited, baseline: [], baselineWindow: null, lastCheckedAt: null, lastAttemptAt: null, lastResult: null });
    await checkWatches({ engine, store, apiKey: KEY, now: c.now });
    expect(store.get("w1")).toMatchObject({ draft: edited, baseline: [], lastCheckedAt: null, lastResult: null });

    c.advanceMinutes(1);
    await checkWatches({ engine, store, apiKey: KEY, now: c.now });
    const after = store.get("w1")!;
    expect(after.lastResult).toMatchObject({ status: "checked", firstCheck: true });
    expect(after.unseen ?? null).toBeNull();
    expect(after.unseenChanges ?? null).toBeNull();
  });

  it("changes marked seen while a check is out stay seen", async () => {
    const c = clock("2026-10-01T12:00:00.000Z");
    const store = new WatchStore();
    store.add(structured());
    let rows = [apiRow("2026-10-05")];
    let during: (() => void) | null = null;
    const engine = realEngine(
      fakeFetch((req) => {
        if (req.url.pathname.endsWith("/routes")) return jsonResponse([]);
        during?.();
        during = null;
        return jsonResponse({ data: rows, hasMore: false });
      }),
      c.now,
    );
    await checkWatches({ engine, store, apiKey: KEY, now: c.now });
    c.advanceMinutes(60);
    rows = [apiRow("2026-10-05"), apiRow("2026-10-06")];
    await checkWatches({ engine, store, apiKey: KEY, now: c.now });
    expect(store.get("w1")!.unseen).toMatchObject({ new: 1 });

    c.advanceMinutes(60);
    rows = [apiRow("2026-10-05"), apiRow("2026-10-06"), apiRow("2026-10-07")];
    // The Watches screen opens and marks what it shows as seen, while this check is out.
    during = () => store.update("w1", { unseen: null, unseenChanges: null });
    await checkWatches({ engine, store, apiKey: KEY, now: c.now });
    const after = store.get("w1")!;
    expect(after.unseen).toMatchObject({ new: 1, dropped: 0, cheaper: 0 });
    expect(after.unseenChanges!.map((x) => x.key.split("|")[3])).toEqual(["2026-10-07"]);
  });

  it("a watch removed while its check is out is not brought back", async () => {
    const c = clock("2026-10-01T12:00:00.000Z");
    const store = new WatchStore();
    store.add(structured());
    const engine = realEngine(
      fakeFetch((req) => {
        if (req.url.pathname.endsWith("/routes")) return jsonResponse([]);
        store.remove("w1");
        return jsonResponse({ data: [apiRow("2026-10-05")], hasMore: false });
      }),
      c.now,
    );
    await checkWatches({ engine, store, apiKey: KEY, now: c.now });
    expect(store.all()).toEqual([]);
  });

  it("conditions that cannot be run are never replaced by the old text: nothing is sent, the baseline stays, and it says so (T14 review RUN-03)", async () => {
    const engine = stubEngine();
    const store = new WatchStore();
    const damaged = { ...structured().draft!, query: { ...structured().draft!.query, cabins: [] } };
    store.add(structured({ draft: damaged, text: "SFO to NRT next 60 days economy", baseline: [], lastAttemptAt: undefined }));
    const [r] = await checkWatches({ engine, store, apiKey: KEY, now: () => new Date("2026-10-01T12:00:00.000Z") });
    expect(r!.outcome.status).toBe("failed");
    expect(engine.search).not.toHaveBeenCalled();
    expect(engine.searchQuery).not.toHaveBeenCalled();
    const after = store.get("w1")!;
    expect(after.lastResult).toMatchObject({ status: "failed", unresolved: true });
    expect(after.lastAttemptAt).toBeUndefined();
    expect(after.baseline).toEqual([]);
  });

  it("a refused key is said as a refused key", async () => {
    const c = clock("2026-10-01T12:00:00.000Z");
    const store = new WatchStore();
    store.add(structured());
    const engine = realEngine(fakeFetch(() => textResponse("no", 401)), c.now);
    await checkWatches({ engine, store, apiKey: KEY, now: c.now });
    expect(store.get("w1")!.lastResult).toMatchObject({ status: "failed", refused: true });
  });
});
