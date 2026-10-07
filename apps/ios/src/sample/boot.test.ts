/**
 * Booting on sample data (release plan step 16): the choice is read before bootstrap, sample mode runs on its own
 * ports — an in-memory key, the sample transport, files under sample/ — and never builds or calls the native HTTP
 * adapter, never reads or writes the real key, snapshots or today's real call count. Entering keeps the language and
 * appearance; leaving brings them back, keeps the choice and deletes sample/.
 */
import { SAMPLE_TIME_LABEL, timeLabel } from "@awardgrid/core/workspace/present";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SETTINGS_NAMESPACE } from "../app/settings-store";
import type { KeyStore } from "../native/keychain";
import { MemoryFileStore, SnapshotStore } from "../store/persistence";
import { SlotFileStorage } from "../workspace/slot-storage";

// The native adapter must never be built in sample mode: any call fails the test.
const nativeBuilt = vi.hoisted(() => ({ count: 0 }));
vi.mock("../native/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../native/http")>();
  return {
    ...actual,
    createNativeFetch: () => {
      nativeBuilt.count += 1;
      return async () => {
        throw new Error("native HTTP was called in sample mode");
      };
    },
  };
});

const { bootstrap } = await import("../app/bootstrap");
const { DATA_SOURCE_NAMESPACE, readDataSource, resolveBoot, writeDataSource } = await import("../app/data-source");
const { SAMPLE_INDEX, SAMPLE_KEY, SampleFiles, clearSampleFiles, enterSampleData, exitSampleData } = await import("./boot");

const NOW = new Date("2026-10-18T08:30:00Z");

/** A key store that fails the test if it is touched: the real Keychain item stands in for it. */
function untouchableKeys(): KeyStore & { touched: number } {
  const store = {
    touched: 0,
    async get() {
      store.touched += 1;
      return "real-key";
    },
    async set() {
      store.touched += 1;
    },
    async clear() {
      store.touched += 1;
    },
  };
  return store;
}

/** Every write and removal on a file store, by path. */
function recording(files: MemoryFileStore): { files: MemoryFileStore; touched: string[] } {
  const touched: string[] = [];
  const write = files.write.bind(files);
  const remove = files.remove.bind(files);
  files.write = async (path, data) => {
    touched.push(path);
    await write(path, data);
  };
  files.remove = async (path) => {
    touched.push(path);
    await remove(path);
  };
  return { files, touched };
}

beforeEach(() => {
  nativeBuilt.count = 0;
});

async function liveFilesWith(settings: Record<string, unknown> | null): Promise<MemoryFileStore> {
  const files = new MemoryFileStore();
  files.files.set("quota.json", JSON.stringify({ day: "2026-10-18", used: 412 }));
  files.files.set("cache.json", "{}");
  if (settings) await new SlotFileStorage(files).writeAtomically(SETTINGS_NAMESPACE, settings);
  return files;
}

async function bootSample(files: MemoryFileStore, liveKeys = untouchableKeys()) {
  const reboot = vi.fn();
  const live = { keys: liveKeys, snapshots: new SnapshotStore(files), now: () => NOW, locale: "en" as const };
  const options = await resolveBoot(live, { beforeSwitch: async () => {}, reboot });
  return { services: await bootstrap(options), options, reboot, liveKeys };
}

describe("the data source", () => {
  it("is live unless sample data was chosen; anything unreadable is live", async () => {
    const files = new MemoryFileStore();
    expect(await readDataSource(files)).toBe("live");
    await writeDataSource(files, "sample");
    expect(await readDataSource(files)).toBe("sample");
    await writeDataSource(files, "live");
    expect(await readDataSource(files)).toBe("live");
    files.files.set(`${DATA_SOURCE_NAMESPACE}.a.json`, "{torn");
    files.files.set(`${DATA_SOURCE_NAMESPACE}.b.json`, "{torn");
    expect(await readDataSource(files)).toBe("live");
  });

  it("boots live with the options it was given, and with the way into sample mode", async () => {
    const files = await liveFilesWith(null);
    const keys = untouchableKeys();
    const options = await resolveBoot({ keys, snapshots: new SnapshotStore(files), now: () => NOW, fetchImpl: async () => new Response("{}") }, { beforeSwitch: async () => {}, reboot: () => {} });
    expect(options.keys).toBe(keys);
    expect(options.dataSource?.kind).toBe("live");
    expect(options.dataSource?.coverage).toBeNull();
  });
});

