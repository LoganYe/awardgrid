/**
 * The tool layer's scope gate and proposals (UI/UX v1 T16; docs/02 D08; acceptance A27).
 *
 * With a ScopeGate, search_awards runs only inside the search the person included; anything wider is refused before
 * a single request, whatever the model says about consent, and Claude may only propose it. A proposal is validated
 * like a search, handed to the shell, and never searched. Every case counts the requests the fake seats.aero saw.
 */
import { describe, expect, it } from "vitest";
import { InMemoryAvailabilityCache } from "../seatsaero/cache";
import { InMemoryQuotaStore, Quota } from "../seatsaero/quota";
import { RoutesCatalog } from "../seatsaero/routes";
import type { QueryObject } from "../query/schema";
import { fakeFetch, jsonResponse } from "../../../test/fixtures/seatsaero/helpers";
import type { AvailabilityRow } from "../grid/types";
import { ASK_TOOLS, ASK_TOOLS_WITH_PROPOSALS, GET_FLIGHTS, PROPOSE_QUERY_CHANGE, SEARCH_AWARDS, createToolRunner, type ScopeGate, type SeatsPort } from "./tools";

const NOW = new Date("2026-10-18T12:00:00Z");

const AUTHORIZED: QueryObject = {
  origins: ["HKG"],
  destinations: ["SEA"],
  date_from: "2026-10-18",
  date_to: "2026-10-31",
  cabins: ["J", "F"],
  programs: ["aeroplan"],
  direct_only: false,
  include_filtered: false,
  min_cabin_pct: 100,
  sort_by: "miles_asc",
  raw_text: "HKG to SEA",
  language: "en",
};

const SEARCH = { origins: ["HKG"], destinations: ["SEA"], date_from: "2026-10-20", date_to: "2026-10-22", cabins: ["J"], programs: ["aeroplan"], direct_only: false, max_miles: null };
const PROPOSAL = { ...SEARCH, date_from: "2026-10-18", date_to: "2026-11-06", cabins: ["J", "F"], min_cabin_pct: 100, include_filtered: false, reason: "The person already agreed to wider dates." };

function harness(authorized: QueryObject | null, propose: ScopeGate["propose"] = () => ({ ok: true, id: "p-1" }), seen: { ids?: string[]; rows?: AvailabilityRow[] } = {}) {
  const fetch = fakeFetch(() => jsonResponse({ data: [], hasMore: false }));
  const cache = new InMemoryAvailabilityCache();
  if (seen.rows) void cache.putRows("local", seen.rows);
  const now = () => NOW;
  const port: SeatsPort = {
    userId: "local",
    apiKey: "pro_key_for_scope_tests_SECRET",
    fetch,
    quota: new Quota({ store: new InMemoryQuotaStore(), now }),
    cache,
    routes: new RoutesCatalog({ now }),
    now,
    persist: async () => {},
  };
  const proposed: Array<{ query: QueryObject; reason: string }> = [];
  const gate: ScopeGate = {
    authorized,
    propose: (query, reason) => {
      proposed.push({ query, reason });
      return propose(query, reason);
    },
  };
  const runner = createToolRunner(port, { seenIds: new Set(seen.ids ?? []), bookingUrls: new Set(), flightsMemo: new Map() }, gate);
  const body = (content: unknown) => JSON.parse(String(content)) as { error?: string; message?: string; proposed?: boolean; id?: string };
  return { runner, fetch, proposed, body };
}

