/** Fixture-only storage contract: enumeration stays inside its namespace and never counts as a write. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FILES_NAMESPACE, LocalFixtureFiles } from "../../fixture-host/files";
import type { FixtureRequestLog } from "../../fixture-host/protocol";

function fakeLocalStorage(): Storage {
  const values = new Map<string, string>();
  const storage = {} as Storage;
  Object.defineProperties(storage, {
    length: { get: () => values.size },
    key: { value: (index: number) => [...values.keys()][index] ?? null },
    getItem: { value: (key: string) => values.get(key) ?? null },
    setItem: { value: (key: string, value: string) => {
      values.set(key, value);
      Object.defineProperty(storage, key, { value, writable: true, enumerable: true, configurable: true });
    } },
    removeItem: { value: (key: string) => { values.delete(key); delete storage[key]; } },
    clear: { value: () => { for (const key of values.keys()) delete storage[key]; values.clear(); } },
  });
  return storage;
}

const log = (): FixtureRequestLog => ({
  seats: 0, trips: 0, anthropic: 0, writes: 0, seatsPaths: [], directSeats: 0, directAnthropic: 0,
  anthropicContext: [], oauth: { consent: 0, token: 0, refresh: 0 },
});

beforeEach(() => vi.stubGlobal("localStorage", fakeLocalStorage()));
afterEach(() => vi.unstubAllGlobals());

describe("LocalFixtureFiles enumeration", () => {
  it("lists only root-level files in the isolated fixture namespace", async () => {
    localStorage.setItem("outside:cache.json", "outside");
    localStorage.setItem("prefix:" + FILES_NAMESPACE + "watches.json", "outside");
    const files = new LocalFixtureFiles(log(), {
      preserve: true,
      failWrites: false,
      seed: { "cache.json": "cache", "watches.damaged-old.json": "old", "sample/cache.json": "sample", "workspace-v1.a.json": "workspace" },
    });
    expect((await files.list()).sort()).toEqual(["cache.json", "watches.damaged-old.json", "workspace-v1.a.json"]);
  });

  it("reflects new writes and removals without listing sample files", async () => {
    const requests = log();
    const files = new LocalFixtureFiles(requests, { preserve: false, seed: { "cache.json": "old" }, failWrites: false });
    await files.write("watches.v1.json", "watch");
    await files.write("sample/watches.json", "sample");
    await files.remove("cache.json");
    expect(await files.list()).toEqual(["watches.v1.json"]);
    expect(requests.writes).toBe(3);
  });

  it("enumerates without changing file contents, other namespaces or mutation counts", async () => {
    localStorage.setItem("outside", "keep");
    const requests = log();
    const files = new LocalFixtureFiles(requests, { preserve: true, seed: { "cache.json": "keep" }, failWrites: true });
    expect(await files.list()).toEqual(["cache.json"]);
    expect(await files.read("cache.json")).toBe("keep");
    expect(localStorage.getItem("outside")).toBe("keep");
    expect(requests.writes).toBe(0);
  });

  it("resets only its own namespace before seeding a fresh launch", async () => {
    localStorage.setItem(FILES_NAMESPACE + "old.json", "old");
    localStorage.setItem(FILES_NAMESPACE + "sample/old.json", "old sample");
    localStorage.setItem("outside", "keep");
    const requests = log();
    const files = new LocalFixtureFiles(requests, { preserve: false, seed: { "new.json": "new" }, failWrites: false });
    expect(await files.list()).toEqual(["new.json"]);
    expect(await files.read("old.json")).toBeNull();
    expect(await files.read("sample/old.json")).toBeNull();
    expect(localStorage.getItem("outside")).toBe("keep");
    expect(requests.writes).toBe(0);
  });
});
