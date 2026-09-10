/**
 * The spend arithmetic and the fetch guard behind it.
 *
 * planSearchSpend is pure, so most cases are tables. The two cases that motivated the arithmetic also run against
 * the real runFind over the recorded fixture, because what matters is what runFind then spends: a pull that wants
 * more pages, and a result with pairs that have no rows, are the two ways runFind spends past a naive cap
 * (find.ts:327, :366-368). No network, and every clock is injected.
 */
import { describe, expect, it } from "vitest";
import { QueryObject, type QueryObjectInput } from "../query/schema";
import { InMemoryAvailabilityCache } from "../seatsaero/cache";
import { SeatsAeroNetworkError } from "../seatsaero/client";
import { planFind, runFind } from "../seatsaero/find";
import { InMemoryQuotaStore, Quota } from "../seatsaero/quota";
import { RoutesCatalog } from "../seatsaero/routes";
import type { SearchResponse } from "../seatsaero/types";
import { fakeFetch, jsonResponse, loadFixture, textResponse } from "../../../test/fixtures/seatsaero/helpers";
import {
  SeatsBudgetExceededError,
  createSeatsBudgetGuard,
  planFlightsSpend,
  planSearchSpend,
  seatsAllowance,
  type SearchSpendPlan,
} from "./budget";
import { ASK_QUOTA_RESERVE, QUESTION_SEATS_CALL_CAP, SEARCH_PAGE_CAP, SEARCH_ROUTES_CAP } from "./limits";

const KEY = "pro_key_for_budget_tests_SECRET";
const USER = "local";
const NOW = new Date("2023-08-10T12:00:00Z");

/** 42 recorded availabilities, SFO to JFK, LHR and EWR, 2023-08-11 to 2023-08-17. NRT has none. */
const recorded = loadFixture<SearchResponse>("search.json");
/** The same page, claiming there is always another: a pull that wants more pages than any cap. */
const endless: SearchResponse = { ...recorded, hasMore: true };

function query(over: Partial<QueryObjectInput> = {}): QueryObject {
  return QueryObject.parse({
    origins: ["SFO"],
    destinations: ["JFK", "NRT"],
    date_from: "2023-08-11",
    date_to: "2023-08-17",
    cabins: ["J"],
    raw_text: "",
    language: "en",
    ...over,
  });
}

/** seats.aero behind a fake fetch: `search` for Cached Search, and no monitored routes for any program. */
function seatsAero(search: SearchResponse) {
  return fakeFetch((req) => {
    if (req.url.pathname === "/partnerapi/search") return jsonResponse(search);
    if (req.url.pathname === "/partnerapi/routes") return jsonResponse([]);
    return textResponse("not found", 404);
  });
}

function stores() {
  return {
    quota: new Quota({ store: new InMemoryQuotaStore(), now: () => NOW }),
    cache: new InMemoryAvailabilityCache(),
    routes: new RoutesCatalog({ now: () => NOW }),
  };
}

function ran(plan: SearchSpendPlan): Extract<SearchSpendPlan, { run: true }> {
  if (!plan.run) throw new Error(`expected a plan that runs, got ${JSON.stringify(plan)}`);
  return plan;
}

describe("seatsAllowance", () => {
  it.each([
    { questionSpent: 0, quotaRemaining: 950, allowance: 12 },
    { questionSpent: 10, quotaRemaining: 950, allowance: 2 },
    { questionSpent: 12, quotaRemaining: 950, allowance: 0 },
    { questionSpent: 0, quotaRemaining: 30, allowance: 5 },
    { questionSpent: 9, quotaRemaining: 30, allowance: 3 },
    { questionSpent: 0, quotaRemaining: 26, allowance: 1 },
    { questionSpent: 0, quotaRemaining: 25, allowance: 0 },
    { questionSpent: 0, quotaRemaining: 3, allowance: 0 },
  ])("question spent $questionSpent, $quotaRemaining left today: $allowance", ({ questionSpent, quotaRemaining, allowance }) => {
    expect(seatsAllowance({ questionSpent, quotaRemaining }).allowance).toBe(allowance);
    // The rule itself: min(question calls left, remaining − reserve), floored at zero.
    expect(allowance).toBe(Math.max(0, Math.min(QUESTION_SEATS_CALL_CAP - questionSpent, quotaRemaining - ASK_QUOTA_RESERVE)));
  });

  it("reports both halves, neither below zero", () => {
    expect(seatsAllowance({ questionSpent: 14, quotaRemaining: 3 })).toEqual({ allowance: 0, questionLeft: 0, reserveLeft: 0 });
    expect(seatsAllowance({ questionSpent: 5, quotaRemaining: 40 })).toEqual({ allowance: 7, questionLeft: 7, reserveLeft: 15 });
  });
});

