/**
 * T22: the new build started on exactly what the app before UI/UX v1 left on a device (plan 04 T22 Step 3: "record
 * migration versions and failure recovery; old versions stay readable, keys and quota untouched"; docs/07 safe
 * rollback). The files were written by that commit's own code (__fixtures__/pre-uiux-device.json), not typed by hand.
 *
 *   - Starting the new build (bootstrap: restoring and migrating) reads everything, sends nothing and never reads,
 *     writes or clears a key. The cache, the quota count and the conversation read as they were, and their files are
 *     left byte for byte.
 *   - Opening the app then checks due watches with the stored key, as the old build did (App.tsx): that reads the
 *     key, spends calls and saves the cache, quota and watches, in the shapes the old build reads (T22 review MIGR-01).
 *   - Watches move to version 2 with the old file copied aside first, byte for byte; none is dropped.
 *   - The new build's own data goes into its own namespaces; no old file is deleted by using it.
 * What the old build reads back after this (the rollback half) is checked against that commit's code, in the evidence.
 */
import { describe, expect, it, vi } from "vitest";
import { fakeFetch, jsonResponse } from "@awardgrid/core/test-fixtures/seatsaero/helpers";
import type { KeyStore } from "../native/keychain";
import { LOCAL_USER } from "../search/search";
import { ASK_FILE } from "../store/ask-store";
import { favoriteFromSnapshot } from "../store/favorites-store";
import { CACHE_FILE, MemoryFileStore, QUOTA_FILE, SnapshotStore, WATCHES_FILE } from "../store/persistence";
import { bootstrap } from "./bootstrap";
import device from "./__fixtures__/pre-uiux-device.json";

const NOW = new Date(device.now);
const OLD = device.files as Record<string, string>;

/** A key store that records every use, holding one fake key. */
function watchedKeys(value: string): KeyStore & { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> } {
  let held: string | null = value;
  return {
    get: vi.fn(async () => held),
    set: vi.fn(async (next: string) => {
      held = next;
    }),
    clear: vi.fn(async () => {
      held = null;
    }),
  };
}

/** seats.aero answering one synthetic row, for the test that uses the new build after launching. */
const seatsAero = () =>
  fakeFetch((req) =>
    req.url.pathname.endsWith("/routes")
      ? jsonResponse([])
      : jsonResponse({
          data: [
            {
              ID: "id-HKG-SEA-2026-10-12", RouteID: "r1", Route: { ID: "r1", OriginAirport: "HKG", DestinationAirport: "SEA", Source: "alaska" },
              Date: "2026-10-12", ParsedDate: "2026-10-12T00:00:00Z", Source: "alaska",
              JAvailable: true, JMileageCost: "80000", JRemainingSeats: 2, JAirlines: "AS", JDirect: true, YAvailable: false, WAvailable: false, FAvailable: false,
            },
          ],
          hasMore: false,
        }),
  ) as unknown as typeof fetch;

async function launch(files: MemoryFileStore, answer = false) {
  const keys = watchedKeys(device.keys.seats);
  const anthropicKeys = watchedKeys(device.keys.anthropic);
  const fetchImpl = answer
    ? seatsAero()
    : (vi.fn(async () => {
        throw new Error("nothing may be sent by launching");
      }) as unknown as typeof fetch);
  const svc = await bootstrap({ keys, anthropicKeys, snapshots: new SnapshotStore(files), now: () => NOW, fetchImpl, anthropicFetch: fetchImpl });
  return { svc, keys, anthropicKeys, fetchImpl };
}

const oldDevice = () => {
  const files = new MemoryFileStore();
  for (const [name, text] of Object.entries(OLD)) files.files.set(name, text);
  return files;
};

