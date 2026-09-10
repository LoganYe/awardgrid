/**
 * search_awards and get_flights through createToolRunner, over the grid lane's real code.
 *
 * Every case runs the real runFind, runGetTrips, Quota (over InMemoryQuotaStore), availability cache and routes
 * catalog against the recorded seats.aero fixtures (test/fixtures/seatsaero/search.json and trips__id.json), served by
 * a fake fetch that logs every URL. runFind is wrapped in a spy that still calls it, so a case can read the caps each
 * call passed, and every call in this file is checked for them after each case. The clock is injected (2023-08-10,
 * the day before the fixture's first date), and nothing reaches the network.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Cabin, QueryObject } from "../query/schema";
import { InMemoryAvailabilityCache } from "../seatsaero/cache";
import { SeatsAeroClient } from "../seatsaero/client";
import { planFind, runFind } from "../seatsaero/find";
import { InMemoryQuotaStore, Quota, QuotaExceededError } from "../seatsaero/quota";
import { RoutesCatalog } from "../seatsaero/routes";
import { SEATS_SOURCES, type Route, type SearchResponse, type Trip, type TripsResponse } from "../seatsaero/types";
import { fakeFetch, jsonResponse, loadFixture, textResponse, type FakeHandler } from "../../../test/fixtures/seatsaero/helpers";
import { ASK_TOOLS, GET_FLIGHTS, SEARCH_AWARDS, createToolRunner, type FlightTrip, type SeatsPort, type ToolRun, type ToolRunState } from "./tools";

vi.mock("../seatsaero/find", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../seatsaero/find")>();
  return { ...actual, runFind: vi.fn(actual.runFind) };
});

const SEATS_KEY = "pro_key_for_tools_tests_SECRET";
const ANTHROPIC_KEY = "sk-ant-api03-tools-test-key-DO_NOT_LEAK";
const USER = "local";
const NOW = new Date("2023-08-10T12:00:00Z");

/** 42 recorded availabilities, SFO to JFK, LHR and EWR, 2023-08-11 to 2023-08-17, every one with business space. */
const recorded = loadFixture<SearchResponse>("search.json");
/** The same page, claiming there is always another. */
const endless: SearchResponse = { ...recorded, hasMore: true };
/** Three business itineraries, all 70,000 miles, taxes 1290 / 4174 / 1290 in minor units, currency "". */
const tripsFixture = loadFixture<TripsResponse>("trips__id.json");
const PRIMARY_LINK = tripsFixture.booking_links.find((l) => l.primary)!.link;
/** American, SFO-JFK, 2023-08-11: business and first at 33,000 miles. */
const ID = "2QSaUXJ0ZuSVqgrRWqkSlXhnVbS";

interface SearchArgs {
  origins: string[];
  destinations: string[];
  date_from: string;
  date_to: string;
  cabins: string[];
  programs: string[] | null;
  direct_only: boolean;
  max_miles: number | null;
}

type Row = [string, string, string, string, string, number, number, boolean, string, number | null, string | null];

interface SearchBody {
  query: SearchArgs;
  spent: { seats_aero_calls: number; from_cache: boolean; question_calls_left: number; today_calls_left: number };
  rows_total: number;
  cols: string[];
  rows: Row[];
  by_pair: Array<{ pair: string; cabin: string; dates_with_seats: number; min_miles: number; programs: string[] }>;
  unmonitored: string[];
  not_read_in_full: string[];
  warnings: string[];
  notes: string[];
}

interface FlightsBody {
  id: string;
  cabin: string;
  program: string | null;
  spent: { seats_aero_calls: number; question_calls_left: number; today_calls_left: number };
  from_memo?: true;
  booking_url: string | null;
  trips_total: number;
  trips: FlightTrip[];
  notes: string[];
}

interface ErrorBody {
  error: string;
  message: string;
  [numbers: string]: unknown;
}

function searchInput(over: Partial<SearchArgs> = {}): SearchArgs {
  return {
    origins: ["SFO"],
    destinations: ["JFK", "LHR", "EWR"],
    date_from: "2023-08-11",
    date_to: "2023-08-17",
    cabins: ["J"],
    programs: null,
    direct_only: false,
    max_miles: null,
    ...over,
  };
}

/** Twelve airport pairs over 92 days in every cabin: far more pages than one search may pull. */
const WIDE = searchInput({ origins: ["SFO", "LAX", "SEA", "PDX"], date_to: "2023-11-10", cabins: ["Y", "W", "J", "F"] });

function queryOf(args: SearchArgs): QueryObject {
  return QueryObject.parse({ ...args, programs: args.programs ?? undefined, max_miles: args.max_miles ?? undefined, raw_text: "", language: "en" });
}

/** American monitors SFO to JFK, LHR and EWR; no other program monitors anything. */
function routesOf(source: string): Route[] {
  if (source !== "american") return [];
  return ["JFK", "LHR", "EWR"].map((dest) => ({
    ID: `american-SFO-${dest}`,
    OriginAirport: "SFO",
    OriginRegion: "North America",
    DestinationAirport: dest,
    DestinationRegion: dest === "LHR" ? "Europe" : "North America",
    NumDaysOut: 330,
    Distance: 4000,
    Source: "american",
  }));
}

function seatsAero(over: { search?: SearchResponse; trips?: FakeHandler } = {}): FakeHandler {
  return (req, index) => {
    const path = req.url.pathname;
    if (path === "/partnerapi/search") return jsonResponse(over.search ?? recorded);
    if (path === "/partnerapi/routes") return jsonResponse(routesOf(req.url.searchParams.get("source") ?? ""));
    if (path.startsWith("/partnerapi/trips/")) return over.trips ? over.trips(req, index) : jsonResponse(tripsFixture);
    return textResponse("not found", 404);
  };
}

