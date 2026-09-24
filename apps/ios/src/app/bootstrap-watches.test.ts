/**
 * Watches through the app's own services, plus the Phase 2 "Clear cached results" bug.
 *
 * That bug is worth pinning because it made a UI claim false. `clearAll()` deleted cache.json but
 * never emptied the in-memory cache, so the next `persist()` — which runs after every search —
 * wrote every row straight back, and "Cached results cleared" stopped being true within one
 * search. It also deleted quota.json, forgetting calls already spent today.
 */
import { describe, expect, it } from "vitest";
import { fakeFetch, jsonResponse } from "@awardgrid/core/test-fixtures/seatsaero/helpers";
import type { Watch } from "@awardgrid/core/watch";
import { MemoryKeyStore } from "../native/keychain";
import { LOCAL_USER } from "../search/search";
import { CACHE_FILE, MemoryFileStore, QUOTA_FILE, SnapshotStore, WATCHES_FILE } from "../store/persistence";
import { bootstrap } from "./bootstrap";

const NOW = new Date("2026-10-01T00:00:00.000Z");
const KEY = "pro_test_key_ABC123xyz_DO_NOT_LEAK";
const QUERY = "HKG to SEA next 30 days business";

function apiRow(date: string) {
  return {
    ID: `id-${date}`,
    RouteID: "r1",
    Route: { ID: "r1", OriginAirport: "HKG", DestinationAirport: "SEA", Source: "alaska" },
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

function seatsAero() {
  return fakeFetch((req) =>
    req.url.pathname.endsWith("/routes") ? jsonResponse([]) : jsonResponse({ data: [apiRow("2026-10-05")], hasMore: false }),
  );
}

function watch(over: Partial<Watch> = {}): Watch {
  return {
    id: "w1",
    name: "HKG to SEA",
    text: QUERY,
    lastCheckedAt: null,
    baseline: [],
    dropThresholdPct: 10,
    enabled: true,
    createdAt: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

async function start(files = new MemoryFileStore(), fetchImpl = seatsAero()) {
  const keys = new MemoryKeyStore();
  await keys.set(KEY);
  const svc = await bootstrap({ keys, snapshots: new SnapshotStore(files), now: () => NOW, fetchImpl });
  return { svc, files, fetchImpl };
}

const rowsIn = (json: string | undefined) =>
  (JSON.parse(json ?? '{"users":[]}') as { users: Array<{ rows: unknown[] }> }).users.reduce((n, u) => n + u.rows.length, 0);

describe("Clear cached results", () => {
  it("really clears: the next persist does not write the rows back", async () => {
    const { svc, files } = await start();
    await svc.engine.search(QUERY, KEY);
    await svc.persist();
    expect(rowsIn(files.files.get(CACHE_FILE))).toBeGreaterThan(0);

    await svc.clearCache();
    await svc.persist(); // the Phase 2 bug: this wrote every in-memory row straight back

    expect(rowsIn(files.files.get(CACHE_FILE))).toBe(0);
  });

  it("really clears: the same search afterwards is not served from cache", async () => {
    const { svc } = await start();
    await svc.engine.search(QUERY, KEY);
    await svc.clearCache();
    const again = await svc.engine.search(QUERY, KEY);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.value.served_from_cache).toBe(false);
  });

  it("does not forget quota already spent today", async () => {
    const { svc, files } = await start();
    await svc.engine.search(QUERY, KEY);
    await svc.persist();
    const spent = await svc.engine.quota.used(LOCAL_USER);
    expect(spent).toBeGreaterThan(0);

    await svc.clearCache();

    expect(await svc.engine.quota.used(LOCAL_USER)).toBe(spent);
    expect(files.files.has(QUOTA_FILE)).toBe(true);
  });

  it("does not delete the user's watches", async () => {
    const { svc, files } = await start();
    svc.watches.add(watch());
    await svc.persist();
    await svc.clearCache();

    const { svc: relaunched } = await start(files);
    expect(relaunched.watches.get("w1")).toBeDefined();
  });
});

describe("watches through AppServices", () => {
  it("persist and warm-start with their baseline and last-checked time", async () => {
    const { svc, files } = await start();
    svc.watches.add(watch());
    await svc.checkWatches(); // persists as part of the check

    const { svc: relaunched } = await start(files);
    const w = relaunched.watches.get("w1")!;
    expect(w.baseline.length).toBeGreaterThan(0);
    expect(w.lastCheckedAt).toBe(NOW.toISOString());
    expect(w.baselineWindow).toEqual({ date_from: "2026-10-01", date_to: "2026-10-30" });
  });

  it("shares one run between concurrent calls, so a double open cannot spend twice", async () => {
    const { svc } = await start();
    svc.watches.add(watch());
    const [a, b] = await Promise.all([svc.checkWatches(), svc.checkWatches()]);
    expect(a).toBe(b);
  });

  it("allows a fresh run once the previous one has finished", async () => {
    const { svc } = await start();
    svc.watches.add(watch());
    const first = await svc.checkWatches();
    const second = await svc.checkWatches();
    expect(second).not.toBe(first);
    // Inside the TTL, so the second run skips rather than spending again.
    expect(second[0]!.outcome).toEqual({ status: "skipped", reason: "checked_recently" });
  });

  it("does not write watches.json when nothing about the watches changed", async () => {
    const { svc, files } = await start();
    await svc.persist();
    expect(files.files.has(WATCHES_FILE)).toBe(false);
  });
});

describe("watches from before T14", () => {
  it("are migrated at launch: a proven relative rule becomes structured, the rest is kept for review, none dropped, the old file copied aside", async () => {
    const files = new MemoryFileStore();
    const v1 = JSON.stringify({
      version: 1,
      watches: [watch(), watch({ id: "w2", name: "October", text: "HKG to SEA October business" }), watch({ id: "w3", name: "Unread", text: "somewhere warm" })],
    });
    files.files.set(WATCHES_FILE, v1);
    const { svc } = await start(files);
    const byId = (id: string) => svc.watches.get(id)!;
    expect(byId("w1").draft!.dates).toEqual({ kind: "relative_days", days: 30, clock: "UTC" });
    expect(byId("w1").review ?? null).toBeNull();
    expect(byId("w2").review).toBe("dates");
    expect(byId("w3")).toMatchObject({ review: "unparsed", draft: null, text: "somewhere warm" });
    expect(files.files.get("watches.v1.json")).toBe(v1);
    // Saved in the new format, which reads back without migrating again.
    await svc.persist();
    expect(JSON.parse(files.files.get(WATCHES_FILE)!).version).toBe(2);
    const again = await start(files);
    expect(again.svc.watches.get("w1")!.draft!.dates).toEqual({ kind: "relative_days", days: 30, clock: "UTC" });
    expect(files.files.get("watches.v1.json")).toBe(v1);
  });
});

describe("a watches file this version cannot use is never lost (T14: old data is never deleted)", () => {
  it("a damaged file is copied aside as it was before anything is written, once; the list starts empty", async () => {
    const files = new MemoryFileStore();
    const torn = '{"version":2,"watches":[{"id":"w1","te';
    files.files.set(WATCHES_FILE, torn);
    const { svc } = await start(files);
    const aside = svc.watches.keptAside!;
    expect(aside).toMatch(/^watches\.damaged-2026-10-01T00-00-00-000Z\.json$/);
    expect(files.files.get(aside)).toBe(torn);
    expect(svc.watches.add(watch({ id: "w9" }))).toEqual({ ok: true });
    await svc.persist();
    expect(JSON.parse(files.files.get(WATCHES_FILE)!).watches.map((w: Watch) => w.id)).toEqual(["w9"]);
    expect(files.files.get(aside)).toBe(torn);
    // The next launch reads the new file: nothing is copied aside again.
    const again = await start(files);
    expect(again.svc.watches.keptAside).toBeNull();
    expect([...files.files.keys()].filter((k) => k.startsWith("watches.damaged-"))).toHaveLength(1);
  });

  it("a file from a newer version is held: never written over, however the app is used", async () => {
    const files = new MemoryFileStore();
    const newer = JSON.stringify({ version: 3, watches: [{ id: "future", text: "HKG to SEA", rule: { kind: "something new" } }] });
    files.files.set(WATCHES_FILE, newer);
    const { svc } = await start(files);
    expect(svc.watches.hold).toBe("newer");
    expect(svc.watches.add(watch())).toEqual({ ok: false, reason: "held" });
    await svc.checkWatches();
    await svc.persist();
    expect(files.files.get(WATCHES_FILE)).toBe(newer);
  });

  it("a file the device cannot read is held: nothing is written over it", async () => {
    class Unreadable extends MemoryFileStore {
      override async read(path: string) {
        if (path === WATCHES_FILE) throw new Error("The file could not be read.");
        return super.read(path);
      }
    }
    const files = new Unreadable();
    files.files.set(WATCHES_FILE, JSON.stringify({ version: 2, watches: [watch()] }));
    const { svc } = await start(files);
    expect(svc.watches.hold).toBe("unreadable");
    expect(svc.watches.add(watch({ id: "w2" }))).toEqual({ ok: false, reason: "held" });
    await svc.persist();
    expect(JSON.parse(files.files.get(WATCHES_FILE)!).watches.map((w: Watch) => w.id)).toEqual(["w1"]);
  });

  it("an entry this version cannot read survives a save", async () => {
    const files = new MemoryFileStore();
    files.files.set(WATCHES_FILE, JSON.stringify({ version: 2, watches: [watch(), { id: 42 }] }));
    const { svc } = await start(files);
    expect(svc.watches.carried).toBe(1);
    svc.watches.update("w1", { enabled: false });
    await svc.persist();
    expect(JSON.parse(files.files.get(WATCHES_FILE)!).watches).toContainEqual({ id: 42 });
  });
});
