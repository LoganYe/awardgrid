/**
 * Saved trip plans (release plan step 18): the plans-v1 namespace, written whole through the two-slot storage; 100
 * plans at most, refused as "capacity" with nothing dropped; the same plan saved twice is one; a failed write keeps the
 * previous list; a deletion can be undone; loading never writes, keeps what it cannot read, and leaves a newer
 * version's file alone. Sample mode's plans are its own (../sample/boot.ts), checked in plans-sample.test.ts.
 */
import { describe, expect, it, vi } from "vitest";
import { parseQuery } from "@awardgrid/core/query/parse";
import type { StoragePort } from "@awardgrid/core/workspace/types";
import { SlotFileStorage } from "../workspace/slot-storage";
import { MemoryFileStore } from "./persistence";
import { PLANS_LIMITS, PLANS_NAMESPACE, type PlanDraft, PlansStore, planFromDraft, planIdentity } from "./plans-store";

const TODAY = "2026-10-18";
const NOW = "2026-10-18T08:30:00.000Z";

class MemoryStorage implements StoragePort {
  readonly values = new Map<string, unknown>();
  writes = 0;
  failWrites = false;
  async read(name: string) {
    return this.values.has(name) ? structuredClone(this.values.get(name)) : null;
  }
  async writeAtomically(name: string, value: unknown) {
    if (this.failWrites) throw new Error("disk full");
    this.writes += 1;
    this.values.set(name, structuredClone(value));
  }
  async remove(name: string) {
    this.values.delete(name);
  }
}

async function draft(text: string, today = TODAY): Promise<PlanDraft> {
  const parsed = await parseQuery(text, { today });
  return { text, query: parsed.query, notices: parsed.notices };
}

const plan = async (text: string, id: string, today = TODAY) => planFromDraft(await draft(text, today), NOW, id);

