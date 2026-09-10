import { describe, expect, it } from "vitest";
import type { AvailabilityRow } from "@awardgrid/core/grid/types";
import { cellKey, cellsHash, diffSnapshots, parseCellKey, parseSnapshot, serializeSnapshot, snapshot } from "./diff";
import type { CellSnapshot } from "./types";

function row(over: Partial<AvailabilityRow> = {}): AvailabilityRow {
  return {
    program: "american",
    origin: "HKG",
    dest: "SEA",
    date: "2026-10-02",
    cabin: "F",
    miles: 62000,
    fees_cents: 1234,
    currency: "USD",
    seats_left: 1,
    direct: false,
    airlines: ["AA"],
    computed_last_seen: "2026-10-01T11:00:00Z",
    source_id: "id-1",
    booking_url: null,
    fetched_at: "2026-10-01T12:00:00Z",
    ...over,
  };
}

function cell(key: string, miles: number, over: Partial<CellSnapshot> = {}): CellSnapshot {
  return { key, miles, fees_cents: null, seats_left: 0, computed_last_seen: "2026-10-01T00:00:00Z", ...over };
}

describe("cellKey / snapshot", () => {
  it("keys on program|origin|dest|date|cabin and round-trips", () => {
    expect(cellKey(row())).toBe("american|HKG|SEA|2026-10-02|F");
    expect(parseCellKey("american|HKG|SEA|2026-10-02|F")).toEqual({ program: "american", origin: "HKG", dest: "SEA", date: "2026-10-02", cabin: "F" });
    expect(parseCellKey("garbage")).toBeNull();
  });

  it("snapshots are sorted by key and duplicates keep the cheapest row", () => {
    const s = snapshot([row({ program: "united", miles: 80000 }), row({ miles: 70000 }), row({ miles: 62000 })]);
    expect(s.map((c) => c.key)).toEqual(["american|HKG|SEA|2026-10-02|F", "united|HKG|SEA|2026-10-02|F"]);
    expect(s[0]).toEqual({ key: "american|HKG|SEA|2026-10-02|F", miles: 62000, fees_cents: 1234, seats_left: 1, computed_last_seen: "2026-10-01T11:00:00Z" });
  });

  it("serialize/parse round-trips and tolerates garbage", () => {
    const s = snapshot([row()]);
    expect(parseSnapshot(serializeSnapshot(s))).toEqual(s);
    expect(parseSnapshot("not json")).toEqual([]);
    expect(parseSnapshot('[{"key":1}]')).toEqual([]);
    expect(parseSnapshot(null)).toEqual([]);
  });
});

describe("cellsHash", () => {
  it("is stable across input order and changes with miles", () => {
    const a = cell("a|X|Y|2026-10-01|J", 50000);
    const b = cell("b|X|Y|2026-10-01|J", 60000);
    expect(cellsHash([a, b])).toBe(cellsHash([b, a]));
    expect(cellsHash([a, b])).toMatch(/^[0-9a-f]{64}$/);
    expect(cellsHash([a, { ...b, miles: 59000 }])).not.toBe(cellsHash([a, b]));
    // fees / seats are not part of the identity.
    expect(cellsHash([{ ...a, seats_left: 4, fees_cents: 99 }, b])).toBe(cellsHash([a, b]));
    expect(cellsHash([])).toBe(cellsHash([]));
  });
});

describe("diffSnapshots", () => {
  const K1 = "american|HKG|SEA|2026-10-02|F";
  const K2 = "united|PVG|SEA|2026-10-05|J";
  const K3 = "alaska|NRT|SEA|2026-10-09|J";

  it("reports new and dropped cells", () => {
    const d = diffSnapshots([cell(K1, 62000), cell(K2, 80000)], [cell(K1, 62000), cell(K3, 70000)], { dropThresholdPct: 10 });
    expect(d.new.map((c) => c.key)).toEqual([K3]);
    expect(d.dropped.map((c) => c.key)).toEqual([K2]);
    expect(d.price_drops).toEqual([]);
    expect(d.unchanged).toBe(1);
  });

  it("flags a drop at or above the threshold and ignores one below it", () => {
    const at = diffSnapshots([cell(K1, 100000)], [cell(K1, 90000)], { dropThresholdPct: 10 });
    expect(at.price_drops).toHaveLength(1);
    expect(at.price_drops[0]).toMatchObject({ key: K1, pct: 10, before: { miles: 100000 }, after: { miles: 90000 } });
    expect(at.unchanged).toBe(0);

    const below = diffSnapshots([cell(K1, 100000)], [cell(K1, 91000)], { dropThresholdPct: 10 });
    expect(below.price_drops).toEqual([]);
    expect(below.unchanged).toBe(1);

    const above = diffSnapshots([cell(K1, 100000)], [cell(K1, 75000)], { dropThresholdPct: 10 });
    expect(above.price_drops[0]?.pct).toBe(25);
  });

  it("a price increase or a fees/seats change is unchanged", () => {
    const d = diffSnapshots([cell(K1, 60000)], [cell(K1, 70000, { seats_left: 5, fees_cents: 1 })], { dropThresholdPct: 10 });
    expect(d).toEqual({ new: [], dropped: [], price_drops: [], unchanged: 1 });
  });

  it("empty baseline → everything is new; empty next → everything dropped", () => {
    expect(diffSnapshots([], [cell(K1, 1), cell(K2, 2)], { dropThresholdPct: 10 }).new).toHaveLength(2);
    expect(diffSnapshots([cell(K1, 1)], [], { dropThresholdPct: 10 }).dropped).toHaveLength(1);
  });

  it("threshold 0 flags any decrease; a NaN threshold behaves like 0", () => {
    expect(diffSnapshots([cell(K1, 100)], [cell(K1, 99)], { dropThresholdPct: 0 }).price_drops).toHaveLength(1);
    expect(diffSnapshots([cell(K1, 100)], [cell(K1, 99)], { dropThresholdPct: Number.NaN }).price_drops).toHaveLength(1);
  });
});
