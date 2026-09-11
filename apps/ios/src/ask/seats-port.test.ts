/**
 * The SeatsPort Ask's tools run on, over the grid lane's own transport, cache and quota (design §4.3, §10.1).
 *
 * The transport is bootstrap's own `seatsTransport` over a fake seats.aero, and the quota counter is the device's
 * DeviceQuotaStore, so a tool call here is reconciled exactly as a grid search is. The search itself runs through
 * core's real createToolRunner and runFind. No network, no Keychain, and the clock is fixed.
 */
import { describe, expect, it, vi } from "vitest";
import { createToolRunner, type ToolRunState } from "@awardgrid/core/ask/tools";
import { Quota } from "@awardgrid/core/seatsaero/quota";
import { type FakeHandler, fakeFetch } from "@awardgrid/core/test-fixtures/seatsaero/helpers";
import { seatsTransport } from "../app/bootstrap";
import { LOCAL_USER, SearchEngine } from "../search/search";
import { DeviceQuotaStore } from "../store/quota-store";
import { createSeatsPort } from "./seats-port";

const NOW = new Date("2026-10-01T00:00:00.000Z");
const now = () => NOW;
const TODAY = "2026-10-01";
const SEATS_KEY = "pro_seats_port_test_key_DO_NOT_LEAK";
const ANTHROPIC_KEY = "sk-ant-api03-seats-port-test-key-DO_NOT_LEAK";

/** What Claude's search_awards call carries: SEA to Tokyo (NRT and HND) in October, business. */
const SEARCH_INPUT = {
  origins: ["SEA"],
  destinations: ["TYO"],
  date_from: "2026-10-01",
  date_to: "2026-10-31",
  cabins: ["J"],
  programs: null,
  direct_only: false,
  max_miles: null,
};

function availability(dest: string, date: string) {
  return {
    ID: `id-SEA-${dest}-${date}`,
    RouteID: `r-SEA-${dest}`,
    Route: { ID: `r-SEA-${dest}`, OriginAirport: "SEA", DestinationAirport: dest, Source: "alaska" },
    Date: date,
    ParsedDate: `${date}T00:00:00Z`,
    Source: "alaska",
    JAvailable: true,
    JMileageCost: "75000",
    JRemainingSeats: 2,
    JAirlines: "JL",
    JDirect: true,
    YAvailable: false,
    WAvailable: false,
    FAvailable: false,
  };
}

/**
 * seats.aero with `remaining` calls left today (no header when null). A search answers rows for both SEA to NRT and
 * SEA to HND, so no pair is empty and runFind makes no Get Routes call: the search is exactly one request.
 */
function seatsAero(remaining: string | null = "400"): FakeHandler {
  return (req) => {
    const body = req.url.pathname.endsWith("/routes") ? [] : { data: [availability("NRT", "2026-10-05"), availability("HND", "2026-10-06")], hasMore: false };
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (remaining !== null) headers["X-RateLimit-Remaining"] = remaining;
    return new Response(JSON.stringify(body), { status: 200, headers });
  };
}

/** The pieces bootstrap wires, over a fake seats.aero. */
function wired(handler: FakeHandler = seatsAero()) {
  const inner = fakeFetch(handler);
  const quotaStore = new DeviceQuotaStore();
  const fetchImpl = seatsTransport(inner, quotaStore, now);
  const engine = new SearchEngine({ fetchImpl, quota: new Quota({ store: quotaStore, now }), now });
  const persist = vi.fn(async () => {});
  const port = createSeatsPort({ fetchImpl, engine, keys: { seatsAero: SEATS_KEY, anthropic: ANTHROPIC_KEY }, persist, now });
  const state: ToolRunState = { seenIds: new Set(), bookingUrls: new Set(), flightsMemo: new Map() };
  return { inner, quotaStore, fetchImpl, engine, persist, port, runner: createToolRunner(port, state) };
}

