import { describe, expect, it } from "vitest";
import { SeatsAeroClient, SeatsAeroHttpError, SeatsAeroNetworkError } from "@/lib/seatsaero/client";
import { InMemoryRoutesStore, ROUTES_TTL_MS, ResilientRoutesCatalog, RoutesCatalog } from "@/lib/seatsaero/routes";
import type { Route } from "@/lib/seatsaero/types";
import { fakeFetch, jsonResponse, textResponse } from "../../../test/fixtures/seatsaero/helpers";

function route(source: string, origin: string, dest: string): Route {
  return {
    ID: `${source}-${origin}-${dest}`,
    OriginAirport: origin,
    OriginRegion: "Asia",
    DestinationAirport: dest,
    DestinationRegion: "North America",
    NumDaysOut: 330,
    Distance: 5000,
    Source: source,
  };
}

const ROUTES: Record<string, Route[]> = {
  american: [route("american", "HKG", "SEA"), route("american", "NRT", "SEA")],
  alaska: [route("alaska", "HKG", "SEA")],
  united: [],
};

describe("RoutesCatalog", () => {
  it("loads lazily per (user, source), counting one call per missing source, and answers isMonitored", async () => {
    const fetch = fakeFetch((req) => jsonResponse(ROUTES[req.url.searchParams.get("source")!] ?? []));
    const client = new SeatsAeroClient({ apiKey: "k", fetch });
    const catalog = new RoutesCatalog({ now: () => new Date("2026-10-01T00:00:00Z") });

    const first = await catalog.ensureLoaded("alice", ["american", "alaska"], client);
    expect(first).toEqual({ fetched: ["american", "alaska"], cached: [], skipped: [] });
    expect(fetch.calls).toHaveLength(2);
    expect(fetch.calls[0]!.url.href).toBe("https://seats.aero/partnerapi/routes?source=american");

    const second = await catalog.ensureLoaded("alice", ["american", "alaska"], client);
    expect(second.fetched).toEqual([]);
    expect(fetch.calls).toHaveLength(2);

    expect(catalog.isMonitored("alice", "american", "HKG", "SEA")).toBe(true);
    expect(catalog.isMonitored("alice", "american", "SEA", "HKG")).toBe(false);
    expect(catalog.isMonitored("alice", "alaska", "NRT", "SEA")).toBe(false);
    expect(catalog.isMonitored("alice", "unknown", "HKG", "SEA")).toBe(false);
    expect(catalog.routesFor("alice", "american")).toHaveLength(2);
    expect(catalog.routesFor("alice", "united")).toBeUndefined();
    expect(catalog.knowledgeFor("alice").routesFor("american")).toHaveLength(2);
    expect(catalog.loadedSources("alice")).toEqual(["american", "alaska"]);

    // The in-process index is per user too: bob sees nothing alice paid for.
    expect(catalog.isLoaded("bob", "american")).toBe(false);
    expect(catalog.isMonitored("bob", "american", "HKG", "SEA")).toBe(false);
    expect(catalog.routesFor("bob", "american")).toBeUndefined();
    expect(catalog.knowledgeFor("bob").routesFor("american")).toBeUndefined();
    expect(catalog.loadedSources("bob")).toEqual([]);
    const bob = await catalog.ensureLoaded("bob", ["american"], client);
    expect(bob.fetched).toEqual(["american"]);
    expect(fetch.calls).toHaveLength(3);
  });

  it("reports pairs no requested source monitors and respects maxFetches", async () => {
    const fetch = fakeFetch((req) => jsonResponse(ROUTES[req.url.searchParams.get("source")!] ?? []));
    const client = new SeatsAeroClient({ apiKey: "k", fetch });
    const catalog = new RoutesCatalog();
    const res = await catalog.ensureLoaded("u", ["american", "alaska", "united"], client, { maxFetches: 2 });
    expect(res.fetched).toEqual(["american", "alaska"]);
    expect(res.skipped).toEqual(["united"]);
    const pairs = [
      { origin: "HKG", dest: "SEA" },
      { origin: "NRT", dest: "SEA" },
      { origin: "GMP", dest: "SEA" },
    ];
    expect(catalog.unmonitoredPairs("u", pairs, ["american", "alaska"])).toEqual([{ origin: "GMP", dest: "SEA" }]);
    expect(catalog.unmonitoredPairs("u", pairs, ["alaska"])).toEqual([pairs[1], pairs[2]]);
    // nothing loaded (or loaded for someone else) → no claims
    expect(catalog.unmonitoredPairs("someone-else", pairs, ["american"])).toEqual([]);
    expect(new RoutesCatalog().unmonitoredPairs("u", pairs, ["american"])).toEqual([]);
  });

  it("uses the store with a 7-day TTL and keeps users apart", async () => {
    const store = new InMemoryRoutesStore();
    let clock = new Date("2026-10-01T00:00:00Z");
    const fetch = fakeFetch((req) => jsonResponse(ROUTES[req.url.searchParams.get("source")!] ?? []));
    const client = new SeatsAeroClient({ apiKey: "k", fetch });

    const a = new RoutesCatalog({ store, now: () => clock });
    await a.ensureLoaded("alice", ["american"], client);
    expect(fetch.calls).toHaveLength(1);

    // A fresh in-process catalog for the same user reads the store: no call.
    const a2 = new RoutesCatalog({ store, now: () => clock });
    expect((await a2.ensureLoaded("alice", ["american"], client)).cached).toEqual(["american"]);
    expect(fetch.calls).toHaveLength(1);

    // Another user must not see alice's entry (per-user key).
    const b = new RoutesCatalog({ store, now: () => clock });
    expect((await b.ensureLoaded("bob", ["american"], client)).fetched).toEqual(["american"]);
    expect(fetch.calls).toHaveLength(2);

    // After 7 days the entry expires and is refetched.
    clock = new Date(clock.getTime() + ROUTES_TTL_MS + 1000);
    const a3 = new RoutesCatalog({ store, now: () => clock });
    expect((await a3.ensureLoaded("alice", ["american"], client)).fetched).toEqual(["american"]);
    expect(fetch.calls).toHaveLength(3);
  });

  it("the in-process index expires with the same TTL (long-lived process, same catalog instance)", async () => {
    let clock = new Date("2026-10-01T00:00:00Z");
    const fetch = fakeFetch((req) => jsonResponse(ROUTES[req.url.searchParams.get("source")!] ?? []));
    const client = new SeatsAeroClient({ apiKey: "k", fetch });
    const catalog = new RoutesCatalog({ now: () => clock, ttlMs: ROUTES_TTL_MS });
    await catalog.ensureLoaded("alice", ["american"], client);
    expect(catalog.isLoaded("alice", "american")).toBe(true);
    expect(catalog.isMonitored("alice", "american", "HKG", "SEA")).toBe(true);

    // One second before expiry: still served from memory.
    clock = new Date(clock.getTime() + ROUTES_TTL_MS - 1000);
    expect(catalog.isLoaded("alice", "american")).toBe(true);
    expect((await catalog.ensureLoaded("alice", ["american"], client)).cached).toEqual(["american"]);
    expect(fetch.calls).toHaveLength(1);

    // Past expiry: the same instance forgets the entry, makes no "unmonitored" claims, and refetches.
    clock = new Date(clock.getTime() + 2000);
    expect(catalog.isLoaded("alice", "american")).toBe(false);
    expect(catalog.loadedSources("alice")).toEqual([]);
    expect(catalog.routesFor("alice", "american")).toBeUndefined();
    expect(catalog.isMonitored("alice", "american", "HKG", "SEA")).toBe(false);
    expect(catalog.unmonitoredPairs("alice", [{ origin: "GMP", dest: "SEA" }], ["american"])).toEqual([]);
    expect((await catalog.ensureLoaded("alice", ["american"], client)).fetched).toEqual(["american"]);
    expect(fetch.calls).toHaveLength(2);
    expect(catalog.isMonitored("alice", "american", "HKG", "SEA")).toBe(true);
  });

  it("clear() forgets every list, in memory and in the store; clear(before) only the older ones", async () => {
    const store = new InMemoryRoutesStore();
    let clock = new Date("2026-10-01T00:00:00Z");
    const fetch = fakeFetch((req) => jsonResponse(ROUTES[req.url.searchParams.get("source")!] ?? []));
    const client = new SeatsAeroClient({ apiKey: "k", fetch });
    const catalog = new RoutesCatalog({ store, now: () => clock });
    await catalog.ensureLoaded("alice", ["american"], client);
    clock = new Date(clock.getTime() + 60_000);
    await catalog.ensureLoaded("alice", ["alaska"], client);
    await catalog.ensureLoaded("bob", ["alaska"], client);

    // Only what was fetched before the minute passed: american, not either alaska list.
    await catalog.clear(clock.getTime());
    expect(catalog.loadedSources("alice")).toEqual(["alaska"]);
    expect(await store.get("alice", "american")).toBeNull();
    expect(await store.get("alice", "alaska")).not.toBeNull();

    await catalog.clear();
    expect(catalog.loadedSources("alice")).toEqual([]);
    expect(catalog.loadedSources("bob")).toEqual([]);
    expect(await store.get("alice", "alaska")).toBeNull();
    expect(await store.get("bob", "alaska")).toBeNull();
    // Nothing left to answer from: the next ask fetches again.
    expect((await catalog.ensureLoaded("alice", ["alaska"], client)).fetched).toEqual(["alaska"]);
    expect(fetch.calls).toHaveLength(4);
  });
});