interface HarnessOptions {
  handler?: FakeHandler;
  /** Calls already counted today. */
  used?: number;
  now?: () => Date;
  cache?: InMemoryAvailabilityCache;
  store?: InMemoryQuotaStore;
  state?: ToolRunState;
}

/** One device and one question: the grid lane's stores, a port over them, and a runner. */
async function harness(opts: HarnessOptions = {}) {
  const now = opts.now ?? (() => NOW);
  const store = opts.store ?? new InMemoryQuotaStore();
  if (opts.used) await store.increment(USER, "2023-08-10", opts.used);
  const fetch = fakeFetch(opts.handler ?? seatsAero());
  const quota = new Quota({ store, now });
  const cache = opts.cache ?? new InMemoryAvailabilityCache();
  const routes = new RoutesCatalog({ now });
  const persist = vi.fn(async () => {});
  const port: SeatsPort = { userId: USER, apiKey: SEATS_KEY, fetch, quota, cache, routes, now, persist, secrets: [ANTHROPIC_KEY] };
  const state: ToolRunState = opts.state ?? { seenIds: new Set(), bookingUrls: new Set(), flightsMemo: new Map() };
  const runner = createToolRunner(port, state);
  let n = 0;
  const call = (name: string, input: unknown) => runner.run({ id: `toolu_${++n}`, name, input });
  return { fetch, quota, cache, persist, state, runner, call };
}

type Harness = Awaited<ReturnType<typeof harness>>;

async function spent(h: Harness) {
  return { fetches: h.fetch.calls.length, used: await h.quota.used(USER), persists: h.persist.mock.calls.length };
}

function content<T>(run: ToolRun): T {
  expect(typeof run.result.content).toBe("string");
  return JSON.parse(run.result.content as string) as T;
}

/** A pull the grid lane made, outside the tool, into the same stores. */
async function seedCache(h: Harness, args: SearchArgs) {
  await runFind({ query: queryOf(args), userId: USER, apiKey: SEATS_KEY, fetch: h.fetch, quota: h.quota, cache: h.cache, now: () => NOW, ttlMinutes: 45 });
  vi.mocked(runFind).mockClear();
}

/** A question that has already searched SFO-JFK in business and first, so ID is one it returned. */
async function afterSearch(opts: HarnessOptions = {}) {
  const h = await harness(opts);
  expect((await h.call(SEARCH_AWARDS, searchInput({ destinations: ["JFK"], cabins: ["J", "F"] }))).step.outcome).toBe("ok");
  expect(h.state.seenIds.has(ID)).toBe(true);
  h.persist.mockClear();
  return { h, before: await spent(h) };
}

afterEach(() => {
  // Every runFind call the runner made in the case just run: explicit caps, never runFind's defaults.
  for (const [opts] of vi.mocked(runFind).mock.calls) {
    expect(opts).toMatchObject({ maxPages: expect.any(Number), maxRoutesCalls: expect.any(Number), ttlMinutes: 45 });
  }
});

/** Every JSON object in a schema, with its path. */
function nodes(value: unknown, path = "$"): Array<{ path: string; node: Record<string, unknown> }> {
  if (Array.isArray(value)) return value.flatMap((v, i) => nodes(v, `${path}[${i}]`));
  if (value === null || typeof value !== "object") return [];
  const node = value as Record<string, unknown>;
  return [{ path, node }, ...Object.entries(node).flatMap(([k, v]) => nodes(v, `${path}.${k}`))];
}