describe("sample mode's boot", () => {
  it("enters: saves what live mode holds first, keeps the choice, and boots again", async () => {
    const files = await liveFilesWith(null);
    const order: string[] = [];
    const live = { snapshots: new SnapshotStore(files), now: () => NOW };
    const options = await resolveBoot(live, { beforeSwitch: async () => order.push("persist"), reboot: () => order.push("reboot") });
    await options.dataSource!.enterSample();
    expect(order).toEqual(["persist", "reboot"]);
    expect(await readDataSource(files)).toBe("sample");
  });

  it("runs on its own ports: the placeholder key, the sample transport, sample/ files; never native HTTP or the real key", async () => {
    const files = await liveFilesWith(null);
    await enterSampleData(files);
    const { services, options, liveKeys } = await bootSample(files);
    expect(services.dataSource.kind).toBe("sample");
    expect(services.dataSource.coverage?.airports).toBe(84);
    expect(options.keys).not.toBe(liveKeys);
    expect(await services.keys.get()).toBe(SAMPLE_KEY);
    expect(await services.anthropicKeys.get()).toBeNull();

    const recorded = recording(files);
    // A search, an option's itineraries, a watch check, a save: everything that could reach a transport or a file.
    const found = await services.searchText("Hong Kong to Seattle next month, business");
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.rows!.length).toBeGreaterThan(5);
    const shown = services.workspace.getState().displayedSnapshot!;
    const loaded = await services.details.load({ snapshotId: shown.id, rowKey: shown.rows[0]!.key });
    expect(loaded.kind).toBe("loaded");
    await services.checkWatches();
    await services.persist();
    await services.settings.setTheme("dark");

    expect(nativeBuilt.count).toBe(0);
    expect(liveKeys.touched).toBe(0);
    // Every write is under sample/: the real cache, call count, watches, workspace and settings are left as they were.
    expect(recorded.touched.length).toBeGreaterThan(0);
    expect(recorded.touched.filter((p) => !p.startsWith("sample/"))).toEqual([]);
    expect(files.files.get("quota.json")).toBe(JSON.stringify({ day: "2026-10-18", used: 412 }));
    expect(files.files.get("cache.json")).toBe("{}");
    expect(files.files.has("sample/quota.json")).toBe(true);
    // Sample mode's own call count started from zero: the real one was never read.
    expect((await services.engine.quotaView()).used).toBeLessThan(412);
    // The Anthropic transport refuses before anything is sent.
    await expect(options.anthropicFetch!("https://api.anthropic.com/v1/messages", { method: "POST" })).rejects.toThrow(/sample data/);
  });

  it("keeps the language and appearance chosen in Settings when entering, and brings sample mode's back when leaving", async () => {
    const files = await liveFilesWith({ locale: "zh", theme: "dark", aiConsent: { version: 1, at: "2026-10-01T00:00:00.000Z" } });
    await enterSampleData(files);
    const { services } = await bootSample(files);
    expect(services.settings.locale()).toBe("zh");
    expect(services.settings.theme()).toBe("dark");
    // Ask's permission is the person's live choice, never sample mode's.
    expect(services.settings.get().aiConsent).toBeNull();

    await services.settings.setLocale("en");
    await services.settings.setTheme("light");
    await exitSampleData(files);
    const back = (await new SlotFileStorage(files).read(SETTINGS_NAMESPACE)) as { locale: string; theme: string; aiConsent: unknown };
    expect(back.locale).toBe("en");
    expect(back.theme).toBe("light");
    expect(back.aiConsent).toEqual({ version: 1, at: "2026-10-01T00:00:00.000Z" });
  });

  it("leaves: the choice goes back to live, and every file under sample/ is deleted; nothing else is", async () => {
    const files = await liveFilesWith(null);
    await enterSampleData(files);
    const { services } = await bootSample(files);
    await services.searchText("LAX to Tokyo next month");
    await services.persist();
    expect([...files.files.keys()].some((p) => p.startsWith("sample/"))).toBe(true);
    const reboot = vi.fn();
    const options = await resolveBoot({ snapshots: new SnapshotStore(files), now: () => NOW }, { beforeSwitch: async () => {}, reboot });
    await options.dataSource!.exitSample();
    expect(reboot).toHaveBeenCalledOnce();
    expect(await readDataSource(files)).toBe("live");
    expect([...files.files.keys()].filter((p) => p.startsWith("sample/"))).toEqual([]);
    expect(files.files.get("quota.json")).toBe(JSON.stringify({ day: "2026-10-18", used: 412 }));
  });

  it("starts each visit empty: whatever an interrupted exit left is cleared on the way in", async () => {
    const files = new MemoryFileStore();
    const sample = new SampleFiles(files);
    await sample.write("cache.json", "left over");
    await sample.write("workspace-v1.a.json", "left over");
    expect(JSON.parse(files.files.get(SAMPLE_INDEX)!)).toEqual(["cache.json", "workspace-v1.a.json"]);
    await enterSampleData(files);
    expect(files.files.has("sample/cache.json")).toBe(false);
    expect(files.files.has("sample/workspace-v1.a.json")).toBe(false);
    await clearSampleFiles(files);
    expect([...files.files.keys()].filter((p) => p.startsWith("sample/"))).toEqual([]);
  });

  it("lists every path it writes, even when several writes start at once", async () => {
    const files = new MemoryFileStore();
    const sample = new SampleFiles(files);
    await Promise.all(["a.json", "b.json", "c.json", "d.json"].map((p) => sample.write(p, "x")));
    expect(JSON.parse(files.files.get(SAMPLE_INDEX)!)).toEqual(["a.json", "b.json", "c.json", "d.json"]);
    // A relaunch knows them too.
    await new SampleFiles(files).write("e.json", "x");
    expect(JSON.parse(files.files.get(SAMPLE_INDEX)!)).toEqual(["a.json", "b.json", "c.json", "d.json", "e.json"]);
  });
});

describe("the time line on a sample row (core present.ts, through its sample flag)", () => {
  it('says "Sample data" / "示例数据", never a source time or an age', () => {
    const time = { basis: "provider_updated" as const, providerAt: "2026-10-18T07:52:00Z", fetchedAt: "2026-10-18T08:00:00Z" };
    expect(timeLabel(time, NOW.toISOString(), "en", { sample: true })).toBe("Sample data");
    expect(timeLabel(time, NOW.toISOString(), "zh", { sample: true })).toBe("示例数据");
    expect(SAMPLE_TIME_LABEL).toEqual({ en: "Sample data", zh: "示例数据" });
    // Live rows are unchanged, with the zone given either way.
    expect(timeLabel(time, NOW.toISOString(), "en")).toBe("Source updated 38 min ago");
    const local = { basis: "local_fallback" as const, providerAt: null, fetchedAt: "2026-10-18T08:00:00Z" };
    expect(timeLabel(local, NOW.toISOString(), "en", "UTC")).toBe(timeLabel(local, NOW.toISOString(), "en", { timeZone: "UTC" }));
  });
});