describe("PlansStore", () => {
  it("saves what was typed, what it was read as and what the parser said, newest first, and reads it back cold", async () => {
    const storage = new MemoryStorage();
    const store = new PlansStore(storage);
    await store.load();
    const a = await store.save(await plan("HKG to SEA next 30 days business", "plan-a"));
    const b = await store.save(await plan("东京到纽约 下个月 头等舱", "plan-b"));
    expect(a.ok && b.ok).toBe(true);
    expect(store.all().map((p) => p.id)).toEqual(["plan-b", "plan-a"]);
    const saved = store.get("plan-a")!;
    expect(saved).toMatchObject({ schemaVersion: 1, id: "plan-a", savedAt: NOW, text: "HKG to SEA next 30 days business", notices: [] });
    expect(saved.query).toMatchObject({ origins: ["HKG"], destinations: ["SEA"], date_from: "2026-10-18", date_to: "2026-11-16", cabins: ["J"] });
    expect(store.get("plan-b")!.query).toMatchObject({ origins: ["NRT", "HND"], destinations: ["JFK", "EWR", "LGA"], cabins: ["F"] });

    const cold = new PlansStore(storage);
    expect(await cold.load()).toEqual({ loaded: 2, dropped: 0, readOnly: false });
    expect(cold.all().map((p) => p.id)).toEqual(["plan-b", "plan-a"]);
    expect(cold.get("plan-a")).toEqual(saved);
    // A plan holds no results and nothing that looks like a key.
    expect(JSON.stringify(storage.values.get(PLANS_NAMESPACE))).not.toMatch(/partner-authorization|x-api-key|sk-ant-|apiKey|"rows"/i);
  });

  it("keeps the parser's notices with the plan", async () => {
    const store = new PlansStore(new MemoryStorage());
    await store.load();
    const result = await store.save(await plan("LAX to Tokyo 2026-09-01 to 2026-09-10", "plan-past"));
    expect(result.ok && result.item.notices).toEqual([{ code: "parse.start_in_past", vars: { date_from: "2026-09-01", today: TODAY } }]);
  });

  it("lives in its own namespace, in the two-slot files a torn write cannot break", async () => {
    const files = new MemoryFileStore();
    const store = new PlansStore(new SlotFileStorage(files));
    await store.load();
    await store.save(await plan("HKG to SEA next 30 days business", "plan-a"));
    expect([...files.files.keys()]).toEqual([expect.stringMatching(/^plans-v1\./)]);
    const cold = new PlansStore(new SlotFileStorage(files));
    await cold.load();
    expect(cold.all().map((p) => p.id)).toEqual(["plan-a"]);
  });

  it("the same plan saved twice is one, and says so; the same words read on another day are another plan", async () => {
    const store = new PlansStore(new MemoryStorage());
    await store.load();
    await store.save(await plan("HKG to SEA next 30 days business", "plan-1"));
    const again = await store.save(await plan("  HKG to SEA   next 30 days business ", "plan-2"));
    expect(again).toMatchObject({ ok: true, already: true, item: { id: "plan-1" } });
    expect(store.all()).toHaveLength(1);
    const later = await store.save(await plan("HKG to SEA next 30 days business", "plan-3", "2026-11-02"));
    expect(later).toMatchObject({ ok: true, item: { id: "plan-3" } });
    expect(later.ok && "already" in later).toBe(false);
    expect(store.all().map((p) => p.id)).toEqual(["plan-3", "plan-1"]);
  });

  it("holds 100 plans: the 101st is refused as capacity, and nothing already saved is dropped or rewritten", async () => {
    expect(PLANS_LIMITS.maxItems).toBe(100);
    const storage = new MemoryStorage();
    const store = new PlansStore(storage);
    await store.load();
    const base = await draft("HKG to SEA next 30 days business");
    for (let i = 0; i < 100; i += 1) {
      const result = await store.save(planFromDraft({ ...base, text: `HKG to SEA next 30 days business #${i}` }, NOW, `plan-${i}`));
      expect(result.ok, `plan ${i}`).toBe(true);
    }
    const writes = storage.writes;
    const full = await store.save(planFromDraft({ ...base, text: "one more" }, NOW, "plan-100"));
    expect(full).toEqual({ ok: false, reason: "capacity" });
    expect(storage.writes).toBe(writes);
    expect(store.all()).toHaveLength(100);
    expect(store.usage()).toEqual({ count: 100, maxItems: 100 });
  });

  it("refuses a plan that would pass the byte cap, as capacity", async () => {
    const store = new PlansStore(new MemoryStorage(), { maxBytes: 2000 });
    await store.load();
    const base = await draft("HKG to SEA next 30 days business");
    expect((await store.save(planFromDraft(base, NOW, "plan-small"))).ok).toBe(true);
    expect(await store.save(planFromDraft({ ...base, text: `HKG to SEA ${"x".repeat(3000)}` }, NOW, "plan-big"))).toEqual({ ok: false, reason: "capacity" });
    expect(store.all().map((p) => p.id)).toEqual(["plan-small"]);
  });

  it("a write that fails changes nothing on screen and says why", async () => {
    const storage = new MemoryStorage();
    const store = new PlansStore(storage);
    await store.load();
    await store.save(await plan("HKG to SEA next 30 days business", "plan-a"));
    storage.failWrites = true;
    const listener = vi.fn();
    store.subscribe(listener);
    expect(await store.save(await plan("SFO to NRT next 60 days business", "plan-b"))).toEqual({ ok: false, reason: "write_failed", message: "disk full" });
    expect(store.all().map((p) => p.id)).toEqual(["plan-a"]);
    expect(listener).not.toHaveBeenCalled();
  });

  it("deleting takes effect at once and can be undone, back in its place; once", async () => {
    const store = new PlansStore(new MemoryStorage());
    await store.load();
    for (const [text, id] of [["HKG to SEA next 30 days business", "a"], ["SFO to NRT next 60 days business", "b"], ["LHR to JFK, next 2 weeks, first", "c"]] as const) {
      await store.save(await plan(text, id));
    }
    const removed = await store.remove("b");
    expect(removed.ok).toBe(true);
    expect(store.all().map((p) => p.id)).toEqual(["c", "a"]);
    const token = removed.ok ? removed.undo : "";
    expect(await store.undo(token)).toEqual({ ok: true });
    expect(store.all().map((p) => p.id)).toEqual(["c", "b", "a"]);
    expect(await store.undo(token)).toEqual({ ok: false, reason: "gone" });
    expect(await store.remove("nope")).toEqual({ ok: false, reason: "unknown" });
  });

  it("an undo is gone once the same plan is saved again, or once forgotten", async () => {
    const store = new PlansStore(new MemoryStorage());
    await store.load();
    await store.save(await plan("HKG to SEA next 30 days business", "a"));
    const first = await store.remove("a");
    await store.save(await plan("HKG to SEA next 30 days business", "a2"));
    expect(await store.undo(first.ok ? first.undo : "")).toEqual({ ok: false, reason: "gone" });
    const second = await store.remove("a2");
    store.forget(second.ok ? second.undo : "");
    expect(await store.undo(second.ok ? second.undo : "")).toEqual({ ok: false, reason: "gone" });
    expect(store.all()).toEqual([]);
  });

  it("loading never writes; a plan it cannot read is kept as it was, counted, and written back unchanged", async () => {
    const storage = new MemoryStorage();
    const good = await plan("HKG to SEA next 30 days business", "good");
    const damaged = { schemaVersion: 1, id: "bad", savedAt: NOW, text: "x", query: { origins: [] }, notices: [] };
    const badNotice = { ...good, id: "bad-notice", notices: [{ code: "not.a.code" }] };
    storage.values.set(PLANS_NAMESPACE, { schemaVersion: 1, items: [good, damaged, badNotice, { ...good }] });
    const store = new PlansStore(storage);
    expect(await store.load()).toEqual({ loaded: 1, dropped: 3, readOnly: false });
    expect(storage.writes).toBe(0);
    expect(store.all().map((p) => p.id)).toEqual(["good"]);
    expect(store.unreadableCount()).toBe(3);
    expect(store.usage().count).toBe(4);
    await store.save(await plan("SFO to NRT next 60 days business", "new"));
    const written = storage.values.get(PLANS_NAMESPACE) as { items: unknown[] };
    expect(written.items).toHaveLength(5);
    expect(written.items).toContainEqual(damaged);
    expect(written.items).toContainEqual(badNotice);
  });

  it("a newer version's file, or one the storage cannot read, is left alone: shown as nothing, never written over", async () => {
    const newer = new MemoryStorage();
    newer.values.set(PLANS_NAMESPACE, { schemaVersion: 2, items: [] });
    const store = new PlansStore(newer);
    expect(await store.load()).toEqual({ loaded: 0, dropped: 0, readOnly: true });
    expect(store.isReadOnly()).toBe(true);
    expect(await store.save(await plan("HKG to SEA next 30 days business", "a"))).toEqual({ ok: false, reason: "read_only" });
    expect(newer.writes).toBe(0);

    const unreadable: StoragePort = { read: async () => Promise.reject(new Error("unreadable")), writeAtomically: vi.fn(), remove: vi.fn() };
    const held = new PlansStore(unreadable);
    expect(await held.load()).toEqual({ loaded: 0, dropped: 0, readOnly: true });
    expect(await held.remove("a")).toEqual({ ok: false, reason: "read_only" });
    expect(unreadable.writeAtomically).not.toHaveBeenCalled();
  });

  it("a plan is a copy of the draft it came from, with its text trimmed; its identity ignores spacing but not dates", async () => {
    const d = await draft("  HKG to SEA next 30 days business  ");
    const p = planFromDraft(d, NOW, "p");
    expect(p.text).toBe("HKG to SEA next 30 days business");
    d.query.origins.push("TPE");
    expect(p.query.origins).toEqual(["HKG"]);
    const other = await draft("HKG to SEA next 30 days business", "2026-10-19");
    expect(planIdentity(p)).toBe(planIdentity({ text: "HKG to SEA  next 30 days business", query: p.query }));
    expect(planIdentity(p)).not.toBe(planIdentity({ text: p.text, query: other.query }));
  });
});