describe("upgrading from the app before UI/UX v1", () => {
  it("the fixture is the old app's own: version-1 files, a question answered, two text watches, 600 calls today", () => {
    expect(Object.keys(OLD).sort()).toEqual([ASK_FILE, CACHE_FILE, QUOTA_FILE, WATCHES_FILE].sort());
    for (const name of Object.keys(OLD)) expect(JSON.parse(OLD[name]!).version).toBe(1);
    expect(JSON.parse(OLD[QUOTA_FILE]!).days).toEqual({ [device.now.slice(0, 10)]: device.quotaUsed });
    for (const text of Object.values(OLD)) {
      expect(text).not.toContain(device.keys.seats);
      expect(text).not.toContain(device.keys.anthropic);
    }
  });

  it("starting the new build reads it all and sends nothing; no key is read, written or cleared; the old files stay as they were", async () => {
    const files = oldDevice();
    const { svc, keys, anthropicKeys, fetchImpl } = await launch(files);
    expect(fetchImpl).not.toHaveBeenCalled();
    for (const k of [keys, anthropicKeys]) {
      expect(k.get).not.toHaveBeenCalled();
      expect(k.set).not.toHaveBeenCalled();
      expect(k.clear).not.toHaveBeenCalled();
    }
    // The quota spent today is the old count, and the old file is not rewritten by launching.
    expect(await svc.engine.quota.used(LOCAL_USER)).toBe(device.quotaUsed);
    expect(files.files.get(QUOTA_FILE)).toBe(OLD[QUOTA_FILE]);
    expect(files.files.get(CACHE_FILE)).toBe(OLD[CACHE_FILE]);
    expect(files.files.get(ASK_FILE)).toBe(OLD[ASK_FILE]);
    // The conversation reads as it was: the old answered question.
    expect(svc.ask.state().entries).toHaveLength(1);
    expect(svc.ask.state().entries[0]!.end?.status).toBe("answered");
    // Watches: both kept. The one whose words give its dates is structured; the other waits for review, as text.
    expect(svc.watches.all().map((w) => w.id).sort()).toEqual(["w-old-1", "w-old-2"]);
    expect(svc.watches.get("w-old-1")!.draft!.dates).toEqual({ kind: "relative_days", days: 30, clock: "UTC" });
    expect(svc.watches.get("w-old-2")).toMatchObject({ review: "unparsed", draft: null, text: "somewhere warm in winter" });
    // The old watches file is copied aside, byte for byte, before anything is written over it.
    expect(files.files.get("watches.v1.json")).toBe(OLD[WATCHES_FILE]);
  });

  it("using the new build adds its own files and deletes none; the quota and cache keep their old shapes", async () => {
    const files = oldDevice();
    const { svc, keys, anthropicKeys } = await launch(files, true);
    // The old cache rows were read into memory: saved again with nothing new, they are all still there (review TEST-6).
    const oldIds = (JSON.parse(OLD[CACHE_FILE]!).users[0].rows as Array<{ source_id: string }>).map((r) => r.source_id);
    await svc.persist();
    expect((JSON.parse(files.files.get(CACHE_FILE)!).users[0].rows as Array<{ source_id: string }>).map((r) => r.source_id)).toEqual(expect.arrayContaining(oldIds));
    // A search through the workspace, and its results saved: both go into the new build's own namespaces.
    await svc.searchText("HKG to SEA next 30 days business");
    const shown = svc.workspace.getState().displayedSnapshot;
    expect(shown).not.toBeNull();
    expect((await svc.favorites.save(favoriteFromSnapshot(shown!, NOW.toISOString(), `fav-${shown!.id}`))).ok).toBe(true);
    await svc.persist();
    const added = [...files.files.keys()].filter((name) => !(name in OLD)).sort();
    expect(added.some((name) => name.startsWith("workspace-v1"))).toBe(true);
    expect(added.some((name) => name.startsWith("favorites-v1"))).toBe(true);
    expect(added).toContain("watches.v1.json");
    for (const name of Object.keys(OLD)) expect(files.files.has(name)).toBe(true);
    expect(files.files.get("watches.v1.json")).toBe(OLD[WATCHES_FILE]);
    expect(JSON.parse(files.files.get(WATCHES_FILE)!).version).toBe(2);
    // quota.json and cache.json keep the version and the fields the old build reads.
    // The search spent one call more on top of the old count, in the old file's shape.
    const quota = JSON.parse(files.files.get(QUOTA_FILE)!);
    expect(quota.version).toBe(1);
    expect(Object.keys(quota.days)).toEqual([device.now.slice(0, 10)]);
    expect(quota.days[device.now.slice(0, 10)]).toBeGreaterThanOrEqual(device.quotaUsed);
    const cache = JSON.parse(files.files.get(CACHE_FILE)!);
    expect(cache.version).toBe(1);
    expect((cache.users[0].rows as Array<{ source_id: string }>).map((r) => r.source_id)).toEqual(expect.arrayContaining(oldIds));
    const oldRow = JSON.parse(OLD[CACHE_FILE]!).users[0].rows[0];
    for (const field of Object.keys(oldRow)) expect(cache.users[0].rows[0]).toHaveProperty(field);
    expect(JSON.parse(files.files.get(ASK_FILE)!).version).toBe(1);
    // No key in any file, old or new; no key was touched.
    for (const text of files.files.values()) {
      expect(text).not.toContain(device.keys.seats);
      expect(text).not.toContain(device.keys.anthropic);
    }
    for (const k of [keys, anthropicKeys]) {
      expect(k.set).not.toHaveBeenCalled();
      expect(k.clear).not.toHaveBeenCalled();
    }
    // For the rollback check against the old code (evidence T22): what this build left behind.
    if (process.env.UPGRADE_OUT) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(process.env.UPGRADE_OUT, JSON.stringify({ files: Object.fromEntries([...files.files.entries()].sort()) }, null, 2));
    }
  });

  it("opening the app then checks due watches with the stored key, as the old build did, and saves in the old shapes", async () => {
    const files = oldDevice();
    const { svc, keys, fetchImpl } = await launch(files, true);
    // What App.tsx does once the services exist.
    await svc.checkWatches();
    expect(keys.get).toHaveBeenCalled();
    const sent = (fetchImpl as unknown as { calls: Array<{ url: URL }> }).calls;
    expect(sent.some((c) => c.url.pathname.endsWith("/search"))).toBe(true);
    expect(keys.set).not.toHaveBeenCalled();
    expect(keys.clear).not.toHaveBeenCalled();
    const quota = JSON.parse(files.files.get(QUOTA_FILE)!);
    expect(quota.version).toBe(1);
    expect(quota.days[device.now.slice(0, 10)]).toBeGreaterThan(device.quotaUsed);
    expect(JSON.parse(files.files.get(WATCHES_FILE)!).version).toBe(2);
    expect(files.files.get("watches.v1.json")).toBe(OLD[WATCHES_FILE]);
    expect(JSON.parse(files.files.get(CACHE_FILE)!).version).toBe(1);
    for (const name of Object.keys(OLD)) expect(files.files.has(name)).toBe(true);
  });
});