describe("planSearchSpend", () => {
  it("25 left today is quota_reserve, even for a search the cache could answer", () => {
    for (const covered of [false, true]) {
      expect(planSearchSpend({ covered, estimate: 1, allowance: 12, quotaRemaining: 25 })).toEqual({
        run: false,
        refuse: "quota_reserve",
        quotaRemaining: 25,
        estimate: null,
      });
    }
  });

  it("a question with no calls left is limit_reached, even for a search the cache could answer", () => {
    for (const covered of [false, true]) {
      expect(planSearchSpend({ covered, estimate: 1, allowance: 0, quotaRemaining: 950 })).toEqual({ run: false, refuse: "limit_reached" });
    }
  });

  it("a covered search runs with one page and no Get Routes call, guarded at the allowance, however wide it is", () => {
    expect(planSearchSpend({ covered: true, estimate: 18, allowance: 7, quotaRemaining: 950 })).toEqual({ run: true, maxPages: 1, maxRoutesCalls: 0, guard: 7 });
  });

  it("an estimate that would reach into the reserve is quota_reserve, with the estimate", () => {
    expect(planSearchSpend({ covered: false, estimate: 3, allowance: 2, quotaRemaining: 27 })).toEqual({
      run: false,
      refuse: "quota_reserve",
      quotaRemaining: 27,
      estimate: 3,
    });
  });

  it("12 left: 3 pages and 1 Get Routes call, whatever the estimate up to the page cap", () => {
    for (const estimate of [1, 2, 3]) {
      expect(planSearchSpend({ covered: false, estimate, allowance: 12, quotaRemaining: 950 })).toEqual({ run: true, maxPages: 3, maxRoutesCalls: 1, guard: 4 });
    }
  });

  it("an estimate above the page cap is too_wide, whatever the question has left", () => {
    expect(planSearchSpend({ covered: false, estimate: SEARCH_PAGE_CAP + 1, allowance: 12, quotaRemaining: 950 })).toEqual({
      run: false,
      refuse: "too_wide",
      estimate: 4,
      allowance: 12,
      overPageCap: true,
    });
  });

  it("an estimate above what the question has left is too_wide", () => {
    expect(planSearchSpend({ covered: false, estimate: 3, allowance: 2, quotaRemaining: 950 })).toEqual({
      run: false,
      refuse: "too_wide",
      estimate: 3,
      allowance: 2,
      overPageCap: false,
    });
  });

  it("an allowance larger than what sits above the reserve now is held to the reserve", () => {
    expect(planSearchSpend({ covered: false, estimate: 1, allowance: 12, quotaRemaining: 27 })).toEqual({ run: true, maxPages: 2, maxRoutesCalls: 0, guard: 2 });
    expect(planSearchSpend({ covered: true, estimate: 1, allowance: 12, quotaRemaining: 27 })).toEqual({ run: true, maxPages: 1, maxRoutesCalls: 0, guard: 2 });
  });

  it("2 calls left, estimate 1, a pull that wants more pages: maxPages 2, maxRoutesCalls 0, and runFind spends 2", async () => {
    const q = query();
    expect(planFind(q).estimated_calls).toBe(1);
    const plan = ran(planSearchSpend({ covered: false, estimate: 1, allowance: 2, quotaRemaining: 950 }));
    expect(plan).toEqual({ run: true, maxPages: 2, maxRoutesCalls: 0, guard: 2 });

    const inner = seatsAero(endless);
    const guard = createSeatsBudgetGuard(inner, plan.guard);
    const s = stores();
    const res = await runFind({
      query: q,
      userId: USER,
      apiKey: KEY,
      fetch: guard.fetch,
      ...s,
      now: () => NOW,
      ttlMinutes: 45,
      maxPages: plan.maxPages,
      maxRoutesCalls: plan.maxRoutesCalls,
    });

    // Every page said there was more, and SFO-NRT came back empty: both ways past a naive cap, and neither taken.
    expect(res.notices.map((n) => n.code)).toEqual(["find.truncated_search", "find.routes_skipped"]);
    expect(res.api_calls_used).toBe(2);
    expect([guard.sent(), guard.refused()]).toEqual([2, 0]);
    expect(inner.calls.map((c) => c.url.pathname)).toEqual(["/partnerapi/search", "/partnerapi/search"]);
    expect(await s.quota.used(USER)).toBe(2);
  });

  it("3 calls left, estimate 2, a pair with no rows: maxRoutesCalls 0, so runFind makes no Get Routes call", async () => {
    // 2 pairs × 82 days × 26 programs × 2 cabins × ROW_DENSITY 0.15 ≈ 1,279 rows: two pages.
    const q = query({ date_to: "2023-10-31", cabins: ["J", "F"] });
    expect(planFind(q).estimated_calls).toBe(2);
    const plan = ran(planSearchSpend({ covered: false, estimate: 2, allowance: 3, quotaRemaining: 950 }));
    expect(plan).toEqual({ run: true, maxPages: 3, maxRoutesCalls: 0, guard: 3 });

    const inner = seatsAero(recorded);
    const guard = createSeatsBudgetGuard(inner, plan.guard);
    const res = await runFind({
      query: q,
      userId: USER,
      apiKey: KEY,
      fetch: guard.fetch,
      ...stores(),
      now: () => NOW,
      ttlMinutes: 45,
      maxPages: plan.maxPages,
      maxRoutesCalls: plan.maxRoutesCalls,
    });
    expect(res.notices.map((n) => n.code)).toEqual(["find.routes_skipped"]);
    expect(inner.calls.map((c) => c.url.pathname)).toEqual(["/partnerapi/search"]);
    expect([guard.sent(), guard.refused()]).toEqual([1, 0]);

    // Why the cap is passed at all: left to its default, the same run spends a Get Routes call per program.
    const uncapped = seatsAero(recorded);
    const spent = await runFind({ query: q, userId: USER, apiKey: KEY, fetch: uncapped, ...stores(), now: () => NOW, ttlMinutes: 45, maxPages: plan.maxPages });
    expect(spent.api_calls_used).toBeGreaterThan(plan.guard);
  });

  it("whatever the inputs, a plan that runs fits the allowance, the reserve and the caps", () => {
    let runs = 0;
    let refusals = 0;
    for (const covered of [false, true]) {
      for (let allowance = 0; allowance <= QUESTION_SEATS_CALL_CAP; allowance++) {
        for (const quotaRemaining of [0, 24, 25, 26, 27, 28, 30, 37, 950]) {
          for (let estimate = 1; estimate <= 6; estimate++) {
            const plan = planSearchSpend({ covered, estimate, allowance, quotaRemaining });
            if (!plan.run) {
              refusals += 1;
              continue;
            }
            runs += 1;
            const ceiling = Math.min(allowance, quotaRemaining - ASK_QUOTA_RESERVE);
            expect(plan.maxPages + plan.maxRoutesCalls).toBeLessThanOrEqual(plan.guard);
            expect(plan.guard).toBeLessThanOrEqual(ceiling);
            expect(plan.maxPages).toBeGreaterThanOrEqual(1);
            expect(plan.maxPages).toBeLessThanOrEqual(SEARCH_PAGE_CAP);
            expect(plan.maxRoutesCalls).toBeLessThanOrEqual(SEARCH_ROUTES_CAP);
            if (!covered) expect(plan.maxPages).toBeGreaterThanOrEqual(estimate);
          }
        }
      }
    }
    expect(runs).toBeGreaterThan(100);
    expect(refusals).toBeGreaterThan(100);
  });
});