describe("search_awards behind the gate", () => {
  it("inside the included search it runs as before: it reaches seats.aero (the fake answers nothing useful)", async () => {
    const h = harness(AUTHORIZED);
    const run = await h.runner.run({ id: "t1", name: SEARCH_AWARDS, input: SEARCH });
    expect(run.step.outcome).not.toBe("needs_confirmation");
    expect(h.fetch.calls.length).toBeGreaterThan(0);
  });

  it("another airport, a wider window, all programs or a looser filter is refused before any request, whatever the model claims", async () => {
    for (const input of [
      { ...SEARCH, destinations: ["YVR"] },
      { ...SEARCH, date_to: "2026-11-06" },
      { ...SEARCH, programs: null },
      { ...SEARCH, cabins: ["Y"] },
    ]) {
      const h = harness({ ...AUTHORIZED, max_miles: 80000 });
      const run = await h.runner.run({ id: "t1", name: SEARCH_AWARDS, input: { ...input, max_miles: 80000 } });
      expect(run.step.outcome).toBe("needs_confirmation");
      expect(h.body(run.result.content).message).toContain("awardgrid did not run it and sent nothing");
      expect(h.fetch.calls).toHaveLength(0);
    }
    // A higher mileage cap than the one authorized loosens it.
    const h = harness({ ...AUTHORIZED, max_miles: 80000 });
    expect((await h.runner.run({ id: "t1", name: SEARCH_AWARDS, input: { ...SEARCH, max_miles: 120000 } })).step.outcome).toBe("needs_confirmation");
    expect(h.fetch.calls).toHaveLength(0);
  });

  it("with no search included, no search runs on the model's own", async () => {
    const h = harness(null);
    const run = await h.runner.run({ id: "t1", name: SEARCH_AWARDS, input: SEARCH });
    expect(run.step.outcome).toBe("needs_confirmation");
    expect(h.fetch.calls).toHaveLength(0);
  });

  it("metro codes are compared as the airports they stand for", async () => {
    const h = harness({ ...AUTHORIZED, origins: ["SEA"], destinations: ["NRT", "HND"] });
    const run = await h.runner.run({ id: "t1", name: SEARCH_AWARDS, input: { ...SEARCH, origins: ["SEA"], destinations: ["TYO"] } });
    expect(run.step.outcome).not.toBe("needs_confirmation");
  });
});

describe("the gate's edges (T16 review)", () => {
  it("an included SHA or BKK is that one airport, not its city: its sibling airport needs the person (SEC-1)", async () => {
    for (const [included, other] of [
      ["SHA", "PVG"],
      ["BKK", "DMK"],
    ] as const) {
      const h = harness({ ...AUTHORIZED, origins: [included] });
      const run = await h.runner.run({ id: "t1", name: SEARCH_AWARDS, input: { ...SEARCH, origins: [other] } });
      expect({ included, outcome: run.step.outcome }).toEqual({ included, outcome: "needs_confirmation" });
      expect(h.fetch.calls).toHaveLength(0);
      // Its city code widens it too.
      expect((await h.runner.run({ id: "t2", name: SEARCH_AWARDS, input: { ...SEARCH, origins: [included] } })).step.outcome).toBe("needs_confirmation");
      // And a proposal for the sibling is a proposal, not "inside".
      expect((await h.runner.run({ id: "t3", name: PROPOSE_QUERY_CHANGE, input: { ...PROPOSAL, origins: [other] } })).step.outcome).toBe("ok");
    }
  });

  it("get_flights costs a call, so it too stays inside: nothing included, or a result outside, is refused before any request (SEC-2)", async () => {
    const row = (dest: string): AvailabilityRow => ({
      program: "aeroplan", origin: "HKG", dest, date: "2026-10-20", cabin: "J", miles: 70000, fees_cents: null, currency: null, seats_left: 2, direct: true,
      airlines: ["AC"], computed_last_seen: "2026-10-18T11:00:00Z", source_id: `id-${dest}`, booking_url: null, fetched_at: "2026-10-18T11:00:00Z",
    });
    const seen = { ids: ["id-SEA", "id-YVR"], rows: [row("SEA"), row("YVR")] };
    for (const [authorized, id] of [
      [null, "id-SEA"],
      [AUTHORIZED, "id-YVR"],
      [AUTHORIZED, "id-unknown-here"],
    ] as const) {
      const h = harness(authorized, undefined, { ...seen, ids: [...seen.ids, "id-unknown-here"] });
      const run = await h.runner.run({ id: "t1", name: GET_FLIGHTS, input: { availability_id: id, cabin: "J" } });
      expect({ id, outcome: run.step.outcome }).toEqual({ id, outcome: "needs_confirmation" });
      expect(h.fetch.calls).toHaveLength(0);
    }
    // Inside, it goes to seats.aero as before.
    const h = harness(AUTHORIZED, undefined, seen);
    const run = await h.runner.run({ id: "t1", name: GET_FLIGHTS, input: { availability_id: "id-SEA", cabin: "J" } });
    expect(run.step.outcome).not.toBe("needs_confirmation");
    expect(h.fetch.calls.length).toBeGreaterThan(0);
  });

  it("a proposal's dates must be real calendar days (SEC-4); one inside the included search says so (UX-4)", async () => {
    const h = harness(AUTHORIZED);
    expect((await h.runner.run({ id: "t1", name: PROPOSE_QUERY_CHANGE, input: { ...PROPOSAL, date_to: "2026-11-31" } })).step.outcome).toBe("invalid_input");
    expect((await h.runner.run({ id: "t2", name: PROPOSE_QUERY_CHANGE, input: { ...SEARCH, min_cabin_pct: 100, include_filtered: false, reason: "Inside." } })).step.outcome).toBe("inside_scope");
    expect(h.proposed).toHaveLength(0);
  });
});