describe("ResilientRoutesCatalog (#89): one failed list costs its own claim, not the run", () => {
  const NOW = new Date("2026-10-01T00:00:00Z");

  /** american and united answer; alaska answers `failure`. */
  function harness(failure: () => Response | Promise<Response>) {
    const fetch = fakeFetch((req) => {
      const source = req.url.searchParams.get("source")!;
      return source === "alaska" ? failure() : jsonResponse(ROUTES[source] ?? []);
    });
    return { fetch, client: new SeatsAeroClient({ apiKey: "k", fetch }), catalog: new ResilientRoutesCatalog({ now: () => NOW }) };
  }

  it.each([
    ["an HTTP 500", () => textResponse("upstream failure", 500)],
    ["an HTTP 429", () => textResponse("slow down", 429)],
    ["a response that is not the documented schema", () => jsonResponse({ not: "a route list" })],
  ])("%s on one list leaves that source unloaded and reported, and loads the others", async (_what, failure) => {
    const { fetch, client, catalog } = harness(failure);
    const loaded = await catalog.ensureLoaded("alice", ["american", "alaska", "united"], client);
    expect(loaded).toEqual({ fetched: ["american", "united"], cached: [], skipped: [], failed: ["alaska"] });
    // The failed call was still made: seats.aero counts it.
    expect(fetch.calls).toHaveLength(3);
    expect(catalog.isLoaded("alice", "alaska")).toBe(false);
    expect(catalog.isLoaded("alice", "american")).toBe(true);
    // Nothing about the failure is stored: the next call asks for that list again, and only that list.
    const again = await catalog.ensureLoaded("alice", ["american", "alaska", "united"], client);
    expect(again).toEqual({ fetched: [], cached: ["american", "united"], skipped: [], failed: ["alaska"] });
    expect(fetch.calls).toHaveLength(4);
  });

  it("a failed call counts against maxFetches, like a successful one", async () => {
    const { fetch, client, catalog } = harness(() => textResponse("upstream failure", 503));
    const loaded = await catalog.ensureLoaded("alice", ["alaska", "american", "united"], client, { maxFetches: 2 });
    expect(loaded).toEqual({ fetched: ["american"], cached: [], skipped: ["united"], failed: ["alaska"] });
    expect(fetch.calls).toHaveLength(2);
  });

  it("a rejected key and a transport failure still end the run: they affect every request", async () => {
    for (const status of [401, 403]) {
      const { client, catalog } = harness(() => textResponse("no", status));
      await expect(catalog.ensureLoaded("alice", ["american", "alaska", "united"], client)).rejects.toBeInstanceOf(SeatsAeroHttpError);
    }
    const { client, catalog } = harness(() => {
      throw new TypeError("Load failed");
    });
    await expect(catalog.ensureLoaded("alice", ["american", "alaska", "united"], client)).rejects.toBeInstanceOf(SeatsAeroNetworkError);
  });

  it("the base catalog is unchanged: the same failure ends its run, and it reports no failed list", async () => {
    const fetch = fakeFetch((req) => (req.url.searchParams.get("source") === "alaska" ? textResponse("upstream failure", 500) : jsonResponse([])));
    const client = new SeatsAeroClient({ apiKey: "k", fetch });
    await expect(new RoutesCatalog({ now: () => NOW }).ensureLoaded("alice", ["american", "alaska"], client)).rejects.toBeInstanceOf(SeatsAeroHttpError);
    expect(await new RoutesCatalog({ now: () => NOW }).ensureLoaded("alice", ["american"], client)).toEqual({ fetched: ["american"], cached: [], skipped: [] });
  });
});
