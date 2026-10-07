/**
 * "Today" is the day on this device's calendar (PR-D, app/local-date.ts), not UTC's. The case that broke: 22:53 in
 * California on 6 October 2026 is already 05:53 UTC on the 7th, so "next 14 days" searched 7 to 20 October, sample
 * data started on the 7th, and a watch ending on the 6th was skipped as past. Each block below pins the zone
 * (vitest.config.ts pins UTC for every file) and runs the app's own code at that instant: the search, the sample
 * transport and sample mode, and the watch runner.
 */
import { describe, expect, it, vi } from "vitest";
import { fakeFetch, jsonResponse } from "@awardgrid/core/test-fixtures/seatsaero/helpers";
import { fixtureQuery } from "@awardgrid/core/test-fixtures/uiux/factory";
import { Quota } from "@awardgrid/core/seatsaero/quota";
import type { Watch } from "@awardgrid/core/watch";
import { draftFromQuery, textReproducesQuery } from "@awardgrid/core/workspace/query-editor";
import { draftForWatch } from "@awardgrid/core/workspace/watch-migration";
import { SearchEngine } from "../search/search";
import { DeviceQuotaStore } from "../store/quota-store";
import { WatchStore } from "../store/watch-store";
import { MemoryFileStore, SnapshotStore } from "../store/persistence";
import { createSampleFetch } from "../sample/sample-fetch";
import { enterSampleData } from "../sample/boot";
import { inTimeZone } from "../test-support/time-zone";
import { checkWatches } from "../watch/runner";
import { bootstrap } from "./bootstrap";
import { resolveBoot } from "./data-source";
import { localDate, localDateOf } from "./local-date";

/** 22:53 on Tuesday 6 October 2026 in Los Angeles (PDT, UTC-7): 05:53 on the 7th in UTC. */
const EVENING_LA = new Date("2026-10-07T05:53:00.000Z");
const KEY = "pro_test_key_ABC123xyz_DO_NOT_LEAK";

/** A fake seats.aero: no routes, and one HKG→SEA business row on every day the request's window asks for. */
function seatsAero() {
  return fakeFetch((req) => {
    if (req.url.pathname.endsWith("/routes")) return jsonResponse([]);
    const from = req.url.searchParams.get("start_date")!;
    const row = {
      ID: `id-${from}`,
      RouteID: "r1",
      Route: { ID: "r1", OriginAirport: "HKG", DestinationAirport: "SEA", Source: "alaska" },
      Date: from,
      ParsedDate: `${from}T00:00:00Z`,
      Source: "alaska",
      JAvailable: true,
      JMileageCost: "80000",
      JRemainingSeats: 2,
      JAirlines: "AS",
      JDirect: true,
      YAvailable: false,
      WAvailable: false,
      FAvailable: false,
    };
    return jsonResponse({ data: [row], hasMore: false });
  });
}

function engineAt(now: Date, fetchImpl: typeof fetch = seatsAero()) {
  const clock = () => now;
  return new SearchEngine({ fetchImpl, quota: new Quota({ store: new DeviceQuotaStore(), now: clock }), now: clock });
}

describe("localDate: the calendar day on this device", () => {
  describe("in Los Angeles", () => {
    inTimeZone("America/Los_Angeles");
    it("22:53 on the 6th is the 6th, though UTC is on the 7th", () => {
      expect(EVENING_LA.toISOString().slice(0, 10)).toBe("2026-10-07");
      expect(localDate(EVENING_LA)).toBe("2026-10-06");
      expect(localDate(new Date("2026-10-07T06:59:59.999Z"))).toBe("2026-10-06");
      expect(localDate(new Date("2026-10-07T07:00:00.000Z"))).toBe("2026-10-07");
      // Across the change back to standard time (1 November 2026, 02:00 PDT): still the day on the wall calendar.
      expect(localDate(new Date("2026-11-01T07:30:00.000Z"))).toBe("2026-11-01");
      expect(localDate(new Date("2026-11-02T07:59:00.000Z"))).toBe("2026-11-01");
    });
    it("a stored instant is read as the day it was made here", () => {
      expect(localDateOf("2026-10-07T05:53:00.000Z")).toBe("2026-10-06");
      expect(localDateOf("not a time")).toBe("not a time");
    });
  });

  describe("in Tokyo, ahead of UTC", () => {
    inTimeZone("Asia/Tokyo");
    it("08:30 on the 7th in Tokyo is the 7th, while UTC is still on the 6th", () => {
      const morning = new Date("2026-10-06T23:30:00.000Z");
      expect(localDate(morning)).toBe("2026-10-07");
    });
  });

  describe("in UTC", () => {
    inTimeZone("UTC");
    it("is UTC's own day", () => {
      expect(localDate(EVENING_LA)).toBe("2026-10-07");
    });
  });
});

