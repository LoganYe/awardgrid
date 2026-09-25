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
 *
 * Absent and unreadable are not the same (T13). A slot whose file cannot be read at all (the read rejects) could hold
 * the newest version, so while one cannot be read nothing is written, and `read` throws if no other slot can be read:
 * the caller must not take it as empty. A slot that reads but does not parse is a torn write, the case this format
 * exists for: the other slot is the good version. Both torn, with nothing good, is unreadable too.
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

/** A saved name whose slot files exist but cannot be read: not the same as never saved. */
export class SlotUnreadableError extends Error {
  constructor(name: string) {
    super(`The saved "${name}" could not be read on this device; it is left as it is.`);
    this.name = "SlotUnreadableError";
  }
}

export class SlotFileStorage implements StoragePort {
  readonly #files: FileStore;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(files: FileStore) {
    this.#files = files;
  }

  async read(name: string): Promise<unknown> {
    const { newest, unreadable, torn } = await this.#scan(name);
    // A slot that could not be read at all may hold the newest version: not guessed around.
    if (unreadable) throw new SlotUnreadableError(name);
    if (newest) return newest.content.value;
    if (torn === 2) throw new SlotUnreadableError(name);
    return null;
  }

  writeAtomically(name: string, value: unknown): Promise<void> {
    const next = this.#queue.then(async () => {
      const { newest, unreadable, torn } = await this.#scan(name);
      // Never write over what could not be read: it may be the newest good version.
      if (unreadable || (torn === 2 && !newest)) throw new SlotUnreadableError(name);
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

  /** Both slots: the newest good one, whether either could not be read at all, and how many are torn. */
  async #scan(name: string): Promise<{ newest: { slot: Slot; content: SlotContent } | null; unreadable: boolean; torn: number }> {
    const read = async (slot: Slot) => {
      try {
        const raw = await this.#files.read(slotPath(name, slot));
        if (raw === null) return { content: null, unreadable: false, torn: false };
        const content = readSlot(raw);
        return { content, unreadable: false, torn: content === null };
      } catch {
        return { content: null, unreadable: true, torn: false };
      }
    };
    const [a, b] = await Promise.all([read("a"), read("b")]);
    const unreadable = a.unreadable || b.unreadable;
    const torn = Number(a.torn) + Number(b.torn);
    if (a.content && (!b.content || a.content.generation >= b.content.generation)) return { newest: { slot: "a", content: a.content }, unreadable, torn };
    if (b.content) return { newest: { slot: "b", content: b.content }, unreadable, torn };
    return { newest: null, unreadable, torn };
  }
}
