/**
 * Launch-time wiring: warm start, and the quota observer being live BEFORE the first search.
 *
 * The scenario these protect is the one PIVOT §2 names — a reinstall mid-day. If the observer
 * were attached after the first response instead of at construction, the first call after a
 * reinstall would be the single call whose `X-RateLimit-Remaining` nobody read, and the app would
 * go on offering headroom seats.aero will not honour.
 */
import { describe, expect, it } from "vitest";
import { fakeFetch, jsonResponse } from "@awardgrid/core/test-fixtures/seatsaero/helpers";
import { LOCAL_USER } from "../search/search";
import { MemoryKeyStore } from "../native/keychain";
import { MemoryFileStore, SnapshotStore } from "../store/persistence";
import { bootstrap } from "./bootstrap";

const NOW = new Date("2026-10-01T00:00:00.000Z");
const KEY = "pro_test_key_ABC123xyz_DO_NOT_LEAK";

function seatsAero(body: unknown, headers: Record<string, string> = {}) {
  return fakeFetch((req) =>
    req.url.pathname.endsWith("/routes")
      ? jsonResponse([])
      : new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } }),
  );
}

describe("bootstrap", () => {
  it("starts cold without any snapshot on disk", async () => {
    const files = new MemoryFileStore();
    const svc = await bootstrap({
      keys: new MemoryKeyStore(),
      snapshots: new SnapshotStore(files),
      now: () => NOW,
      fetchImpl: seatsAero({ data: [], hasMore: false }),
    });
    expect(await svc.engine.quota.used(LOCAL_USER)).toBe(0);
  });

  it("persists and then warm-starts: the cache and quota survive a relaunch", async () => {
    const files = new MemoryFileStore();
    const fetchImpl = seatsAero({ data: [], hasMore: false });

    const first = await bootstrap({
      keys: new MemoryKeyStore(),
      snapshots: new SnapshotStore(files),
      now: () => NOW,
      fetchImpl,
    });
    await first.engine.search("HKG to SEA next 30 days business", KEY);
    const usedBefore = await first.engine.quota.used(LOCAL_USER);
    expect(usedBefore).toBeGreaterThan(0);
    await first.persist();

    // Relaunch against the same "disk".
    const second = await bootstrap({
      keys: new MemoryKeyStore(),
      snapshots: new SnapshotStore(files),
      now: () => NOW,
      fetchImpl,
    });
    expect(await second.engine.quota.used(LOCAL_USER)).toBe(usedBefore);
  });

  it("reads X-RateLimit-Remaining on the FIRST response after a fresh install", async () => {
    const files = new MemoryFileStore();
    const svc = await bootstrap({
      keys: new MemoryKeyStore(),
      snapshots: new SnapshotStore(files),
      now: () => NOW,
      // seats.aero says 400 left of 1,000 — i.e. 600 already spent on another device or before
      // the reinstall. The local counter starts at 0 and must not be believed.
      fetchImpl: seatsAero({ data: [], hasMore: false }, { "X-RateLimit-Remaining": "400" }),
    });

    await svc.engine.search("HKG to SEA next 30 days business", KEY);
    expect(await svc.engine.quota.used(LOCAL_USER)).toBeGreaterThanOrEqual(600);
    // 950 soft limit - 600 spent = 350, not 950.
    expect(await svc.engine.quota.remaining(LOCAL_USER)).toBeLessThanOrEqual(350);
  });

  it("ignores a rate-limit header from anywhere that is not seats.aero", async () => {
    const files = new MemoryFileStore();
    const svc = await bootstrap({
      keys: new MemoryKeyStore(),
      snapshots: new SnapshotStore(files),
      now: () => NOW,
      fetchImpl: fakeFetch(() => jsonResponse([])),
    });
    // Nothing has called seats.aero, so nothing should have been inferred.
    expect(await svc.engine.quota.used(LOCAL_USER)).toBe(0);
  });

  it("survives a corrupt snapshot rather than failing to launch", async () => {
    const files = new MemoryFileStore();
    await files.write("cache.json", "{ this is not json");
    await files.write("quota.json", "also not json");

    const svc = await bootstrap({
      keys: new MemoryKeyStore(),
      snapshots: new SnapshotStore(files),
      now: () => NOW,
      fetchImpl: seatsAero({ data: [], hasMore: false }),
    });
    expect(await svc.engine.quota.used(LOCAL_USER)).toBe(0);
  });

  it("does not rewrite the quota file when nothing changed", async () => {
    const files = new MemoryFileStore();
    const svc = await bootstrap({
      keys: new MemoryKeyStore(),
      snapshots: new SnapshotStore(files),
      now: () => NOW,
      fetchImpl: seatsAero({ data: [], hasMore: false }),
    });
    await svc.persist();
    expect(files.files.has("quota.json")).toBe(false);

    await svc.engine.search("HKG to SEA next 30 days business", KEY);
    await svc.persist();
    expect(files.files.has("quota.json")).toBe(true);
  });

  it("keeps the key in the key store, never in a snapshot file", async () => {
    const files = new MemoryFileStore();
    const keys = new MemoryKeyStore();
    await keys.set(KEY);

    const svc = await bootstrap({
      keys,
      snapshots: new SnapshotStore(files),
      now: () => NOW,
      fetchImpl: seatsAero({ data: [], hasMore: false }),
    });
    await svc.engine.search("HKG to SEA next 30 days business", await svc.keys.get());
    await svc.persist();

    for (const contents of files.files.values()) expect(contents).not.toContain(KEY);
  });
});