describe("createSeatsPort", () => {
  it("is the grid lane's own user, key, transport, stores and clock", async () => {
    const { fetchImpl, engine, persist, port } = wired();
    expect(port.userId).toBe(LOCAL_USER);
    expect(port.apiKey).toBe(SEATS_KEY);
    expect(port.fetch).toBe(fetchImpl);
    expect(port.quota).toBe(engine.quota);
    expect(port.cache).toBe(engine.cache);
    expect(port.routes).toBe(engine.routes);
    expect(port.now).toBe(now);
    expect(port.secrets).toEqual([ANTHROPIC_KEY]);
    await port.persist();
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("masks no Anthropic key when the question has none, and refuses a blank seats.aero key", () => {
    const { fetchImpl, engine } = wired();
    const persist = async () => {};
    expect(createSeatsPort({ fetchImpl, engine, keys: { seatsAero: SEATS_KEY, anthropic: null }, persist, now }).secrets).toEqual([]);
    expect(() => createSeatsPort({ fetchImpl, engine, keys: { seatsAero: "  ", anthropic: ANTHROPIC_KEY }, persist, now })).toThrow(
      "createSeatsPort needs the person's seats.aero key.",
    );
  });
});

describe("a search_awards call through the port", () => {
  it("goes through the observed fetch, and X-RateLimit-Remaining: 400 raises the quota's used count to 600", async () => {
    const { inner, quotaStore, engine, persist, runner } = wired(seatsAero("400"));
    expect(await engine.quota.used(LOCAL_USER)).toBe(0);

    const run = await runner.run({ id: "toolu_port_1", name: "search_awards", input: SEARCH_INPUT });

    expect(run.result.is_error).toBeUndefined();
    expect(run.step).toMatchObject({ outcome: "ok", calls: 1, fromCache: false });
    expect(inner.calls.map((c) => c.url.pathname)).toEqual(["/partnerapi/search"]);
    expect(inner.calls[0]!.headers["partner-authorization"]).toBe(SEATS_KEY);
    // seats.aero says 400 of 1,000 are left, so 600 are spent; the local count of one call must not be believed.
    expect(await quotaStore.get(LOCAL_USER, TODAY)).toBe(600);
    expect(await engine.quota.used(LOCAL_USER)).toBe(600);
    // The runner saved after the call that moved the quota.
    expect(persist).toHaveBeenCalledTimes(1);
    // The Anthropic key never travels to seats.aero.
    expect(JSON.stringify(inner.calls)).not.toContain(ANTHROPIC_KEY);
  });

  it("without the header, counts only the call it made, so the 600 above came from seats.aero", async () => {
    const { engine, runner } = wired(seatsAero(null));
    await runner.run({ id: "toolu_port_2", name: "search_awards", input: SEARCH_INPUT });
    expect(await engine.quota.used(LOCAL_USER)).toBe(1);
  });

  it("reads the same search from the device's cache the second time, spending and saving nothing", async () => {
    const { inner, engine, persist, runner } = wired();
    await runner.run({ id: "toolu_port_3", name: "search_awards", input: SEARCH_INPUT });
    const again = await runner.run({ id: "toolu_port_4", name: "search_awards", input: SEARCH_INPUT });
    expect(again.step).toMatchObject({ outcome: "ok", calls: 0, fromCache: true });
    expect(inner.calls).toHaveLength(1);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(await engine.quota.used(LOCAL_USER)).toBe(600);
  });
});

describe("the seats.aero transport and Anthropic's responses", () => {
  it("never feeds an Anthropic response to the quota observer, while a seats.aero response through it does", async () => {
    const { fetchImpl, engine } = wired(() => new Response("{}", { status: 200, headers: { "content-type": "application/json", "x-ratelimit-remaining": "3" } }));

    await fetchImpl("https://api.anthropic.com/v1/messages", { method: "POST", body: "{}" });
    expect(await engine.quota.used(LOCAL_USER)).toBe(0);

    await fetchImpl("https://seats.aero/partnerapi/routes?source=united");
    expect(await engine.quota.used(LOCAL_USER)).toBe(997);
  });
});
