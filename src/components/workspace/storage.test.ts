/**
 * Each account's own storage on one browser (UI/UX v1 T18; acceptance A30): different accounts read different keys,
 * logout removes every workspace and keeps saved options, and a value that cannot be read is never written over.
 */
import { describe, expect, it } from "vitest";
import { FAVORITES_STORE, SignedOutWebStorageError, UnreadableWebStorageError, WORKSPACE_STORE, deviceEpoch, forgetWorkspacesOnDevice, storageKey, webStorage } from "./storage";

class MemoryStorage implements Storage {
  #items = new Map<string, string>();
  get length() {
    return this.#items.size;
  }
  clear() {
    this.#items.clear();
  }
  getItem(key: string) {
    return this.#items.get(key) ?? null;
  }
  key(index: number) {
    return [...this.#items.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.#items.delete(key);
  }
  setItem(key: string, value: string) {
    this.#items.set(key, value);
  }
}

describe("webStorage", () => {
  it("one account never reads another's values", async () => {
    const backing = new MemoryStorage();
    await webStorage(FAVORITES_STORE, "user-a", backing).writeAtomically("favorites-v1", { items: ["a"] });
    expect(await webStorage(FAVORITES_STORE, "user-b", backing).read("favorites-v1")).toBeNull();
    expect(await webStorage(FAVORITES_STORE, "user-a", backing).read("favorites-v1")).toEqual({ items: ["a"] });
    expect(backing.getItem(storageKey(FAVORITES_STORE, "user-a", "favorites-v1"))).toBe(JSON.stringify({ items: ["a"] }));
  });

  it("a value that cannot be read is refused, and never written over", async () => {
    const backing = new MemoryStorage();
    backing.setItem(storageKey(FAVORITES_STORE, "user-a", "favorites-v1"), "{not json");
    const port = webStorage(FAVORITES_STORE, "user-a", backing);
    await expect(port.read("favorites-v1")).rejects.toBeInstanceOf(UnreadableWebStorageError);
    await expect(port.writeAtomically("favorites-v1", { items: [] })).rejects.toBeInstanceOf(UnreadableWebStorageError);
    expect(backing.getItem(storageKey(FAVORITES_STORE, "user-a", "favorites-v1"))).toBe("{not json");
  });
});

describe("forgetWorkspacesOnDevice", () => {
  it("removes every account's workspace, keeps every account's saved options and anything else", async () => {
    const backing = new MemoryStorage();
    await webStorage(WORKSPACE_STORE, "user-a", backing).writeAtomically("workspace-v1", { snapshots: [] });
    await webStorage(WORKSPACE_STORE, "user-b", backing).writeAtomically("workspace-v1", { snapshots: [] });
    await webStorage(FAVORITES_STORE, "user-a", backing).writeAtomically("favorites-v1", { items: [] });
    backing.setItem("someone-else", "kept");
    forgetWorkspacesOnDevice(backing);
    expect(await webStorage(WORKSPACE_STORE, "user-a", backing).read("workspace-v1")).toBeNull();
    expect(await webStorage(WORKSPACE_STORE, "user-b", backing).read("workspace-v1")).toBeNull();
    expect(await webStorage(FAVORITES_STORE, "user-a", backing).read("favorites-v1")).toEqual({ items: [] });
    expect(backing.getItem("someone-else")).toBe("kept");
  });
});

describe("after a logout in this tab (T18 review REG-1)", () => {
  it("storage made before it writes nothing more, even for an answer that lands later", async () => {
    const backing = new MemoryStorage();
    const before = webStorage(WORKSPACE_STORE, "user-a", backing);
    const favoritesBefore = webStorage(FAVORITES_STORE, "user-a", backing);
    const epoch = deviceEpoch();
    forgetWorkspacesOnDevice(backing);
    expect(deviceEpoch()).toBe(epoch + 1);
    await expect(before.writeAtomically("workspace-v1", { snapshots: ["A's late answer"] })).rejects.toBeInstanceOf(SignedOutWebStorageError);
    await expect(favoritesBefore.writeAtomically("favorites-v1", { items: [] })).rejects.toBeInstanceOf(SignedOutWebStorageError);
    expect(backing.length).toBe(0);
    // The next account's storage, made after, writes as usual.
    await webStorage(WORKSPACE_STORE, "user-b", backing).writeAtomically("workspace-v1", { snapshots: [] });
    expect(backing.getItem(storageKey(WORKSPACE_STORE, "user-b", "workspace-v1"))).toBe(JSON.stringify({ snapshots: [] }));
  });

  it("the epoch moves even where the browser keeps no storage", () => {
    const epoch = deviceEpoch();
    forgetWorkspacesOnDevice(null);
    expect(deviceEpoch()).toBe(epoch + 1);
  });
});