describe("a search at 22:53 in Los Angeles", () => {
  inTimeZone("America/Los_Angeles");

  it("reads 'next 14 days' as 6 to 19 October, the person's today included", async () => {
    const plan = await engineAt(EVENING_LA).parsePlan("SFO to NRT next 14 days business");
    expect(plan.ok && plan.value.query).toMatchObject({ date_from: "2026-10-06", date_to: "2026-10-19" });
    // "Before today" is about the person's today too.
    const past = await engineAt(EVENING_LA).parsePlan("SFO to NRT 2026-10-05 to 2026-10-08");
    expect(past.ok && past.value.notices).toEqual([{ code: "parse.start_in_past", vars: { date_from: "2026-10-05", today: "2026-10-06" } }]);
    const today = await engineAt(EVENING_LA).parsePlan("SFO to NRT 2026-10-06 to 2026-10-08");
    expect(today.ok && today.value.notices).toEqual([]);
  });

  it("reads back as itself on the day it was made (SearchScreen's madeOn): Search again re-reads its words, a watch keeps rolling", async () => {
    const text = "HKG to SEA next 14 days business";
    const plan = await engineAt(EVENING_LA).parsePlan(text);
    if (!plan.ok) throw new Error("not read");
    const createdAt = EVENING_LA.toISOString();
    expect(textReproducesQuery(text, plan.value.query, localDateOf(createdAt))).toBe(true);
    expect(draftForWatch(plan.value.query, localDateOf(createdAt)).dates).toEqual({ kind: "relative_days", days: 14, clock: "UTC" });
    // The UTC day of the same instant would have read it as a different search, and frozen the watch's dates.
    expect(textReproducesQuery(text, plan.value.query, createdAt.slice(0, 10))).toBe(false);
    expect(draftForWatch(plan.value.query, createdAt.slice(0, 10)).dates.kind).toBe("fixed");
  });

  it("asks seats.aero for the window from the 6th", async () => {
    const fetchImpl = seatsAero();
    const found = await engineAt(EVENING_LA, fetchImpl).search("HKG to SEA next 14 days business", KEY);
    expect(found.ok).toBe(true);
    const search = fetchImpl.calls.find((c) => c.url.pathname.endsWith("/search"))!;
    expect(search.url.searchParams.get("start_date")).toBe("2026-10-06");
    expect(search.url.searchParams.get("end_date")).toBe("2026-10-19");
  });
});

describe("sample data at 22:53 in Los Angeles", () => {
  inTimeZone("America/Los_Angeles");
  const KEYED = { headers: { "Partner-Authorization": "sample" } };
  const day = (fetchImpl: typeof fetch) => fetchImpl("https://seats.aero/partnerapi/search?origin_airport=HKG&destination_airport=SEA&start_date=2026-10-06&end_date=2026-10-06&take=1000", KEYED);

  it("covers the person's today: the 6th has rows", async () => {
    const res = await day(createSampleFetch({ now: () => EVENING_LA }));
    const body = (await res.json()) as { data: Array<{ Date: string }> };
    expect(body.data.length).toBeGreaterThan(0);
    expect(new Set(body.data.map((r) => r.Date))).toEqual(new Set(["2026-10-06"]));
  });

  it("and so does sample mode's search, end to end", async () => {
    const files = new MemoryFileStore();
    await enterSampleData(files);
    const options = await resolveBoot(
      { snapshots: new SnapshotStore(files), now: () => EVENING_LA, locale: "en", fetchImpl: async () => new Response("{}"), anthropicFetch: async () => new Response("{}") },
      { beforeSwitch: async () => {}, reboot: () => {} },
    );
    const services = await bootstrap(options);
    const found = await services.searchText("Hong Kong to Seattle next 14 days economy");
    expect(found.ok).toBe(true);
    const shown = services.workspace.getState().displayedSnapshot!;
    expect(shown.query).toMatchObject({ date_from: "2026-10-06", date_to: "2026-10-19" });
    expect(shown.rows.some((r) => r.value.date === "2026-10-06")).toBe(true);
    expect(services.dataSource.coverage!.coversDate("2026-10-06", localDate(EVENING_LA))).toBe(true);
  });
});

