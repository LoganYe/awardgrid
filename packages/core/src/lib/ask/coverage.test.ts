/**
 * The equivalence pin for askCacheScope and coveredByCache.
 *
 * coverage.ts copies runFind's cache scope, because find.ts is not edited in this phase (find.ts:265-277). A copy can
 * drift, so this file holds it to runFind itself over the recorded Cached Search fixture
 * (test/fixtures/seatsaero/search.json). The scope runFind hands the cache must be askCacheScope's, and after a real
 * pull coveredByCache must answer exactly what runFind then does. No network, and every clock is injected.
 */
import { describe, expect, it, vi } from "vitest";
import { QueryObject, type QueryObjectInput } from "../query/schema";
import { InMemoryAvailabilityCache } from "../seatsaero/cache";
import { runFind } from "../seatsaero/find";
import { InMemoryQuotaStore, Quota } from "../seatsaero/quota";
import { RoutesCatalog } from "../seatsaero/routes";
import type { SearchResponse } from "../seatsaero/types";
import { fakeFetch, jsonResponse, loadFixture, textResponse } from "../../../test/fixtures/seatsaero/helpers";
import { askCacheScope, coveredByCache } from "./coverage";

const KEY = "pro_key_for_coverage_tests_SECRET";
const USER = "local";
/** The day before the recorded fixture's first date (2023-08-11). */
const NOW = new Date("2023-08-10T12:00:00Z");
const TTL = 45;

/** 42 recorded availabilities, SFO to JFK, LHR and EWR, 2023-08-11 to 2023-08-17. */
const recorded = loadFixture<SearchResponse>("search.json");

function query(over: Partial<QueryObjectInput> = {}): QueryObject {
  return QueryObject.parse({
    origins: ["SFO"],
    destinations: ["JFK", "LHR", "EWR"],
    date_from: "2023-08-11",
    date_to: "2023-08-17",
    cabins: ["J", "F"],
    raw_text: "",
    language: "en",
    ...over,
  });
}

const minutesAfter = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

/** One device: the recorded fixture behind a fake fetch, and the stores the tools share with the grid lane. */
function harness() {
  const fetch = fakeFetch((req) => {
    if (req.url.pathname === "/partnerapi/search") return jsonResponse(recorded);
    if (req.url.pathname === "/partnerapi/routes") return jsonResponse([]);
    return textResponse("not found", 404);
  });
  const quota = new Quota({ store: new InMemoryQuotaStore(), now: () => NOW });
  const cache = new InMemoryAvailabilityCache();
  const routes = new RoutesCatalog({ now: () => NOW });
  return {
    fetch,
    cache,
    find: (q: QueryObject, at: Date = NOW, userId = USER) =>
      runFind({ query: q, userId, apiKey: KEY, fetch, quota, cache, routes, now: () => at, ttlMinutes: TTL }),
    covered: (q: QueryObject, at: Date = NOW, userId = USER) => coveredByCache({ query: q, userId, cache, ttlMinutes: TTL, now: () => at }),
  };
}

describe("askCacheScope is the scope runFind hands the cache", () => {
  it.each<[string, Partial<QueryObjectInput>]>([
    ["the grid lane's defaults", {}],
    ["named programs", { programs: ["alaska", "american"] }],
    ["an empty program list, which runFind reads as every program", { programs: [] }],
    ["direct only", { direct_only: true }],
    ["include_filtered", { include_filtered: true }],
    ["min_cabin_pct 70", { min_cabin_pct: 70 }],
  ])("%s, on a pull and on a cache hit", async (_label, over) => {
    const h = harness();
    const q = query(over);
    const deleteRows = vi.spyOn(h.cache, "deleteRows");
    const getRows = vi.spyOn(h.cache, "getRows");

    // A pull replaces its scope (find.ts:356); a hit reads it (find.ts:284). Strict equality, so an absent
    // `programs` cannot pass as `programs: undefined` or `[]`.
    expect((await h.find(q)).served_from_cache).toBe(false);
    expect(deleteRows.mock.calls.map(([, scope]) => scope)).toStrictEqual([askCacheScope(q)]);
    expect((await h.find(q)).served_from_cache).toBe(true);
    expect(getRows.mock.calls.map(([, scope]) => scope)).toStrictEqual([askCacheScope(q)]);
  });
});

describe("coveredByCache answers what runFind then does, after a real pull", () => {
  interface Case {
    name: string;
    pull: Partial<QueryObjectInput>;
    then: Partial<QueryObjectInput>;
    at?: Date;
    userId?: string;
    covered: boolean;
  }

  const cases: Case[] = [
    { name: "the same query", pull: {}, then: {}, covered: true },
    {
      name: "a narrower query: one pair, fewer dates, one cabin, one program",
      pull: {},
      then: { destinations: ["LHR"], date_from: "2023-08-12", date_to: "2023-08-14", cabins: ["J"], programs: ["american"] },
      covered: true,
    },
    { name: "a pair whose pull returned no rows, which coverage still remembers", pull: { destinations: ["BOS"] }, then: { destinations: ["BOS"] }, covered: true },
    { name: "include_filtered after a default pull", pull: {}, then: { include_filtered: true }, covered: false },
    { name: "min_cabin_pct 70 after a 100 pull", pull: {}, then: { min_cabin_pct: 70 }, covered: false },
    { name: "an all-flights query after a direct_only pull", pull: { direct_only: true }, then: {}, covered: false },
    { name: "a direct_only query after an all-flights pull", pull: {}, then: { direct_only: true }, covered: true },
    { name: "a wider date window", pull: {}, then: { date_to: "2023-08-18" }, covered: false },
    { name: "a cabin the pull did not ask for", pull: {}, then: { cabins: ["Y"] }, covered: false },
    { name: "every program after a pull for named programs", pull: { programs: ["american"] }, then: {}, covered: false },
    { name: "one more pair", pull: {}, then: { destinations: ["JFK", "LHR", "EWR", "BOS"] }, covered: false },
    { name: "the same query 45 minutes later, at the TTL", pull: {}, then: {}, at: minutesAfter(45), covered: true },
    { name: "the same query 46 minutes later, past the TTL", pull: {}, then: {}, at: minutesAfter(46), covered: false },
    { name: "the same query for another user", pull: {}, then: {}, userId: "someone-else", covered: false },
  ];

  it.each(cases)("$name: $covered", async ({ pull, then, at, userId, covered }) => {
    const h = harness();
    await h.find(query(pull));
    const q = query(then);

    expect(await h.covered(q, at, userId)).toBe(covered);
    const sent = h.fetch.calls.length;
    const res = await h.find(q, at, userId);
    expect(res.served_from_cache).toBe(covered);
    expect(h.fetch.calls.length === sent).toBe(covered);
  });

  it("an empty cache covers nothing", async () => {
    const h = harness();
    expect(await h.covered(query())).toBe(false);
    expect(h.fetch.calls).toHaveLength(0);
  });
});