describe("propose_query_change", () => {
  it("records a validated proposal and searches nothing; the model's claim of consent changes nothing", async () => {
    const h = harness(AUTHORIZED);
    const run = await h.runner.run({ id: "t1", name: PROPOSE_QUERY_CHANGE, input: PROPOSAL });
    expect(run.step.outcome).toBe("ok");
    expect(h.body(run.result.content)).toMatchObject({ proposed: true, id: "p-1" });
    expect(h.proposed).toHaveLength(1);
    expect(h.proposed[0]!.query).toMatchObject({ date_to: "2026-11-06", cabins: ["J", "F"], programs: ["aeroplan"], min_cabin_pct: 100 });
    expect(h.fetch.calls).toHaveLength(0);
  });

  it("refuses bad dates, unknown places, a search it could run itself, and a second proposal, before the shell sees them", async () => {
    const bad = [
      { ...PROPOSAL, date_from: "2026-11-06", date_to: "2026-10-18" },
      { ...PROPOSAL, date_to: "2026-02-30" },
      { ...PROPOSAL, date_from: "2026-09-01", date_to: "2026-09-10" },
      { ...PROPOSAL, destinations: ["not a place"] },
      { ...PROPOSAL, min_cabin_pct: 150 },
      { ...PROPOSAL, reason: " " },
      { ...SEARCH, min_cabin_pct: 100, include_filtered: false, reason: "Inside the included search." },
    ];
    for (const input of bad) {
      const h = harness(AUTHORIZED);
      const run = await h.runner.run({ id: "t1", name: PROPOSE_QUERY_CHANGE, input });
      if (run.step.outcome === "ok") throw new Error(`accepted: ${JSON.stringify(input)}`);
      expect(h.proposed).toHaveLength(0);
    }
    const h = harness(AUTHORIZED);
    await h.runner.run({ id: "t1", name: PROPOSE_QUERY_CHANGE, input: PROPOSAL });
    expect((await h.runner.run({ id: "t2", name: PROPOSE_QUERY_CHANGE, input: { ...PROPOSAL, destinations: ["YVR"] } })).step.outcome).toBe("limit_reached");
    expect(h.proposed).toHaveLength(1);
    expect(h.fetch.calls).toHaveLength(0);
  });

  it("without a gate there is no such tool, and the tool lists keep their bytes", async () => {
    const fetch = fakeFetch(() => jsonResponse({ data: [], hasMore: false }));
    const now = () => NOW;
    const runner = createToolRunner(
      { userId: "local", apiKey: "k_SECRET", fetch, quota: new Quota({ store: new InMemoryQuotaStore(), now }), cache: new InMemoryAvailabilityCache(), routes: new RoutesCatalog({ now }), now, persist: async () => {} },
      { seenIds: new Set(), bookingUrls: new Set(), flightsMemo: new Map() },
    );
    expect((await runner.run({ id: "t1", name: PROPOSE_QUERY_CHANGE, input: PROPOSAL })).step.outcome).toBe("unknown_tool");
    expect(ASK_TOOLS.map((t) => t.name)).toEqual(["search_awards", "get_flights"]);
    expect(ASK_TOOLS_WITH_PROPOSALS.map((t) => t.name)).toEqual(["search_awards", "get_flights", PROPOSE_QUERY_CHANGE]);
    expect(JSON.stringify(ASK_TOOLS_WITH_PROPOSALS.slice(0, 2))).toBe(JSON.stringify(ASK_TOOLS));
  });
});