describe("ASK_TOOLS", () => {
  it("declares search_awards then get_flights, both strict, with names the API accepts", () => {
    expect(ASK_TOOLS.map((t) => t.name)).toEqual([SEARCH_AWARDS, GET_FLIGHTS]);
    for (const tool of ASK_TOOLS) {
      expect(tool.strict).toBe(true);
      expect(tool.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      expect(tool.input_schema.type).toBe("object");
    }
  });

  it("closes every object and requires every one of its properties, at any depth", () => {
    for (const tool of ASK_TOOLS) {
      const objects = nodes(tool.input_schema).filter(({ node }) => node.type === "object");
      expect(objects.length).toBeGreaterThan(0);
      for (const { path, node } of objects) {
        expect(node.additionalProperties, `${tool.name} ${path}`).toBe(false);
        expect([...(node.required as string[])].sort(), `${tool.name} ${path}`).toEqual(Object.keys(node.properties as object).sort());
      }
    }
  });

  it("uses no keyword a strict schema does not support, and no pattern", () => {
    const banned = new Set(["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "minItems", "maxItems", "pattern"]);
    const found = ASK_TOOLS.flatMap((tool) =>
      nodes(tool.input_schema).flatMap(({ path, node }) => Object.keys(node).filter((k) => banned.has(k)).map((k) => `${tool.name} ${path}.${k}`)),
    );
    expect(found).toEqual([]);
  });

  it("offers exactly seats.aero's programs and the four cabin letters", () => {
    const search = ASK_TOOLS[0]!.input_schema.properties as { programs: { anyOf: [{ items: { enum: string[] } }, { type: string }] }; cabins: { items: { enum: string[] } } };
    const flights = ASK_TOOLS[1]!.input_schema.properties as { cabin: { enum: string[] } };
    expect(search.programs.anyOf[0].items.enum).toEqual([...SEATS_SOURCES]);
    expect(search.programs.anyOf[1]).toEqual({ type: "null" });
    expect(search.cabins.items.enum).toEqual(Cabin.options);
    expect(flights.cabin.enum).toEqual(Cabin.options);
  });

  it("serializes byte-identically when built again, and cannot be changed in place", async () => {
    const bytes = JSON.stringify(ASK_TOOLS);
    vi.resetModules();
    const rebuilt = await import("./tools");
    expect(rebuilt.ASK_TOOLS).not.toBe(ASK_TOOLS);
    expect(JSON.stringify(rebuilt.ASK_TOOLS)).toBe(bytes);

    expect(() => {
      (ASK_TOOLS[0]!.input_schema as { type: string }).type = "array";
    }).toThrow(TypeError);
    expect(() => {
      ASK_TOOLS.push(ASK_TOOLS[0]!);
    }).toThrow(TypeError);
    expect(JSON.stringify(ASK_TOOLS)).toBe(bytes);
  });
});

describe("the runner's results", () => {
  it("returns tool_result blocks keyed to their tool_use, with is_error only on a refusal, in a fixed key order", async () => {
    const h = await harness();
    const ok = await h.runner.run({ id: "toolu_ok", name: SEARCH_AWARDS, input: searchInput() });
    const no = await h.runner.run({ id: "toolu_no", name: SEARCH_AWARDS, input: searchInput({ destinations: ["TOKYO"] }) });

    expect(Object.keys(ok.result)).toEqual(["type", "tool_use_id", "content"]);
    expect(ok.result).toMatchObject({ type: "tool_result", tool_use_id: "toolu_ok" });
    expect(Object.keys(content<object>(ok))).toEqual(["query", "spent", "rows_total", "cols", "rows", "by_pair", "unmonitored", "not_read_in_full", "warnings", "notes"]);

    expect(Object.keys(no.result)).toEqual(["type", "tool_use_id", "content", "is_error"]);
    expect(no.result).toMatchObject({ type: "tool_result", tool_use_id: "toolu_no", is_error: true });
    expect(Object.keys(content<object>(no))).toEqual(["error", "message"]);
  });

  it("never rejects: a store that throws becomes a tool_failed result", async () => {
    class BrokenCoverage extends InMemoryAvailabilityCache {
      override async getCoverage(): Promise<never> {
        throw new Error("coverage store unavailable");
      }
    }
    const h = await harness({ cache: new BrokenCoverage() });
    const run = await h.call(SEARCH_AWARDS, searchInput());
    expect(content<ErrorBody>(run)).toEqual({ error: "tool_failed", message: "awardgrid could not run search_awards: coverage store unavailable.", seats_aero_calls: 0 });
    expect(run.step).toMatchObject({ tool: SEARCH_AWARDS, outcome: "tool_failed", calls: 0 });
  });

  it("an unknown tool gets unknown_tool, counts as a tool call, and spends nothing", async () => {
    const h = await harness();
    const run = await h.call("book_flight", { availability_id: ID });
    expect(content<ErrorBody>(run)).toEqual({
      error: "unknown_tool",
      message: 'awardgrid has no tool named "book_flight". Its tools are search_awards and get_flights.',
    });
    expect(h.runner.usage()).toEqual({ toolCalls: 1, searches: 0, flights: 0, seatsCalls: 0 });
    expect(h.fetch.calls).toHaveLength(0);
  });
});

describe("search_awards refuses before spending anything", () => {
  const thirteen = ["SFO", "LAX", "SEA", "PDX", "SAN", "LAS", "PHX", "DEN", "ORD", "ATL", "DFW", "IAH", "MIA"];

  it.each<{ name: string; input: unknown; code: string; message: string | RegExp }>([
    {
      name: "an unknown place code",
      input: searchInput({ destinations: ["JFK", "TOKYO"] }),
      code: "invalid_place",
      message: "Unknown place code: TOKYO. Use 3-letter airport or metro codes.",
    },
    { name: "13 airport pairs", input: searchInput({ origins: thirteen, destinations: ["JFK"] }), code: "too_wide", message: "Too many airport pairs: 13. One search may cover at most 12." },
    {
      name: "7 origins to TYO, which is 14 pairs once TYO expands to NRT and HND",
      input: searchInput({ origins: thirteen.slice(0, 7), destinations: ["TYO"] }),
      code: "too_wide",
      message: "Too many airport pairs: 14. One search may cover at most 12.",
    },
    { name: "a 93-day window", input: searchInput({ date_to: "2023-11-11" }), code: "invalid_input", message: /date_to: date span 93 days exceeds the 92-day cap/ },
    {
      name: "a window that ended before today",
      input: searchInput({ date_from: "2023-08-01", date_to: "2023-08-09" }),
      code: "invalid_input",
      message: "The dates are before today (2023-08-10).",
    },
    { name: "dates in the wrong order", input: searchInput({ date_from: "2023-08-17", date_to: "2023-08-11" }), code: "invalid_input", message: /date_to must be >= date_from/ },
    { name: "a date that is not a date", input: searchInput({ date_from: "next Tuesday" }), code: "invalid_input", message: /date_from: date must be YYYY-MM-DD/ },
    {
      name: "no origins",
      input: searchInput({ origins: [] }),
      code: "invalid_input",
      message: "origins and destinations each need at least one airport or metro code.",
    },
    { name: "no cabins", input: searchInput({ cabins: [] }), code: "invalid_input", message: /^The search could not be read: cabins: / },
    { name: "a cabin letter that does not exist", input: searchInput({ cabins: ["Z"] }), code: "invalid_input", message: /^The search could not be read: cabins\.0: / },
    { name: "a property the schema does not declare", input: { ...searchInput(), include_filtered: true }, code: "invalid_input", message: /include_filtered/ },
    { name: "text instead of an input object", input: "SFO to Tokyo in business", code: "invalid_input", message: /^The search could not be read: / },
  ])("$name: $code", async ({ input, code, message }) => {
    const h = await harness();
    const run = await h.call(SEARCH_AWARDS, input);

    expect(run.result.is_error).toBe(true);
    const body = content<ErrorBody>(run);
    expect(body.error).toBe(code);
    if (typeof message === "string") expect(body.message).toBe(message);
    else expect(body.message).toMatch(message);
    expect(run.step).toMatchObject({ outcome: code, calls: 0 });
    expect(await spent(h)).toEqual({ fetches: 0, used: 0, persists: 0 });
    expect(runFind).not.toHaveBeenCalled();
  });

  it("upper-cases and expands metro codes, once each, before the search goes out", async () => {
    const h = await harness();
    const res = content<SearchBody>(await h.call(SEARCH_AWARDS, searchInput({ destinations: ["tyo", "NRT", "hnd"] })));
    expect(res.query.destinations).toEqual(["NRT", "HND"]);
    expect(h.fetch.calls[0]!.url.searchParams.get("destination_airport")).toBe("NRT,HND");
  });
});

describe("search_awards spends within the question's budget", () => {
  it("a search wider than one search may pull is too_wide: no call, quota unchanged", async () => {
    const h = await harness();
    const estimate = planFind(queryOf(WIDE)).estimated_calls;
    expect(estimate).toBeGreaterThan(3);

    const run = await h.call(SEARCH_AWARDS, WIDE);
    expect(content<ErrorBody>(run)).toEqual({
      error: "too_wide",
      message: `This search needs about ${estimate} seats.aero calls, more than the 3 one search may spend on results. Narrow the airports, dates, cabins or programs.`,
      estimated_calls: estimate,
      question_calls_left: 12,
    });
    expect(run.step).toMatchObject({ outcome: "too_wide", calls: 0, estimate });
    expect(await spent(h)).toEqual({ fetches: 0, used: 0, persists: 0 });
    expect(runFind).not.toHaveBeenCalled();
  });

  it("the same wide search spends nothing once this device holds it: one page and no Get Routes call allowed, none used", async () => {
    // The grid lane pulled it at NOW; Claude asks 30 minutes later, inside the 45-minute TTL.
    const h = await harness({ now: () => new Date(NOW.getTime() + 30 * 60_000) });
    await seedCache(h, WIDE);
    const before = await spent(h);

    const run = await h.call(SEARCH_AWARDS, WIDE);
    const res = content<SearchBody>(run);
    expect(res.spent).toEqual({ seats_aero_calls: 0, from_cache: true, question_calls_left: 12, today_calls_left: 950 - before.used });
    expect(res.rows.length).toBeGreaterThan(0);
    expect(await spent(h)).toEqual(before);
    expect(run.step).toMatchObject({ outcome: "ok", calls: 0, fromCache: true });
    expect(vi.mocked(runFind).mock.calls.map(([o]) => [o.maxPages, o.maxRoutesCalls, o.ttlMinutes])).toEqual([[1, 0, 45]]);
  });

  it("an uncovered search with the question's 12 calls left gets 3 pages and 1 Get Routes call, over a guarded transport", async () => {
    const h = await harness();
    await h.call(SEARCH_AWARDS, searchInput());
    const [[opts]] = vi.mocked(runFind).mock.calls as [[Parameters<typeof runFind>[0]]];
    expect({ maxPages: opts.maxPages, maxRoutesCalls: opts.maxRoutesCalls, ttlMinutes: opts.ttlMinutes }).toEqual({ maxPages: 3, maxRoutesCalls: 1, ttlMinutes: 45 });
    expect(opts.fetch).not.toBe(h.fetch);
    expect(h.fetch.calls).toHaveLength(1);
  });

  it("with 25 calls left today, a search is quota_reserve before any call", async () => {
    const h = await harness({ used: 925 });
    const run = await h.call(SEARCH_AWARDS, searchInput());
    expect(content<ErrorBody>(run)).toEqual({
      error: "quota_reserve",
      message: "Today's seats.aero quota has 25 calls left, and the last 25 are kept for the person's own searches.",
      today_calls_left: 25,
    });
    expect(await spent(h)).toEqual({ fetches: 0, used: 925, persists: 0 });
    expect(runFind).not.toHaveBeenCalled();
  });

  it("with 27 left today, a search estimated at 3 calls is quota_reserve, and says so", async () => {
    const h = await harness({ used: 923 });
    const args = searchInput({ date_to: "2023-11-10", cabins: ["J", "F"] });
    expect(planFind(queryOf(args)).estimated_calls).toBe(3);
    expect(content<ErrorBody>(await h.call(SEARCH_AWARDS, args))).toEqual({
      error: "quota_reserve",
      message: "Today's seats.aero quota has 27 calls left, and the last 25 are kept for the person's own searches. This search needs about 3.",
      today_calls_left: 27,
      estimated_calls: 3,
    });
    expect(await spent(h)).toEqual({ fetches: 0, used: 923, persists: 0 });
  });

  it("one question spends at most 12 seats.aero calls: a later search is too_wide for what is left, then held to it", async () => {
    const h = await harness({ handler: seatsAero({ search: endless }) });

    // 3 pages, then one Get Routes call for the empty SFO-NRT: 4 each.
    const a = content<SearchBody>(await h.call(SEARCH_AWARDS, searchInput({ destinations: ["JFK", "NRT"] })));
    expect(a.spent).toMatchObject({ seats_aero_calls: 4, question_calls_left: 8 });
    const b = content<SearchBody>(await h.call(SEARCH_AWARDS, searchInput({ destinations: ["LHR", "NRT"] })));
    expect(b.spent).toMatchObject({ seats_aero_calls: 4, question_calls_left: 4 });
    for (const row of a.rows.slice(0, 2)) await h.call(GET_FLIGHTS, { availability_id: row[0], cabin: "J" });
    expect(h.runner.usage().seatsCalls).toBe(10);

    const tooWide = await h.call(SEARCH_AWARDS, searchInput({ date_to: "2023-11-10", cabins: ["J", "F"] }));
    expect(content<ErrorBody>(tooWide)).toEqual({
      error: "too_wide",
      message: "This search needs about 3 seats.aero calls and this question has 2 left. Narrow the airports, dates, cabins or programs.",
      estimated_calls: 3,
      question_calls_left: 2,
    });

    // Estimated at one call: it runs with 2 pages and no Get Routes call, and the endless pull stops there.
    const d = content<SearchBody>(await h.call(SEARCH_AWARDS, searchInput({ origins: ["SEA"], destinations: ["JFK"] })));
    expect(vi.mocked(runFind).mock.lastCall?.[0]).toMatchObject({ maxPages: 2, maxRoutesCalls: 0 });
    expect(d.spent).toMatchObject({ seats_aero_calls: 2, question_calls_left: 0 });
    expect(d.not_read_in_full).toEqual(["SEA-JFK"]);

    const none = await h.call(GET_FLIGHTS, { availability_id: a.rows[2]![0], cabin: "J" });
    expect(content<ErrorBody>(none)).toEqual({ error: "limit_reached", message: "This question has used all 12 of its seats.aero calls.", question_calls_left: 0 });

    expect(h.runner.usage().seatsCalls).toBe(12);
    expect(await h.quota.used(USER)).toBe(12);
    expect(h.fetch.calls.filter((c) => c.url.hostname === "seats.aero")).toHaveLength(12);
  });
});

describe("search_awards failures after the checks passed", () => {
  it("a key seats.aero rejects is seatsaero_key_rejected, and the rejected call is still charged", async () => {
    const h = await harness({ handler: () => textResponse("unauthorized", 401) });
    const run = await h.call(SEARCH_AWARDS, searchInput());
    expect(content<ErrorBody>(run)).toEqual({ error: "seatsaero_key_rejected", message: "seats.aero rejected the person's key.", seats_aero_calls: 1, question_calls_left: 11 });
    expect(await h.quota.used(USER)).toBe(1);
    expect(h.persist).toHaveBeenCalledTimes(1);
    expect(run.step).toMatchObject({ outcome: "seatsaero_key_rejected", calls: 1 });
  });

  it("a quota another run used up between the tool's check and runFind's own is reported as quota, in runFind's words", async () => {
    const h = await harness();
    vi.mocked(runFind).mockImplementationOnce(async () => {
      throw new QuotaExceededError(0, 1, new Date("2023-08-11T00:00:00Z"));
    });
    const run = await h.call(SEARCH_AWARDS, searchInput());
    expect(content<ErrorBody>(run)).toEqual({
      error: "quota",
      message:
        "Today's seats.aero quota is used up: seats.aero daily quota reached: 0 calls left today (this search needs about 1). Quota resets at 2023-08-11T00:00:00.000Z (UTC midnight).",
      seats_aero_calls: 0,
      question_calls_left: 12,
    });
    expect(h.persist).not.toHaveBeenCalled();
  });

  it("if runFind ever sent more than its caps allow, the guard stops it at the plan and the result says so", async () => {
    const h = await harness();
    vi.mocked(runFind).mockImplementationOnce(async (opts) => {
      // A stand-in for a runFind that ignored maxPages: it pages until something stops it.
      const client = new SeatsAeroClient({ apiKey: opts.apiKey, fetch: opts.fetch! });
      for (;;) await client.cachedSearch({ origin_airport: ["SFO"], destination_airport: ["JFK"] });
    });
    const run = await h.call(SEARCH_AWARDS, searchInput());

    expect(content<ErrorBody>(run)).toEqual({ error: "limit_reached", message: "This search stopped after the 4 seats.aero calls it was allowed.", seats_aero_calls: 4, question_calls_left: 8 });
    expect(h.fetch.calls).toHaveLength(4);
    expect(run.step).toMatchObject({ outcome: "limit_reached", calls: 4 });
    expect(h.runner.usage().seatsCalls).toBe(4);
    expect(h.persist).toHaveBeenCalledTimes(1);
  });
});

describe("search_awards results", () => {
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  /** Every business row in the fixture, in the order the tool promises. */
  const business = recorded.data
    .filter((a) => a.JAvailable === true && Number(a.JMileageCost) > 0)
    .map((a) => ({
      id: a.ID,
      pair: `${a.Route.OriginAirport}-${a.Route.DestinationAirport}`,
      date: a.Date,
      program: a.Source,
      miles: Number(a.JMileageCost),
      seen: a.ComputedLastSeen ?? a.UpdatedAt!,
    }))
    .sort((x, y) => x.miles - y.miles || cmp(x.date, y.date) || cmp(x.program, y.program) || cmp(x.pair, y.pair));

  it("returns the 20 cheapest of 42 rows by miles, then date, then program, with ages from the injected clock", async () => {
    const h = await harness();
    const run = await h.call(SEARCH_AWARDS, searchInput());
    const res = content<SearchBody>(run);

    expect(business).toHaveLength(42);
    expect(res.rows_total).toBe(42);
    expect(res.cols).toEqual(["id", "pair", "date", "cabin", "program", "miles", "seats", "direct", "airlines", "age_min", "fees"]);
    expect(res.rows).toHaveLength(20);
    expect(res.rows.map((r) => [r[0], r[1], r[2], r[3], r[4], r[5], r[9]])).toEqual(
      business.slice(0, 20).map((e) => [e.id, e.pair, e.date, "J", e.program, e.miles, Math.floor((NOW.getTime() - Date.parse(e.seen)) / 60_000)]),
    );
    expect(res.rows[0]).toEqual([business[0]!.id, "SFO-JFK", "2023-08-11", "J", "american", 33_000, 0, true, "AA,B6", expect.any(Number), null]);
    expect([...h.state.seenIds].sort()).toEqual(business.slice(0, 20).map((e) => e.id).sort());
    expect(res.by_pair).toEqual(
      ["SFO-JFK", "SFO-LHR", "SFO-EWR"].map((pair) => {
        const group = business.filter((e) => e.pair === pair);
        return {
          pair,
          cabin: "J",
          dates_with_seats: new Set(group.map((e) => e.date)).size,
          min_miles: Math.min(...group.map((e) => e.miles)),
          programs: [...new Set(group.map((e) => e.program))].sort(),
        };
      }),
    );
    expect(res.spent).toEqual({ seats_aero_calls: 1, from_cache: false, question_calls_left: 11, today_calls_left: 949 });
    expect([res.unmonitored, res.not_read_in_full, res.warnings]).toEqual([[], [], []]);
    expect(run.step).toMatchObject({ outcome: "ok", calls: 1, fromCache: false, search: searchInput() });
    expect(h.persist).toHaveBeenCalledTimes(1);
  });

  it("the same rows read ten minutes later, from cache, are exactly ten minutes older", async () => {
    const cache = new InMemoryAvailabilityCache();
    const store = new InMemoryQuotaStore();
    const first = content<SearchBody>(await (await harness({ cache, store })).call(SEARCH_AWARDS, searchInput()));
    const later = await harness({ cache, store, now: () => new Date(NOW.getTime() + 10 * 60_000) });
    const again = content<SearchBody>(await later.call(SEARCH_AWARDS, searchInput()));

    expect(again.spent).toMatchObject({ seats_aero_calls: 0, from_cache: true });
    expect(again.rows.map((r) => r[0])).toEqual(first.rows.map((r) => r[0]));
    expect(again.rows.map((r, i) => (r[9] as number) - (first.rows[i]![9] as number))).toEqual(Array(20).fill(10));
  });

  it("max_miles filters before the 20 are chosen, and the total counts what matched", async () => {
    const h = await harness();
    const res = content<SearchBody>(await h.call(SEARCH_AWARDS, searchInput({ max_miles: 40_000 })));
    const cheap = business.filter((e) => e.miles <= 40_000);
    expect(res.rows_total).toBe(cheap.length);
    expect(res.rows.map((r) => r[0])).toEqual(cheap.slice(0, 20).map((e) => e.id));
    expect(res.query.max_miles).toBe(40_000);
  });

  it("lists a pair seats.aero does not monitor apart from the rows, rather than as no availability", async () => {
    const h = await harness();
    const res = content<SearchBody>(await h.call(SEARCH_AWARDS, searchInput({ destinations: ["JFK", "NRT"], programs: ["american"] })));

    expect(res.unmonitored).toEqual(["SFO-NRT"]);
    expect(res.not_read_in_full).toEqual([]);
    expect(res.rows.every((r) => r[1] === "SFO-JFK" && r[4] === "american")).toBe(true);
    expect(h.fetch.calls.map((c) => c.url.pathname + (c.url.pathname.endsWith("routes") ? c.url.search : ""))).toEqual([
      "/partnerapi/search",
      "/partnerapi/routes?source=american",
    ]);
    expect(res.spent).toMatchObject({ seats_aero_calls: 2, question_calls_left: 10 });
    expect(await h.quota.used(USER)).toBe(2);
  });

  it("lists a pair a truncated pull may not have reached as not_read_in_full, and passes runFind's warnings on", async () => {
    const h = await harness({ handler: seatsAero({ search: endless }) });
    const res = content<SearchBody>(await h.call(SEARCH_AWARDS, searchInput({ destinations: ["JFK", "NRT"] })));

    expect(res.not_read_in_full).toEqual(["SFO-NRT"]);
    // Get Routes was cut to one program of 26, so no pair may be called unmonitored.
    expect(res.unmonitored).toEqual([]);
    expect(res.warnings).toEqual([expect.stringMatching(/3 page/), expect.stringMatching(/skipped/)]);
    expect(h.fetch.calls.map((c) => c.url.pathname)).toEqual(["/partnerapi/search", "/partnerapi/search", "/partnerapi/search", "/partnerapi/routes"]);
    expect(res.spent).toMatchObject({ seats_aero_calls: 4, from_cache: false, question_calls_left: 8 });
  });
});

describe("get_flights", () => {
  it("refuses an id search_awards did not return in this conversation, spending nothing", async () => {
    const { h, before } = await afterSearch();
    // The trips fixture's own availability id is real, but this conversation never returned it.
    for (const id of [tripsFixture.data[0]!.AvailabilityID, "../trips", "x".repeat(65)]) {
      const run = await h.call(GET_FLIGHTS, { availability_id: id, cabin: "J" });
      expect(content<ErrorBody>(run)).toEqual({ error: "unknown_id", message: "get_flights accepts only ids that search_awards returned in this conversation." });
    }
    expect(await spent(h)).toEqual(before);
  });

  it("looks up a returned id with exactly one /trips call, charges one call, and writes the fee to that cabin's row only", async () => {
    const { h, before } = await afterSearch();
    const run = await h.call(GET_FLIGHTS, { availability_id: ID, cabin: "J" });
    const res = content<FlightsBody>(run);

    expect(h.fetch.calls.slice(before.fetches).map((c) => c.url.pathname + c.url.search)).toEqual([`/partnerapi/trips/${ID}`]);
    expect(await h.quota.used(USER)).toBe(before.used + 1);
    expect(h.persist).toHaveBeenCalledTimes(1);

    expect(Object.keys(res)).toEqual(["id", "cabin", "program", "spent", "booking_url", "trips_total", "trips", "notes"]);
    expect(res).toMatchObject({
      id: ID,
      cabin: "J",
      program: "american",
      spent: { seats_aero_calls: 1, question_calls_left: 10, today_calls_left: 950 - before.used - 1 },
      booking_url: PRIMARY_LINK,
      trips_total: 3,
      notes: ["Times are local to each airport.", "Fees with no currency code are assumed to be USD."],
    });
    expect(res.trips[0]).toEqual({
      miles: 70_000,
      fees: "$13",
      seats: 9,
      stops: 1,
      carriers: "CM, TK",
      flights: "CM326, TK800",
      departs: "2024-05-01 13:52",
      arrives: "2024-05-02 16:45",
      segments: [
        { flight: "CM326", from: "CUN", to: "PTY", departs: "2024-05-01 13:52", arrives: "2024-05-01 16:31", aircraft: "739" },
        { flight: "TK800", from: "PTY", to: "IST", departs: "2024-05-01 20:05", arrives: "2024-05-02 16:45", aircraft: "77W" },
      ],
    });
    // Miles, then fees; times airport-local with no Z; no duration, whose unit seats.aero does not document.
    expect(res.trips.map((t) => [t.miles, t.fees, t.departs])).toEqual([
      [70_000, "$13", "2024-05-01 13:52"],
      [70_000, "$13", "2024-05-01 11:52"],
      [70_000, "$42", "2024-05-01 14:00"],
    ]);
    expect(JSON.stringify(res.trips)).not.toMatch(/Z"|duration/i);

    const rows = await h.cache.getRowsBySourceId(USER, ID, { include_filtered: false, min_cabin_pct: 100 });
    expect(rows.map((r) => [r.cabin, r.fees_cents, r.booking_url]).sort((a, b) => cmpCabin(a[0], b[0]))).toEqual([
      ["J", 1_290, PRIMARY_LINK],
      ["F", null, null],
    ]);
    expect([...h.state.bookingUrls]).toEqual([PRIMARY_LINK]);
    expect(run.step).toMatchObject({ tool: GET_FLIGHTS, outcome: "ok", calls: 1, fromMemo: false, program: "american" });
  });

  it("answers the same row and cabin again from the conversation's memo with no call, in this question or the next", async () => {
    const { h } = await afterSearch();
    const first = content<FlightsBody>(await h.call(GET_FLIGHTS, { availability_id: ID, cabin: "J" }));
    const before = await spent(h);

    const run = await h.call(GET_FLIGHTS, { availability_id: ID, cabin: "J" });
    const again = content<FlightsBody>(run);
    expect(await spent(h)).toEqual(before);
    expect(Object.keys(again)).toEqual(["id", "cabin", "program", "spent", "from_memo", "booking_url", "trips_total", "trips", "notes"]);
    expect(again).toEqual({ ...first, spent: { ...first.spent, seats_aero_calls: 0 }, from_memo: true });
    expect(run.step).toMatchObject({ outcome: "ok", calls: 0, fromMemo: true, program: "american" });

    // The next question gets a new runner over the same conversation state.
    const next = createToolRunner(
      { userId: USER, apiKey: SEATS_KEY, fetch: h.fetch, quota: h.quota, cache: h.cache, routes: new RoutesCatalog({ now: () => NOW }), now: () => NOW, persist: h.persist },
      h.state,
    );
    const later = await next.run({ id: "toolu_next", name: GET_FLIGHTS, input: { availability_id: ID, cabin: "J" } });
    expect(content<FlightsBody>(later)).toMatchObject({ trips: first.trips, from_memo: true, spent: { seats_aero_calls: 0, question_calls_left: 12 } });
    expect(await spent(h)).toEqual(before);
  });

  it("returns at most 5 itineraries, only in the cabin asked for, by miles then fees, and counts every one in that cabin", async () => {
    const [a, b, c] = tripsFixture.data as [Trip, Trip, Trip];
    const business = [90_000, 70_000, 80_000, 70_000, 60_000, 75_000, 70_000].map((miles, i) => ({ ...a, ID: `trip-j-${i}`, MileageCost: miles, TotalTaxes: 1_000 + ((i * 700) % 3_000) }));
    const first = [
      { ...b, ID: "trip-f-0", Cabin: "first", MileageCost: 55_000 },
      { ...c, ID: "trip-f-1", Cabin: "first", MileageCost: 50_000 },
    ];
    const mixed: TripsResponse = { ...tripsFixture, data: [...first, ...business] };
    const { h } = await afterSearch({ handler: seatsAero({ trips: () => jsonResponse(mixed) }) });

    const j = content<FlightsBody>(await h.call(GET_FLIGHTS, { availability_id: ID, cabin: "J" }));
    const cheapest = [...business].sort((x, y) => x.MileageCost - y.MileageCost || x.TotalTaxes - y.TotalTaxes).slice(0, 5);
    expect(j.trips_total).toBe(7);
    expect(j.trips.map((t) => [t.miles, t.fees])).toEqual(cheapest.map((t) => [t.MileageCost, `$${Math.round(t.TotalTaxes / 100)}`]));

    const f = content<FlightsBody>(await h.call(GET_FLIGHTS, { availability_id: ID, cabin: "F" }));
    expect(f.trips_total).toBe(2);
    expect(f.trips.map((t) => t.miles)).toEqual([50_000, 55_000]);
  });

  it("another cabin of the same row is its own lookup, and a response with no trip in that cabin writes nothing", async () => {
    const { h, before } = await afterSearch();
    const res = content<FlightsBody>(await h.call(GET_FLIGHTS, { availability_id: ID, cabin: "F" }));
    expect(res).toMatchObject({ cabin: "F", program: "american", trips_total: 0, trips: [], spent: { seats_aero_calls: 1 } });
    expect(await h.quota.used(USER)).toBe(before.used + 1);
    const rows = await h.cache.getRowsBySourceId(USER, ID, { include_filtered: false, min_cabin_pct: 100 });
    expect(rows.every((r) => r.fees_cents === null && r.booking_url === null)).toBe(true);
  });

  it("charges a lookup whose request failed in transit, and says the call may have counted", async () => {
    const { h, before } = await afterSearch({
      handler: seatsAero({
        trips: () => {
          throw new TypeError("The network connection was lost.");
        },
      }),
    });
    const run = await h.call(GET_FLIGHTS, { availability_id: ID, cabin: "J" });

    expect(run.result.is_error).toBe(true);
    expect(content<ErrorBody>(run)).toEqual({
      error: "network",
      message: "The seats.aero request failed: seats.aero trips request failed: The network connection was lost. The call may still have counted toward today's quota.",
      seats_aero_calls: 1,
      question_calls_left: 10,
    });
    expect(await h.quota.used(USER)).toBe(before.used + 1);
    expect(h.persist).toHaveBeenCalledTimes(1);
    expect(run.step).toMatchObject({ outcome: "network", calls: 1 });
    expect(h.state.flightsMemo.size).toBe(0);
  });
});

describe("the question's tool limits", () => {
  it("a 5th search is limit_reached without running, and a 9th tool call is refused whatever it asks", async () => {
    const h = await harness();
    const input = searchInput({ destinations: ["JFK"], cabins: ["J", "F"] });
    for (let i = 0; i < 4; i++) expect((await h.call(SEARCH_AWARDS, input)).step.outcome).toBe("ok");
    for (const cabin of ["J", "F", "Y"]) expect((await h.call(GET_FLIGHTS, { availability_id: ID, cabin })).step.outcome).toBe("ok");
    expect(runFind).toHaveBeenCalledTimes(4);
    const before = await spent(h);

    const fifth = await h.call(SEARCH_AWARDS, input);
    expect(content<ErrorBody>(fifth)).toEqual({ error: "limit_reached", message: "search_awards may run at most 4 times in one question.", question_calls_left: 8 });
    expect(runFind).toHaveBeenCalledTimes(4);

    // The memo could answer this one for free; it is still the 9th tool call.
    const ninth = await h.call(GET_FLIGHTS, { availability_id: ID, cabin: "J" });
    expect(content<ErrorBody>(ninth)).toEqual({ error: "limit_reached", message: "One question may make at most 8 tool calls.", question_calls_left: 8 });
    expect(ninth.step).toMatchObject({ outcome: "limit_reached", calls: 0, fromMemo: false });

    expect(await spent(h)).toEqual(before);
    expect(h.runner.usage()).toEqual({ toolCalls: 8, searches: 4, flights: 3, seatsCalls: 4 });
  });

  it("a 4th get_flights is limit_reached without a call", async () => {
    const { h, before } = await afterSearch();
    for (const cabin of ["J", "F", "W"]) await h.call(GET_FLIGHTS, { availability_id: ID, cabin });
    const used = await h.quota.used(USER);
    const fourth = await h.call(GET_FLIGHTS, { availability_id: ID, cabin: "Y" });
    expect(content<ErrorBody>(fourth)).toMatchObject({ error: "limit_reached", message: "get_flights may run at most 3 times in one question." });
    expect(await h.quota.used(USER)).toBe(used);
    expect(used).toBe(before.used + 3);
  });
});

describe("hygiene", () => {
  it("saves after a call that spent, and not after one that did not", async () => {
    const h = await harness();
    await h.call(SEARCH_AWARDS, searchInput({ destinations: ["TOKYO"] }));
    expect(h.persist).not.toHaveBeenCalled();
    await h.call(SEARCH_AWARDS, searchInput());
    expect(h.persist).toHaveBeenCalledTimes(1);
    const cached = await h.call(SEARCH_AWARDS, searchInput());
    expect(cached.step).toMatchObject({ calls: 0, fromCache: true });
    expect(h.persist).toHaveBeenCalledTimes(1);
  });

  it("a failed save does not cost the answer the call paid for, and is logged by name only", async () => {
    const h = await harness();
    h.persist.mockRejectedValueOnce(new Error(`disk full near ${SEATS_KEY}`));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const run = await h.call(SEARCH_AWARDS, searchInput());
      expect(run.step).toMatchObject({ outcome: "ok", calls: 1 });
      expect(log).toHaveBeenCalledWith("ask tool persist failed", "Error");
      expect(JSON.stringify(log.mock.calls)).not.toContain(SEATS_KEY);
    } finally {
      log.mockRestore();
    }
  });

  it("no result carries either key or a Partner-Authorization header, even when seats.aero echoes the keys back", async () => {
    const echoed = `upstream saw ${SEATS_KEY} and ${ANTHROPIC_KEY}`;
    const normal = seatsAero();
    const h = await harness({
      handler: (req, index) => {
        if (req.url.pathname === "/partnerapi/search" && req.url.searchParams.get("destination_airport") === "LHR") return textResponse(echoed, 500);
        if (req.url.pathname.startsWith("/partnerapi/trips/")) throw new TypeError(`connection reset while sending ${SEATS_KEY} for ${ANTHROPIC_KEY}`);
        return normal(req, index);
      },
    });

    const runs = [
      await h.call(SEARCH_AWARDS, searchInput({ destinations: ["JFK"], cabins: ["J", "F"] })),
      await h.call(SEARCH_AWARDS, searchInput({ destinations: ["LHR"] })),
      await h.call(GET_FLIGHTS, { availability_id: ID, cabin: "J" }),
      await h.call("book_flight", { key: "Partner-Authorization" }),
    ];
    expect(runs.map((r) => r.step.outcome)).toEqual(["ok", "seatsaero_error", "network", "unknown_tool"]);

    const text = JSON.stringify(runs);
    for (const secret of [SEATS_KEY, ANTHROPIC_KEY, JSON.stringify(ANTHROPIC_KEY).slice(1, -1), encodeURIComponent(SEATS_KEY)]) expect(text).not.toContain(secret);
    expect(text.toLowerCase()).not.toContain("partner-authorization");
    // Not vacuous: every request did carry the key, and the failures did quote what came back.
    expect(h.fetch.calls.every((c) => c.headers["partner-authorization"] === SEATS_KEY)).toBe(true);
    expect(content<ErrorBody>(runs[1]!).message).toContain("upstream saw");
  });
});

const CABIN_ORDER = ["J", "F", "W", "Y"];
function cmpCabin(a: unknown, b: unknown): number {
  return CABIN_ORDER.indexOf(String(a)) - CABIN_ORDER.indexOf(String(b));
}
