/**
 * The warning search_awards gives when route lists were skipped names the bound that ran out (docs/PHASE5.md §2.4).
 *
 * runFind words skipped route lists as skipped "to stay within today's quota", the web app's one bound on them. Ask
 * passes its own per-search limit as maxRoutesCalls, so with most of today's calls left that limit is what skipped
 * them, and Claude repeats the reason it reads. Every case runs the real runner, runFind, Quota (over
 * InMemoryQuotaStore), availability cache and routes catalog against the recorded seats.aero search fixture, served by
 * a fake fetch. "Another run spent today's calls" is that run's writes to the same quota store, made while this
 * search's pull is out. The clock is injected, and nothing reaches the network.
 */
import { describe, expect, it } from "vitest";
import { InMemoryAvailabilityCache } from "../seatsaero/cache";
import { InMemoryQuotaStore, Quota } from "../seatsaero/quota";
import { ResilientRoutesCatalog, RoutesCatalog } from "../seatsaero/routes";
import { SEATS_SOURCES, type SearchResponse } from "../seatsaero/types";
import { fakeFetch, jsonResponse, loadFixture, textResponse } from "../../../test/fixtures/seatsaero/helpers";
import { en } from "../i18n/dictionaries/en";
import { ASK_QUOTA_RESERVE, SEARCH_PAGE_CAP, SEARCH_ROUTES_CAP } from "./limits";
import { SEARCH_AWARDS, createToolRunner, type SeatsPort, type ToolRun } from "./tools";

const USER = "local";
const DAY = "2023-08-10";
const NOW = new Date(`${DAY}T12:00:00Z`);

/** Rows for SFO to JFK, LHR and EWR only, so a search to NRT and HND comes back with two empty pairs. */
const recorded = loadFixture<SearchResponse>("search.json");

/** SFO to NRT and HND, 2023-08-11 to 2023-08-17, business: one page, and no rows for either pair. */
const EMPTY_PAIRS = {
  origins: ["SFO"],
  destinations: ["NRT", "HND"],
  date_from: "2023-08-11",
  date_to: "2023-08-17",
  cabins: ["J"],
  programs: null,
  direct_only: false,
  max_miles: null,
};

interface Body {
  spent: { seats_aero_calls: number; from_cache: boolean; question_calls_left: number; today_calls_left: number };
  rows_total: number;
  unmonitored: string[];
  not_read_in_full: string[];
  warnings: string[];
}

/**
 * One device and one question. `usedBefore` is today's count before the question; `spentDuringPull` is what another
 * run adds to it while this search's one page is out.
 */
async function search(opts: { usedBefore?: number; spentDuringPull?: number } = {}) {
  const store = new InMemoryQuotaStore();
  if (opts.usedBefore) await store.increment(USER, DAY, opts.usedBefore);
  const fetch = fakeFetch(async (req) => {
    if (req.url.pathname === "/partnerapi/search") {
      if (opts.spentDuringPull) await store.increment(USER, DAY, opts.spentDuringPull);
      return jsonResponse(recorded);
    }
    if (req.url.pathname === "/partnerapi/routes") return jsonResponse([]);
    return textResponse("not found", 404);
  });
  const now = () => NOW;
  const quota = new Quota({ store, now });
  const port: SeatsPort = {
    userId: USER,
    apiKey: "pro_key_for_routes_warning_tests_SECRET",
    fetch,
    quota,
    cache: new InMemoryAvailabilityCache(),
    routes: new RoutesCatalog({ now }),
    now,
    persist: async () => {},
  };
  const runner = createToolRunner(port, { seenIds: new Set(), bookingUrls: new Set(), flightsMemo: new Map() });
  const run = await runner.run({ id: "toolu_1", name: SEARCH_AWARDS, input: EMPTY_PAIRS });
  const routesCalls = fetch.calls.filter((c) => c.url.pathname === "/partnerapi/routes").length;
  return { run, body: body(run), routesCalls, quota };
}

function body(run: ToolRun): Body {
  expect(run.step.outcome).toBe("ok");
  return JSON.parse(run.result.content as string) as Body;
}

/** runFind's own sentence, as the web app's dictionary words it. */
const webSentence = (pairs: number, skipped: number) =>
  en["notice.find.routes_skipped"].replace("{pairs}", String(pairs)).replace("{skipped}", String(skipped));