describe("planFlightsSpend", () => {
  it("is the search rules with an estimate of one call, guarded at one", () => {
    expect(planFlightsSpend({ allowance: 12, quotaRemaining: 950 })).toEqual({ run: true, guard: 1 });
    expect(planFlightsSpend({ allowance: 1, quotaRemaining: 26 })).toEqual({ run: true, guard: 1 });
    expect(planFlightsSpend({ allowance: 0, quotaRemaining: 950 })).toEqual({ run: false, refuse: "limit_reached" });
    expect(planFlightsSpend({ allowance: 12, quotaRemaining: 25 })).toEqual({ run: false, refuse: "quota_reserve", quotaRemaining: 25, estimate: null });
  });
});

describe("createSeatsBudgetGuard", () => {
  it("lets exactly n seats.aero requests out and refuses request n+1 before calling the transport", async () => {
    const inner = fakeFetch(() => jsonResponse({ data: [] }));
    const guard = createSeatsBudgetGuard(inner, 2);

    await guard.fetch("https://seats.aero/partnerapi/search?origin_airport=SFO");
    await guard.fetch(new URL("https://seats.aero/partnerapi/routes?source=united"));
    await expect(guard.fetch(new Request("https://seats.aero/partnerapi/trips/abc"))).rejects.toBeInstanceOf(SeatsBudgetExceededError);
    // Case and a default port do not hide the host.
    await expect(guard.fetch("HTTPS://Seats.Aero:443/partnerapi/search")).rejects.toThrow("This tool call was allowed 2 seats.aero requests and has sent them all.");

    expect(inner.calls.map((c) => c.url.pathname)).toEqual(["/partnerapi/search", "/partnerapi/routes"]);
    expect([guard.sent(), guard.refused()]).toEqual([2, 2]);
  });

  it("passes every other URL through, uncounted, before and after the allowance is spent", async () => {
    const inner = fakeFetch(() => jsonResponse({}));
    const guard = createSeatsBudgetGuard(inner, 1);
    const others = ["https://api.anthropic.com/v1/messages", "http://127.0.0.1:4597/partnerapi/search", "https://seats.aero.example.com/partnerapi/search"];

    for (const url of others) await guard.fetch(url);
    await guard.fetch("https://seats.aero/partnerapi/search");
    for (const url of others) await guard.fetch(url);
    await expect(guard.fetch("https://seats.aero/partnerapi/search")).rejects.toBeInstanceOf(SeatsBudgetExceededError);

    expect(inner.calls).toHaveLength(2 * others.length + 1);
    expect([guard.sent(), guard.refused()]).toEqual([1, 1]);
  });

  it("an allowance of 0 refuses the first seats.aero request", async () => {
    const inner = fakeFetch(() => jsonResponse({}));
    const guard = createSeatsBudgetGuard(inner, 0);
    await expect(guard.fetch("https://seats.aero/partnerapi/search")).rejects.toThrow("This tool call was allowed 0 seats.aero requests and has sent them all.");
    expect(inner.calls).toHaveLength(0);
  });

  it("inside runFind a refusal arrives as a network error, refused() tells the two apart, and the local quota is charged one call that never left", async () => {
    const inner = seatsAero(endless);
    const guard = createSeatsBudgetGuard(inner, 1);
    const s = stores();

    const err = await runFind({ query: query(), userId: USER, apiKey: KEY, fetch: guard.fetch, ...s, now: () => NOW, ttlMinutes: 45, maxPages: 3, maxRoutesCalls: 0 }).catch(
      (e: unknown) => e,
    );

    // SeatsAeroClient wraps any transport rejection (client.ts:326-330) ...
    expect(err).toBeInstanceOf(SeatsAeroNetworkError);
    expect((err as Error).message).toContain(new SeatsBudgetExceededError(1).message);
    expect(inner.calls).toHaveLength(1);
    expect([guard.sent(), guard.refused()]).toEqual([1, 1]);
    // ... and still reports the refused request to runFind's listener (client.ts:349-352), so the local count is one
    // above what went out. It errs toward spending less; the tool's own count comes from guard.sent().
    expect(await s.quota.used(USER)).toBe(2);
  });
});
