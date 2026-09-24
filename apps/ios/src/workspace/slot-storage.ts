/**
 * The workspace's StoragePort on the device's files (UI/UX v1 T05; docs/02 D04: a failed write keeps the last good
 * version).
 *
 * Each name is kept in two slot files, `<name>.a.json` and `<name>.b.json`, each holding `{generation, value}`. A write
 * goes to the slot NOT holding the newest good version, with the next generation; a read returns the good slot with
 * the highest generation. A write that fails or is torn half-way can only damage the slot being written, so the
 * previous version is still there to read. This needs no rename, whose replace-if-exists behaviour differs between
 * platforms and is not something this app can verify on a device from here.
 *
 * Writes through one instance are queued, so two saves never interleave on the same slot.
 */
import type { StoragePort } from "@awardgrid/core/workspace/types";
import type { FileStore } from "../store/persistence";

type Slot = "a" | "b";

interface SlotContent {
  generation: number;
  value: unknown;
}

const slotPath = (name: string, slot: Slot) => `${name}.${slot}.json`;

function readSlot(raw: string | null): SlotContent | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || !("value" in parsed)) return null;
    const generation = (parsed as { generation?: unknown }).generation;
    if (!Number.isSafeInteger(generation) || (generation as number) < 1) return null;
    return { generation: generation as number, value: (parsed as { value: unknown }).value };
  } catch {
    return null;
  }
}

export class SlotFileStorage implements StoragePort {
  readonly #files: FileStore;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(files: FileStore) {
    this.#files = files;
  }

  async read(name: string): Promise<unknown> {
    const newest = await this.#newest(name);
    return newest ? newest.content.value : null;
  }

  writeAtomically(name: string, value: unknown): Promise<void> {
    const next = this.#queue.then(async () => {
      const newest = await this.#newest(name);
      const target: Slot = newest?.slot === "a" ? "b" : "a";
      const text = JSON.stringify({ generation: (newest?.content.generation ?? 0) + 1, value });
      await this.#files.write(slotPath(name, target), text);
    });
    this.#queue = next.catch(() => undefined);
    return next;
  }

  async remove(name: string): Promise<void> {
    await this.#files.remove(slotPath(name, "a"));
    await this.#files.remove(slotPath(name, "b"));
  }

  async #newest(name: string): Promise<{ slot: Slot; content: SlotContent } | null> {
    const [a, b] = await Promise.all([this.#files.read(slotPath(name, "a")).then(readSlot, () => null), this.#files.read(slotPath(name, "b")).then(readSlot, () => null)]);
    if (a && (!b || a.generation >= b.generation)) return { slot: "a", content: a };
    if (b) return { slot: "b", content: b };
    return null;
  }
}
