/**
 * The workspace file storage keeps the last good version through a failed or torn write (UI/UX v1 T05; docs/02 D04).
 */
import { describe, expect, it } from "vitest";
import { MemoryFileStore } from "../store/persistence";
import { SlotFileStorage } from "./slot-storage";

/** A file store whose next write can fail before writing, or write half the text and then fail. */
class FlakyFiles extends MemoryFileStore {
  mode: "ok" | "fail" | "torn" = "ok";
  override async write(path: string, data: string) {
    if (this.mode === "fail") throw new Error("disk full");
    if (this.mode === "torn") {
      await super.write(path, data.slice(0, Math.floor(data.length / 2)));
      throw new Error("interrupted");
    }
    await super.write(path, data);
  }
}

describe("SlotFileStorage", () => {
  it("reads back what was written, newest first, and nothing for a name never written", async () => {
    const storage = new SlotFileStorage(new MemoryFileStore());
    expect(await storage.read("workspace-v1")).toBeNull();
    await storage.writeAtomically("workspace-v1", { n: 1 });
    await storage.writeAtomically("workspace-v1", { n: 2 });
    await storage.writeAtomically("workspace-v1", { n: 3 });
    expect(await storage.read("workspace-v1")).toEqual({ n: 3 });
  });

  it("alternates between two slot files and touches no other file", async () => {
    const files = new MemoryFileStore();
    files.files.set("cache.json", "{}");
    const storage = new SlotFileStorage(files);
    await storage.writeAtomically("workspace-v1", { n: 1 });
    await storage.writeAtomically("workspace-v1", { n: 2 });
    expect([...files.files.keys()].sort()).toEqual(["cache.json", "workspace-v1.a.json", "workspace-v1.b.json"]);
    expect(files.files.get("cache.json")).toBe("{}");
  });

  it("a write that fails keeps the previous version readable", async () => {
    const files = new FlakyFiles();
    const storage = new SlotFileStorage(files);
    await storage.writeAtomically("w", { n: 1 });
    files.mode = "fail";
    await expect(storage.writeAtomically("w", { n: 2 })).rejects.toThrow("disk full");
    expect(await storage.read("w")).toEqual({ n: 1 });
  });

  it("a write torn half-way keeps the previous version, and the next good write wins again", async () => {
    const files = new FlakyFiles();
    const storage = new SlotFileStorage(files);
    await storage.writeAtomically("w", { n: 1 });
    await storage.writeAtomically("w", { n: 2 });
    files.mode = "torn";
    await expect(storage.writeAtomically("w", { n: 3 })).rejects.toThrow("interrupted");
    expect(await storage.read("w")).toEqual({ n: 2 });
    files.mode = "ok";
    await storage.writeAtomically("w", { n: 4 });
    expect(await storage.read("w")).toEqual({ n: 4 });
  });

  it("concurrent writes are applied one after another, the last call winning", async () => {
    const storage = new SlotFileStorage(new MemoryFileStore());
    await Promise.all([1, 2, 3, 4].map((n) => storage.writeAtomically("w", { n })));
    expect(await storage.read("w")).toEqual({ n: 4 });
  });

  it("junk in a slot is ignored next to a good one; junk in both is unreadable, not nothing (T13, U-047)", async () => {
    const files = new MemoryFileStore();
    const storage = new SlotFileStorage(files);
    files.files.set("w.a.json", "not json");
    files.files.set("w.b.json", JSON.stringify({ generation: 0, value: 1 }));
    // Two files there, neither a readable version: said so (a caller must not write over them as if empty).
    await expect(storage.read("w")).rejects.toThrow(/could not be read/);
    files.files.set("w.b.json", JSON.stringify({ generation: 3, value: "ok" }));
    expect(await storage.read("w")).toBe("ok");
  });

  it("remove deletes both slots", async () => {
    const files = new MemoryFileStore();
    const storage = new SlotFileStorage(files);
    await storage.writeAtomically("w", 1);
    await storage.writeAtomically("w", 2);
    await storage.remove("w");
    expect(files.files.size).toBe(0);
    expect(await storage.read("w")).toBeNull();
  });

  it("a slot file that cannot be read is not taken as absent: read throws, and nothing is written over it (T13)", async () => {
    const files = new MemoryFileStore();
    const storage = new SlotFileStorage(files);
    await storage.writeAtomically("favorites-v1", { n: 1 });
    await storage.writeAtomically("favorites-v1", { n: 2 });
    const before = new Map(files.files);
    const read = files.read.bind(files);
    files.read = async (path) => {
      if (path === "favorites-v1.b.json") throw new Error("EIO");
      return read(path);
    };
    await expect(storage.read("favorites-v1")).rejects.toThrow(/could not be read/);
    await expect(storage.writeAtomically("favorites-v1", { n: 3 })).rejects.toThrow(/could not be read/);
    expect(files.files).toEqual(before);
    // Readable again: the newest version is still there.
    files.read = read;
    expect(await storage.read("favorites-v1")).toEqual({ n: 2 });
  });

  it("both slots torn, nothing good: unreadable, not empty, and not written over (T13)", async () => {
    const files = new MemoryFileStore();
    files.files.set("favorites-v1.a.json", '{"generation":1,"val');
    files.files.set("favorites-v1.b.json", '{"generation":2,"val');
    const storage = new SlotFileStorage(files);
    await expect(storage.read("favorites-v1")).rejects.toThrow(/could not be read/);
    await expect(storage.writeAtomically("favorites-v1", { n: 3 })).rejects.toThrow(/could not be read/);
    expect(files.files.get("favorites-v1.a.json")).toBe('{"generation":1,"val');
  });
});