describe("search_awards: why route lists were skipped", () => {
  it("pins what the cases rest on: Ask's caps, the 26 programs, and the web app's sentence E2's tool result carried", () => {
    expect([SEARCH_PAGE_CAP, SEARCH_ROUTES_CAP, ASK_QUOTA_RESERVE, SEATS_SOURCES.length]).toEqual([3, 1, 25, 26]);
    expect(webSentence(2, 24)).toBe("Couldn't check whether seats.aero monitors 2 empty pair(s): 24 program route list(s) skipped to stay within today's quota.");
  });

  it("names Ask's per-search limit, not today's quota, when the limit ran out with calls left today", async () => {
    const { body: res, routesCalls } = await search();

    expect(routesCalls).toBe(1);
    expect(res.spent).toMatchObject({ seats_aero_calls: 2, today_calls_left: 948 });
    expect(res.unmonitored).toEqual([]);
    expect(res.warnings).toEqual([
      "Could not check whether seats.aero monitors 2 empty airport pairs: 25 program route lists were skipped because Ask lets one search make at most 1 route list call, not because of today's seats.aero quota.",
    ]);
    expect(res.warnings.join(" ")).not.toContain(webSentence(2, 25));
  });

  it("names today's quota alone when it had no call left for a route list Ask's limit still allowed", async () => {
    // Before the pull: 3 pages reserved of 950. Another run spends 949 while it is out; the pull's unused 2 come back,
    // so runFind reads 0 left when it sizes the route list budget, and makes no Get Routes call.
    const { body: res, routesCalls, quota } = await search({ spentDuringPull: 949 });

    expect(routesCalls).toBe(0);
    expect(await quota.remaining(USER)).toBe(0);
    expect(res.warnings).toEqual(["Could not check whether seats.aero monitors 2 empty airport pairs: 26 program route lists were skipped because today's seats.aero quota had no calls left for them."]);
    expect(res.warnings.join(" ")).not.toContain("Ask lets one search");
  });

  it("names both when Ask's limit ran out and today's quota had no more calls left than the limit", async () => {
    // As above with 948 spent: runFind reads 1 left, spends it on one route list, and Ask's limit is also 1.
    const { body: res, routesCalls, quota } = await search({ spentDuringPull: 948 });

    expect(routesCalls).toBe(1);
    expect(await quota.remaining(USER)).toBe(0);
    expect(res.warnings).toEqual([
      "Could not check whether seats.aero monitors 2 empty airport pairs: 25 program route lists were skipped because Ask lets one search make at most 1 route list call, and today's seats.aero quota had only 1 call left.",
    ]);
  });

  it("a limit lowered to no calls, because the pages took the allowance, never says the quota played no part", async () => {
    // 922 used: 28 left, 3 above the reserve. All 3 go to pages, so maxRoutesCalls is 0 while 27 calls remain today.
    const { body: res, routesCalls } = await search({ usedBefore: 922 });

    expect(routesCalls).toBe(0);
    expect(res.spent).toMatchObject({ seats_aero_calls: 1, today_calls_left: 27 });
    expect(res.warnings).toEqual([
      "Could not check whether seats.aero monitors 2 empty airport pairs: 26 program route lists were skipped because Ask allowed this search no route list calls (the calls it could spend were set aside for its results).",
    ]);
  });

  it("leaves every other warning as runFind wrote it, in its order", async () => {
    // Every page says there is more, so the pull stops at 3 pages before the route lists are sized.
    const endless: SearchResponse = { ...recorded, hasMore: true };
    const store = new InMemoryQuotaStore();
    const fetch = fakeFetch((req) => (req.url.pathname === "/partnerapi/search" ? jsonResponse(endless) : jsonResponse([])));
    const now = () => NOW;
    const runner = createToolRunner(
      { userId: USER, apiKey: "pro_key_for_routes_warning_tests_SECRET", fetch, quota: new Quota({ store, now }), cache: new InMemoryAvailabilityCache(), routes: new RoutesCatalog({ now }), now, persist: async () => {} },
      { seenIds: new Set(), bookingUrls: new Set(), flightsMemo: new Map() },
    );
    const res = body(await runner.run({ id: "toolu_1", name: SEARCH_AWARDS, input: EMPTY_PAIRS }));

    expect(res.warnings).toEqual([
      en["notice.find.truncated_search"].replace("{pages}", "3"),
      "Could not check whether seats.aero monitors 2 empty airport pairs: 25 program route lists were skipped because Ask lets one search make at most 1 route list call, not because of today's seats.aero quota.",
    ]);
  });
});

describe("search_awards: a route list that fails (#89)", () => {
  /** SFO to JFK (rows from american) and NRT (none), american only: the one route list Ask may load fails. */
  const WITH_ROWS = { ...EMPTY_PAIRS, destinations: ["JFK", "NRT"], programs: ["american"] };

  async function failingSearch(routes: RoutesCatalog) {
    const fetch = fakeFetch((req) => {
      if (req.url.pathname === "/partnerapi/search") return jsonResponse(recorded);
      if (req.url.pathname === "/partnerapi/routes") return textResponse("upstream failure", 500);
      return textResponse("not found", 404);
    });
    const now = () => NOW;
    const port: SeatsPort = {
      userId: USER,
      apiKey: "pro_key_for_routes_warning_tests_SECRET",
      fetch,
      quota: new Quota({ store: new InMemoryQuotaStore(), now }),
      cache: new InMemoryAvailabilityCache(),
      routes,
      now,
      persist: async () => {},
    };
    const runner = createToolRunner(port, { seenIds: new Set(), bookingUrls: new Set(), flightsMemo: new Map() });
    return runner.run({ id: "toolu_1", name: SEARCH_AWARDS, input: WITH_ROWS });
  }

  it("keeps the rows it paid for and says which list failed, that the monitor check did not finish, and not the quota", async () => {
    const run = await failingSearch(new ResilientRoutesCatalog({ now: () => NOW }));
    const res = body(run) as Body & { rows: unknown[] };

    expect(res.rows_total).toBeGreaterThan(0);
    expect(res.rows.length).toBeGreaterThan(0);
    // One page and the one route list call, which failed and was still charged.
    expect(res.spent).toMatchObject({ seats_aero_calls: 2, from_cache: false });
    expect(res.unmonitored).toEqual([]);
    expect(res.warnings).toEqual([
      "The route list for american could not be loaded: seats.aero answered with an error, not a quota limit. The rows returned are complete. Whether seats.aero monitors this empty airport pair could not be checked, so no rows there may mean no availability or a route seats.aero does not monitor: SFO-NRT.",
    ]);
    expect(res.warnings.join(" ")).not.toContain(en["notice.find.routes_failed"].split("{programs}")[0]!);
  });

  it("on the base catalog the same failure ends the search with no rows: what #89 was", async () => {
    const run = await failingSearch(new RoutesCatalog({ now: () => NOW }));
    expect(run.step.outcome).toBe("seatsaero_error");
    expect(run.result.is_error).toBe(true);
  });
});
