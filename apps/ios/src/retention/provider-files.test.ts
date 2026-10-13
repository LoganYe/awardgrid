import { describe, expect, it } from "vitest";
import { fixtureSnapshot, FIXTURE_NOW } from "@awardgrid/core/test-fixtures/uiux/factory";
import device from "../app/__fixtures__/pre-uiux-device.json";
import { MemoryFileStore } from "../store/persistence";
import { ProviderConfigurationFiles } from "./provider-files";

describe("OAuth configuration files", () => {
  it("preserves a selected option as its narrow query and removes provider IDs from both Saved identities", async () => {
    const files = new MemoryFileStore();
    const query = { origins: ["HKG", "SEA"], destinations: ["NRT", "HND"], date_from: "2026-10-01", date_to: "2026-10-30", cabins: ["J", "F"], programs: undefined, raw_text: "My broad search" };
    const option = { schemaVersion: 1, id: "fav-run#digest~alaska~provider-result-id~SEA~NRT~2026-10-05~J~n100", originalSnapshotId: "run#digest~alaska~provider-result-id~SEA~NRT~2026-10-05~J~n100", query, savedAt: FIXTURE_NOW, rows: [{ value: { program: "alaska", origin: "SEA", dest: "NRT", date: "2026-10-05", cabin: "J", miles: 75000, source_id: "provider-result-id" } }], coverage: { state: "complete" } };
    files.files.set("favorites-v1.a.json", JSON.stringify({ generation: 1, value: { schemaVersion: 1, items: [option] } }));
    const config = new ProviderConfigurationFiles(files);
    await config.sweep();
    const saved = JSON.parse(files.files.get("favorites-v1.a.json")!).value.items[0];
    expect(saved.query).toEqual({ ...query, origins: ["SEA"], destinations: ["NRT"], date_from: "2026-10-05", date_to: "2026-10-05", cabins: ["J"], programs: ["alaska"] });
    expect(saved.id).not.toContain("provider-result-id");
    expect(saved.originalSnapshotId).not.toContain("provider-result-id");
    expect(saved.rows).toEqual([]);
  });
  it("cleans both old workspace and Saved slots, including provider coverage and an option's source identity", async () => {
    const files = new MemoryFileStore();
    const snapshot = fixtureSnapshot();
    const item = { schemaVersion: 1, id: "saved", query: snapshot.query, savedAt: FIXTURE_NOW, rows: snapshot.rows, coverage: snapshot.coverage, originalSnapshotId: `${snapshot.id}#${snapshot.rows[0]!.key}` };
    for (const slot of ["a", "b"]) {
      files.files.set(`workspace-v1.${slot}.json`, JSON.stringify({ generation: 1, value: { schemaVersion: 1, preferences: { kind: "calendar" }, snapshots: [snapshot], selectionEntries: [{ row: snapshot.rows[0] }] } }));
      files.files.set(`favorites-v1.${slot}.json`, JSON.stringify({ generation: 1, value: { schemaVersion: 1, items: [item] } }));
    }
    const config = new ProviderConfigurationFiles(files);
    await config.sweep();
    expect(config.problems()).toEqual([]);
    for (const slot of ["a", "b"]) {
      const workspace = JSON.parse(files.files.get(`workspace-v1.${slot}.json`)!);
      expect(workspace.value.snapshots[0]).toEqual({ ...snapshot, rows: [], coverage: { state: "unknown" }, receipt: { sentCalls: null, fromCache: false } });
      expect(workspace.value.selectionEntries).toEqual([]);
      expect(workspace.value.preferences).toEqual({ kind: "calendar" });
      const saved = JSON.parse(files.files.get(`favorites-v1.${slot}.json`)!);
      expect(saved.value.items[0]).toMatchObject({ rows: [], coverage: { state: "unknown" }, rowsRemoved: { at: FIXTURE_NOW, options: 0 }, query: { origins: ["HKG"], destinations: ["SEA"], date_from: "2026-10-18", date_to: "2026-10-18", cabins: ["J"], programs: ["aeroplan"] } });
      expect(saved.value.items[0].id).not.toContain("synthetic-hkg-sea-option");
      expect(saved.value.items[0].originalSnapshotId).not.toContain("synthetic-hkg-sea-option");
    }
  });

  it("cleans old Ask answers, result refs, proposals' explanations, tool replies and route/flight memo while keeping the user's question", async () => {
    const files = new MemoryFileStore();
    const raw = JSON.parse(device.files["ask.json"]);
    raw.conversation.entries[0].proposals = [{ id: "p", reason: "The provider says 75000 miles", proposed: { max_miles: 80000 }, base: { max_miles: 90000 } }];
    raw.conversation.bookingUrls = ["https://provider.example/result"];
    raw.conversation.flightsMemo = [{ trips: [{ miles: 75000 }] }];
    files.files.set("ask.json", JSON.stringify(raw));
    const config = new ProviderConfigurationFiles(files);
    await config.sweep();
    const kept = JSON.parse(files.files.get("ask.json")!);
    expect(kept.conversation.entries[0].question).toBe("Cheapest business class from SEA to Tokyo in October?");
    expect(kept.conversation.committed).toEqual([]);
    expect(kept.conversation.entries[0].texts).toEqual([]);
    expect(kept.conversation.entries[0].steps).toEqual([]);
    expect(kept.conversation.entries[0].context.refs).toEqual([]);
    expect(kept.conversation.entries[0].proposals[0]).toEqual({ ...raw.conversation.entries[0].proposals[0], reason: "" });
    expect(kept.conversation.seenIds).toEqual([]);
    expect(kept.conversation.bookingUrls).toEqual([]);
    expect(kept.conversation.flightsMemo).toEqual([]);
    expect(files.files.get("ask.json")).not.toContain("75000");
  });

  it("keeps unrelated and sample files byte for byte while cleaning every known watch copy", async () => {
    const files = new MemoryFileStore();
    const watch = { id: "w", text: "my query", name: "my name", enabled: false, baseline: [{ miles: 99991, seats_left: 2 }], unseenChanges: [{ before: { miles: 99991 }, after: { miles: 77771 } }], lastResult: { message: "99991 miles" }, ownSetting: { keep: true } };
    const raw = JSON.stringify({ version: 2, watches: [watch] });
    for (const path of ["watches.json", "watches.v1.json", "watches.damaged-2026-09-30.json", "sample/watches.json", "other-app.json"]) files.files.set(path, raw);
    const config = new ProviderConfigurationFiles(files);
    await config.sweep();
    for (const path of ["watches.json", "watches.v1.json", "watches.damaged-2026-09-30.json"]) {
      expect(JSON.parse(files.files.get(path)!).watches[0]).toMatchObject({ name: "my name", text: "my query", enabled: false, ownSetting: { keep: true }, baseline: [], unseenChanges: null, lastResult: null });
      expect(files.files.get(path)).not.toContain("99991");
      expect(files.files.get(path)).not.toContain("77771");
    }
    expect(files.files.get("sample/watches.json")).toBe(raw);
    expect(files.files.get("other-app.json")).toBe(raw);
  });

  it("reports a write that returns without replacing the old file and retries after storage recovers", async () => {
    const files = new MemoryFileStore();
    files.files.set("cache.json", device.files["cache.json"]);
    const write = files.write.bind(files);
    let broken = true;
    files.write = async (path, data) => { if (!broken) await write(path, data); };
    const config = new ProviderConfigurationFiles(files);
    await config.sweep();
    expect(config.problems().join()).toContain("could not be verified");
    expect(files.files.get("cache.json")).toContain('"miles":75000');
    expect(JSON.parse((await config.read("cache.json"))!).users[0].rows).toEqual([]);
    broken = false;
    await config.sweep();
    expect(config.problems()).toEqual([]);
    expect(JSON.parse(files.files.get("cache.json")!).users[0].rows).toEqual([]);
  });

  it("cannot overwrite a newer user configuration when a cleanup read overlaps its save", async () => {
    const files = new MemoryFileStore();
    files.files.set("workspace-v1.a.json", JSON.stringify({ generation: 1, value: { schemaVersion: 1, snapshots: [fixtureSnapshot()], preferences: { kind: "list" } } }));
    const write = files.write.bind(files);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    let cleaning = false;
    files.write = async (path, text) => {
      if (!cleaning) { cleaning = true; await pending; }
      await write(path, text);
    };
    const config = new ProviderConfigurationFiles(files);
    const reading = config.read("workspace-v1.a.json");
    while (!cleaning) await Promise.resolve();
    const saving = config.write("workspace-v1.a.json", JSON.stringify({ generation: 2, value: { schemaVersion: 1, snapshots: [], preferences: { kind: "calendar" } } }));
    await Promise.resolve();
    release();
    await Promise.all([reading, saving]);
    expect(JSON.parse(files.files.get("workspace-v1.a.json")!).value.preferences).toEqual({ kind: "calendar" });
  });

  it.each([
    JSON.stringify({ generation: 1, value: { schemaVersion: 2, snapshots: [], futureUserSetting: "keep-me" } }),
    '{"generation":1,"futureUserSetting":"keep-me"',
  ])("refuses a normal save over unknown or damaged user configuration after cleanup has held it", async (raw) => {
    const files = new MemoryFileStore();
    files.files.set("workspace-v1.a.json", raw);
    const config = new ProviderConfigurationFiles(files);
    await config.sweep();
    await expect(config.write("workspace-v1.a.json", JSON.stringify({ generation: 2, value: { schemaVersion: 1, snapshots: [], preferences: { kind: "list" } } }))).rejects.toThrow();
    expect(files.files.get("workspace-v1.a.json")).toContain("keep-me");
    expect(config.problems().length).toBeGreaterThan(0);
  });

  it("propagates a removal failure, preserving its cleanup problem until the file is actually gone", async () => {
    const files = new MemoryFileStore();
    files.files.set("cache.json", device.files["cache.json"]);
    files.remove = async () => { throw new Error("permission denied"); };
    const config = new ProviderConfigurationFiles(files);
    await expect(config.remove("cache.json")).rejects.toThrow("permission denied");
    expect(config.problems().join()).toContain("permission denied");
    expect(files.files.has("cache.json")).toBe(true);
  });
});
