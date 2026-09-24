/**
 * The workspace through the app's own services (UI/UX v1 T05; A08, A09): a text search becomes a workspace revision
 * on the shared engine, a failed search keeps the snapshot on screen, the workspace is saved in its own files, and a
 * relaunch restores it without sending anything.
 */
import { describe, expect, it } from "vitest";
import { fakeFetch, jsonResponse } from "@awardgrid/core/test-fixtures/seatsaero/helpers";
import { MemoryKeyStore } from "../native/keychain";
import { CACHE_FILE, MemoryFileStore, QUOTA_FILE, SnapshotStore } from "../store/persistence";
import { bootstrap } from "./bootstrap";

const NOW = new Date("2026-10-01T00:00:00.000Z");
const KEY = "pro_workspace_test_key_DO_NOT_LEAK";

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

/** A fake seats.aero that counts requests and can be switched to answer 500. */
function seatsAero() {
  const state = { calls: 0, fail: false, hosts: new Set<string>() };
  const fetchImpl = fakeFetch((req) => {
    state.calls += 1;
    state.hosts.add(req.url.host);
    if (state.fail) return jsonResponse({ error: "down" }, 500);
    return req.url.pathname.endsWith("/routes") ? jsonResponse([]) : jsonResponse({ data: [apiRow("2026-10-05")], hasMore: false });
  });
  return { fetchImpl, state };
}

async function start(files = new MemoryFileStore(), fake = seatsAero(), key: string | null = KEY) {
  const keys = new MemoryKeyStore();
  if (key) await keys.set(key);
  const svc = await bootstrap({ keys, snapshots: new SnapshotStore(files), now: () => NOW, fetchImpl: fake.fetchImpl });
  return { svc, files, fake };
}

describe("the workspace in the app", () => {
  it("a text search runs as a workspace revision and is what the screen and Ask read", async () => {
    const { svc, fake } = await start();
    const res = await svc.searchText("HKG to SEA next 30 days business");
    expect(res.ok).toBe(true);
    const state = svc.workspace.getState();
    expect(state.revision).toBe(1);
    expect(state.run).toMatchObject({ kind: "finished", revision: 1 });
    expect(state.displayedSnapshot?.query.origins).toEqual(["HKG"]);
    expect(state.displayedSnapshot?.rows.length).toBeGreaterThan(0);
    expect(svc.lastSearch.get()?.value.query).toEqual(state.displayedSnapshot?.query);
    expect([...fake.state.hosts]).toEqual(["seats.aero"]);
  });

  it("at the moment a search is shown, the last search is already this session's typed entry, not a saved one", async () => {
    const { svc } = await start();
    const seen: Array<{ text: string | undefined; savedAt: string | undefined; engineAnswer: boolean }> = [];
    svc.workspace.subscribe(() => {
      if (svc.workspace.getState().run.kind !== "finished") return;
      const entry = svc.lastSearch.get();
      // Only the engine's own answer carries today's quota; a view rebuilt from the snapshot does not.
      seen.push({ text: entry?.text, savedAt: entry?.savedAt, engineAnswer: entry?.value.quota !== undefined });
    });
    await svc.searchText("HKG to SEA next 30 days business");
    expect(seen).toEqual([{ text: "HKG to SEA next 30 days business", savedAt: undefined, engineAnswer: true }]);
  });

  it("a parse failure or a missing key starts no run and sends nothing", async () => {
    const { svc, fake } = await start(new MemoryFileStore(), seatsAero(), null);
    expect(await svc.searchText("HKG to SEA next 30 days business")).toMatchObject({ ok: false, error: "no_key" });
    const withKey = await start();
    expect(await withKey.svc.searchText("   ")).toMatchObject({ ok: false, error: "invalid_body" });
    expect(svc.workspace.getState().revision).toBe(0);
    expect(withKey.svc.workspace.getState().revision).toBe(0);
    expect(fake.state.calls + withKey.fake.state.calls).toBe(0);
  });

  it("a failed search keeps the snapshot on screen and its query, and says the new one failed", async () => {
    const { svc, fake } = await start();
    await svc.searchText("HKG to SEA next 30 days business");
    const shown = svc.workspace.getState().displayedSnapshot;
    fake.state.fail = true;
    const res = await svc.searchText("SFO to NRT next 60 days business");
    expect(res).toMatchObject({ ok: false, error: "seatsaero" });
    const state = svc.workspace.getState();
    expect(state.displayedSnapshot).toBe(shown);
    expect(state.displayedSnapshot?.query.origins).toEqual(["HKG"]);
    expect(state.run).toMatchObject({ kind: "failed", revision: 2, code: "seatsaero" });
    expect(svc.lastSearch.get()?.value.query.origins).toEqual(["HKG"]);
  });

  it("persist writes the workspace to its own files and leaves the older files as they were", async () => {
    const { svc, files } = await start();
    await svc.searchText("HKG to SEA next 30 days business");
    await svc.persist();
    expect(svc.lastWorkspaceSave()).toEqual({ ok: true });
    const names = [...files.files.keys()];
    expect(names).toContain("workspace-v1.a.json");
    expect(names).toContain(CACHE_FILE);
    expect(names).toContain(QUOTA_FILE);
    expect(files.files.get(CACHE_FILE)).not.toContain('"snapshots"');
    for (const contents of files.files.values()) expect(contents).not.toContain(KEY);
  });

  it("a relaunch restores the workspace and sends nothing until asked", async () => {
    const first = await start();
    await first.svc.searchText("HKG to SEA next 30 days business");
    first.svc.workspace.setPreferences({ kind: "calendar" });
    await first.svc.persist();

    const fake = seatsAero();
    const again = await start(first.files, fake);
    expect(fake.state.calls).toBe(0);
    const state = again.svc.workspace.getState();
    expect(state.displayedSnapshot?.query.origins).toEqual(["HKG"]);
    expect(state.preferences.kind).toBe("calendar");
    expect(state.run).toEqual({ kind: "idle" });
    // The next run continues the revision count.
    await again.svc.searchText("HKG to SEA next 30 days business");
    expect(again.svc.workspace.getState().revision).toBe(2);
  });

  it("a failed workspace save is recorded, does not stop the other saves, and keeps the last good file", async () => {
    const files = new MemoryFileStore();
    const { svc } = await start(files);
    await svc.searchText("HKG to SEA next 30 days business");
    await svc.persist();
    const good = files.files.get("workspace-v1.a.json");
    const write = files.write.bind(files);
    files.write = async (path, data) => {
      if (path.startsWith("workspace-v1")) throw new Error("disk full");
      await write(path, data);
    };
    await svc.searchText("SFO to NRT next 60 days business");
    await expect(svc.persist()).resolves.toBeUndefined();
    expect(svc.lastWorkspaceSave()).toMatchObject({ ok: false, code: "write_failed" });
    expect(files.files.get("workspace-v1.a.json")).toBe(good);
    expect(files.files.get(CACHE_FILE)).toContain("NRT");
  });
});
