import { describe, expect, it } from "vitest";
import { routesCache } from "@/lib/db/schema";
import { createSqliteRoutesStore } from "@/lib/db/stores/routes";
import { testDbWithUsers } from "@/lib/db/stores/testing";
import { SeatsAeroClient } from "@awardgrid/core/seatsaero/client";
import { ROUTES_TTL_MS, RoutesCatalog } from "@awardgrid/core/seatsaero/routes";
import type { Route } from "@awardgrid/core/seatsaero/types";
import { fakeFetch, jsonResponse } from "@awardgrid/core/test-fixtures/seatsaero/helpers";

const USERS = ["alice", "bob"];

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

describe("createSqliteRoutesStore", () => {
  it("put/get round-trips per (user, source), upserts, and keeps users apart", async () => {
    const store = createSqliteRoutesStore(testDbWithUsers(USERS));
    expect(await store.get("alice", "american")).toBeNull();
    await store.put("alice", "american", { routes: ROUTES.american!, fetched_at: "2026-10-01T00:00:00.000Z" });
    expect(await store.get("alice", "american")).toEqual({ routes: ROUTES.american, fetched_at: "2026-10-01T00:00:00.000Z" });
    expect(await store.get("alice", "alaska")).toBeNull();
    expect(await store.get("bob", "american")).toBeNull();
    // replace
    await store.put("alice", "american", { routes: ROUTES.alaska!, fetched_at: "2026-10-02T00:00:00.000Z" });
    expect(await store.get("alice", "american")).toEqual({ routes: ROUTES.alaska, fetched_at: "2026-10-02T00:00:00.000Z" });
    // empty arrays are a valid (cached) answer, distinct from "unknown"
    await store.put("alice", "united", { routes: [], fetched_at: "2026-10-02T00:00:00.000Z" });
    expect(await store.get("alice", "united")).toEqual({ routes: [], fetched_at: "2026-10-02T00:00:00.000Z" });
    await expect(store.get("", "american")).rejects.toBeInstanceOf(RangeError);
  });

  it("treats corrupt or foreign-shaped JSON as absent and prunes by fetched_at", async () => {
    const db = testDbWithUsers(USERS);
    const store = createSqliteRoutesStore(db);
    await store.put("alice", "american", { routes: ROUTES.american!, fetched_at: "2026-10-01T00:00:00.000Z" });
    await store.put("bob", "american", { routes: ROUTES.american!, fetched_at: "2026-10-05T00:00:00.000Z" });
    db.update(routesCache).set({ routesJson: "{oops" }).run();
    expect(await store.get("alice", "american")).toBeNull();
    db.update(routesCache).set({ routesJson: JSON.stringify([{ ID: 1 }]) }).run();
    expect(await store.get("alice", "american")).toBeNull();
    expect(await store.prune("alice", "2026-10-02T00:00:00.000Z")).toBe(1);
    expect(db.select().from(routesCache).all().map((r) => r.userId)).toEqual(["bob"]);
    expect(await store.prune(undefined, "2026-10-02T00:00:00.000Z")).toBe(0);
    expect(await store.prune(undefined, "2026-10-06T00:00:00.000Z")).toBe(1);
  });
});

describe("RoutesCatalog over the SQLite store", () => {
  it("uses the store with a 7-day TTL and keeps users apart", async () => {
    const store = createSqliteRoutesStore(testDbWithUsers(USERS));
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
    expect(a2.isMonitored("alice", "american", "HKG", "SEA")).toBe(true);

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
});
