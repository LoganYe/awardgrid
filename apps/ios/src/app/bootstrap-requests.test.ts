/**
 * The four spending entries through the app's own services (UI/UX v1 T17; docs/02 D09; acceptance A29): a search, a
 * watch run and a lookup fired at once start one at a time over the one transport; the one Quota counts what was
 * sent, a request that threw included, and at the day's last call only one entry spends it.
 */
import { describe, expect, it } from "vitest";
import { fakeFetch, jsonResponse } from "@awardgrid/core/test-fixtures/seatsaero/helpers";
import { fixtureQuery, fixtureSnapshot } from "@awardgrid/core/test-fixtures/uiux/factory";
import type { QueryObject } from "@awardgrid/core/query/schema";
import { draftFromQuery } from "@awardgrid/core/workspace/query-editor";
import { MemoryKeyStore } from "../native/keychain";
import { LOCAL_USER } from "../search/search";
import { MemoryFileStore, QUOTA_FILE, SnapshotStore } from "../store/persistence";
import { DEFAULT_PREFERENCES, WORKSPACE_NAMESPACE } from "../workspace/workspace-store";
import { bootstrap } from "./bootstrap";

const NOW = new Date("2026-10-01T00:00:00.000Z");
const KEY = "pro_requests_test_key_DO_NOT_LEAK";

function row(origin: string, dest: string, date: string) {
  return {
    ID: `id-${origin}-${dest}-${date}`,
    RouteID: `r-${origin}-${dest}`,
    Route: { ID: `r-${origin}-${dest}`, OriginAirport: origin, DestinationAirport: dest, Source: "alaska" },
    Date: date,
    ParsedDate: `${date}T00:00:00Z`,
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
}

/** A seats.aero that answers after a moment and records how many requests were out at once, and which. */
function seatsAero(opts: { throwOnSearch?: boolean } = {}) {
  const track = { now: 0, most: 0, paths: [] as string[] };
  const fetch = fakeFetch(async (req) => {
    track.now += 1;
    track.most = Math.max(track.most, track.now);
    track.paths.push(req.url.pathname);
    await new Promise((resolve) => setTimeout(resolve, 5));
    track.now -= 1;
    if (req.url.pathname.endsWith("/routes")) return jsonResponse([]);
    if (req.url.pathname.includes("/trips/")) return jsonResponse({ data: [] });
    if (opts.throwOnSearch) throw new TypeError("The network connection was lost.");
    const origin = req.url.searchParams.get("origin_airport") ?? "HKG";
    const dest = req.url.searchParams.get("destination_airport") ?? "SEA";
    return jsonResponse({ data: [row(origin, dest, "2026-10-05")], hasMore: false });
  });
  return { fetch, track };
}

const query = (dest: string): QueryObject => ({ ...fixtureQuery(), origins: ["HKG"], destinations: [dest], date_from: "2026-10-01", date_to: "2026-10-20", cabins: ["J"], programs: undefined });

async function start(files = new MemoryFileStore(), seats = seatsAero()) {
  const keys = new MemoryKeyStore();
  await keys.set(KEY);
  const svc = await bootstrap({ keys, snapshots: new SnapshotStore(files), now: () => NOW, fetchImpl: seats.fetch });
  return { svc, seats, files };
}

describe("coordinated entries", () => {
  it("a search, a watch run and a lookup fired at once never overlap, and each is sent", async () => {
    const { svc, seats } = await start();
    await svc.workspace.run(query("SEA"));
    const shown = svc.workspace.getState().displayedSnapshot!;
    svc.watches.add({
      id: "w1", name: "HKG to YVR", text: "HKG to YVR", draft: { ...draftFromQuery(query("YVR")), dates: { kind: "fixed", from: "2026-10-01", to: "2026-10-20" } },
      review: null, lastCheckedAt: null, baseline: [], dropThresholdPct: 10, enabled: true, createdAt: NOW.toISOString(),
    });
    seats.track.most = 0;
    seats.track.paths.length = 0;
    await Promise.all([
      svc.workspace.run(query("LAX")),
      svc.checkWatches(),
      svc.details.load({ snapshotId: shown.id, rowKey: shown.rows[0]!.key }),
    ]);
    expect(seats.track.most).toBe(1);
    expect(seats.track.paths.some((p) => p.includes("/trips/"))).toBe(true);
    expect(seats.track.paths.filter((p) => p.endsWith("/search")).length).toBeGreaterThanOrEqual(2);
    expect(svc.requests.active()).toBeNull();
  });

  it("at the day's last call, only one entry spends it; the other is refused before sending", async () => {
    // A search from an earlier launch on screen, and today's count one short of the soft limit (950).
    const files = new MemoryFileStore();
    const snapshot = fixtureSnapshot({ id: "earlier-launch", revision: 1, query: query("SEA") });
    const value = { schemaVersion: 1, revision: 1, displayedId: snapshot.id, previousId: null, preferences: DEFAULT_PREFERENCES, snapshots: [snapshot] };
    files.files.set(`${WORKSPACE_NAMESPACE}.a.json`, JSON.stringify({ generation: 1, value }));
    files.files.set(QUOTA_FILE, JSON.stringify({ version: 1, days: { "2026-10-01": 949 } }));
    const seats = seatsAero();
    const { svc } = await start(files, seats);
    expect((await svc.engine.quotaView()).remaining).toBe(1);
    const shown = svc.workspace.getState().displayedSnapshot!;
    await Promise.all([svc.workspace.run(query("LAX")), svc.details.load({ snapshotId: shown.id, rowKey: shown.rows[0]!.key })]);
    // One request at most went out, and the count never passed the limit.
    expect(seats.track.paths.length).toBeLessThanOrEqual(1);
    expect(await svc.engine.quota.used(LOCAL_USER)).toBeLessThanOrEqual(950);
  });

  it("a request that threw is counted, not guessed as none: the quota moved", async () => {
    const { svc } = await start(new MemoryFileStore(), seatsAero({ throwOnSearch: true }));
    const before = await svc.engine.quota.used(LOCAL_USER);
    const outcome = await svc.workspace.run(query("SEA"));
    expect(outcome.kind).toBe("failed");
    expect(await svc.engine.quota.used(LOCAL_USER)).toBeGreaterThan(before);
  });
});