describe("in UTC the same instant is the 7th (the old behaviour, now only where the device is on UTC)", () => {
  inTimeZone("UTC");
  it("sample data starts on the 7th", async () => {
    const res = await createSampleFetch({ now: () => EVENING_LA })(
      "https://seats.aero/partnerapi/search?origin_airport=HKG&destination_airport=SEA&start_date=2026-10-06&end_date=2026-10-06&take=1000",
      { headers: { "Partner-Authorization": "sample" } },
    );
    expect(((await res.json()) as { data: unknown[] }).data).toEqual([]);
  });
});

describe("watches checked at 22:53 in Los Angeles", () => {
  inTimeZone("America/Los_Angeles");

  function watch(over: Partial<Watch> = {}): Watch {
    return {
      id: "w1",
      name: "HKG to SEA",
      text: "HKG to SEA next 14 days business",
      lastCheckedAt: null,
      baseline: [],
      dropThresholdPct: 10,
      enabled: true,
      createdAt: "2026-09-01T00:00:00.000Z",
      ...over,
    };
  }
  function structured(dates: NonNullable<Watch["draft"]>["dates"]): Watch {
    const query = { ...fixtureQuery(), origins: ["HKG"], destinations: ["SEA"], cabins: ["J" as const], programs: undefined, raw_text: "HKG to SEA next 14 days business" };
    return watch({ draft: { ...draftFromQuery(query), dates } });
  }

  it("a structured watch over the next 14 days runs from the 6th", async () => {
    const store = new WatchStore();
    store.add(structured({ kind: "relative_days", days: 14, clock: "UTC" }));
    const engine = engineAt(EVENING_LA);
    const byQuery = vi.spyOn(engine, "searchQuery");
    const [r] = await checkWatches({ engine, store, apiKey: KEY, now: () => EVENING_LA });
    expect(r!.outcome.status).toBe("checked");
    expect(byQuery.mock.calls[0]![0]).toMatchObject({ date_from: "2026-10-06", date_to: "2026-10-19" });
  });

  it("dates ending today are still checked; dates that ended yesterday are not", async () => {
    const endsToday = new WatchStore();
    endsToday.add(structured({ kind: "fixed", from: "2026-10-01", to: "2026-10-06" }));
    const [today] = await checkWatches({ engine: engineAt(EVENING_LA), store: endsToday, apiKey: KEY, now: () => EVENING_LA });
    expect(today!.outcome.status).toBe("checked");

    const endedYesterday = new WatchStore();
    endedYesterday.add(structured({ kind: "fixed", from: "2026-10-01", to: "2026-10-05" }));
    const engine = engineAt(EVENING_LA);
    const byQuery = vi.spyOn(engine, "searchQuery");
    const [past] = await checkWatches({ engine, store: endedYesterday, apiKey: KEY, now: () => EVENING_LA });
    expect(past!.outcome).toEqual({ status: "skipped", reason: "dates_passed" });
    expect(byQuery).not.toHaveBeenCalled();
  });

  it("a watch still checked by its words reads them on the person's today", async () => {
    const store = new WatchStore();
    store.add(watch());
    const fetchImpl = seatsAero();
    await checkWatches({ engine: engineAt(EVENING_LA, fetchImpl), store, apiKey: KEY, now: () => EVENING_LA });
    const search = fetchImpl.calls.find((c) => c.url.pathname.endsWith("/search"))!;
    expect(search.url.searchParams.get("start_date")).toBe("2026-10-06");
    expect(store.get("w1")!.baselineWindow).toEqual({ date_from: "2026-10-06", date_to: "2026-10-19" });
  });
});
