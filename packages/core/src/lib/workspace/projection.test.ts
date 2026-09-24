/**
 * One projection of one snapshot for List, Calendar and Matrix (UI/UX v1 T08; docs/03 §2 projectResults; D07).
 *
 * Every number a view shows must be backed by rows the same projection lists: a calendar day's minimum by the rows
 * whose keys it carries, a matrix cell by its rows. The local filter narrows what is shown, never the coverage the
 * search proved. Sorting is by raw values within their own units: miles are miles, fees compare only within one
 * currency, and unknown fees or seats come after every known one.
 */
import { describe, expect, it } from "vitest";
import { fixturePrefs, fixtureQuery, fixtureSnapshot } from "../../../test/fixtures/uiux/factory";
import type { AvailabilityRow } from "../grid/types";
import { rowKey, scopeKey } from "./identity";
import { calendarCabinFor, feeGroup, projectResults } from "./projection";
import type { ResultSnapshot, WorkspaceRow } from "./types";

it("calendar minimum is backed by rows in the same filtered projection", () => {
  const p = projectResults(fixtureSnapshot(), fixturePrefs({ calendarCabin: "J", localFilter: { maxMiles: 80000 } }));
  for (const day of p.days) {
    const rows = p.rows.filter((r) => day.rowKeys.includes(r.key));
    expect(rows.every((r) => r.value.cabin === day.cabin && r.value.miles <= 80000)).toBe(true);
    expect(day.minMiles).toBe(rows.length ? Math.min(...rows.map((r) => r.value.miles)) : null);
  }
});

/** A snapshot of hand-made rows over the fixture query (HKG → SEA, Oct 1–30, J and F, Aeroplan). */
function snapshotOf(values: Array<Partial<AvailabilityRow>>, overrides: Partial<ResultSnapshot> = {}): ResultSnapshot {
  const base = fixtureSnapshot(overrides.query ? { query: overrides.query } : {});
  const scope = scopeKey(base.query);
  const template = base.rows[0]!.value;
  const rows: WorkspaceRow[] = values.map((partial, i) => {
    const value: AvailabilityRow = { ...template, source_id: `synthetic-${i}`, ...partial };
    return { key: rowKey(value, scope), value, time: base.rows[0]!.time };
  });
  return { ...base, rows, ...overrides };
}

describe("the filtered rows", () => {
  it("the local filter narrows the rows every view reads, and leaves the snapshot and its coverage alone", () => {
    const snapshot = snapshotOf([
      { date: "2026-10-05", cabin: "J", miles: 70000, seats_left: 2 },
      { date: "2026-10-06", cabin: "J", miles: 90000, seats_left: 3 },
      { date: "2026-10-07", cabin: "J", miles: 60000, seats_left: 0 },
    ]);
    const before = JSON.stringify(snapshot);
    const p = projectResults(snapshot, fixturePrefs({ localFilter: { maxMiles: 80000, onlyKnownSeats: true } }));
    expect(p.rows.map((r) => r.value.miles)).toEqual([70000]);
    expect(p.hiddenByFilter).toBe(2);
    expect(p.coverage).toEqual(snapshot.coverage);
    expect(JSON.stringify(snapshot)).toBe(before);
    // Every row the calendar or matrix points at is one the list shows.
    const listed = new Set(p.rows.map((r) => r.key));
    for (const key of [...p.days.flatMap((d) => d.rowKeys), ...p.cells.flatMap((c) => c.rowKeys)]) expect(listed.has(key)).toBe(true);
  });

  it("with no filter nothing is hidden, and two programs on one day stay two rows", () => {
    const snapshot = snapshotOf([
      { date: "2026-10-05", cabin: "J", program: "aeroplan", miles: 70000 },
      { date: "2026-10-05", cabin: "J", program: "united", miles: 70000 },
    ]);
    const p = projectResults(snapshot, fixturePrefs());
    expect(p.rows).toHaveLength(2);
    expect(p.hiddenByFilter).toBe(0);
    const day = p.days.find((d) => d.date === "2026-10-05")!;
    expect(day.rowKeys).toHaveLength(2);
    expect(day.minMiles).toBe(70000);
  });

  it("the projection is a pure function of the snapshot and preferences: projecting twice gives the same result", () => {
    const snapshot = fixtureSnapshot();
    expect(projectResults(snapshot, fixturePrefs())).toEqual(projectResults(snapshot, fixturePrefs()));
  });
});

describe("calendar days", () => {
  it("one day per date of the query's range, in order, for one cabin", () => {
    const p = projectResults(fixtureSnapshot(), fixturePrefs({ calendarCabin: "J" }));
    expect(p.days).toHaveLength(30);
    expect(p.days[0]!.date).toBe("2026-10-01");
    expect(p.days.at(-1)!.date).toBe("2026-10-30");
    expect(p.days.every((d) => d.cabin === "J")).toBe(true);
    expect(p.days.find((d) => d.date === "2026-10-18")!.minMiles).toBe(75000);
  });

  it("switching the calendar to First uses only First rows", () => {
    const p = projectResults(fixtureSnapshot(), fixturePrefs({ calendarCabin: "F" }));
    expect(p.days.every((d) => d.cabin === "F")).toBe(true);
    expect(p.days.find((d) => d.date === "2026-10-18")!.minMiles).toBe(110000);
    expect(p.days.find((d) => d.date === "2026-10-19")!.minMiles).toBeNull();
  });

  it("a cabin the query did not ask for falls back to the first asked, in cabin order (D07)", () => {
    expect(calendarCabinFor(fixtureQuery(), "Y")).toBe("J");
    expect(calendarCabinFor({ ...fixtureQuery(), cabins: ["Y", "W"] }, "J")).toBe("W");
    expect(calendarCabinFor({ ...fixtureQuery(), cabins: ["W", "F"] }, "J")).toBe("F");
    expect(calendarCabinFor({ ...fixtureQuery(), cabins: ["F", "W"] }, "W")).toBe("W");
    const p = projectResults(fixtureSnapshot(), fixturePrefs({ calendarCabin: "Y" }));
    expect(p.days.every((d) => d.cabin === "J")).toBe(true);
  });

  it("an empty day says whether it was checked: complete, partial or unknown, from the slices that cover it", () => {
    const complete = projectResults(fixtureSnapshot({ rows: [] }), fixturePrefs());
    expect(complete.days.every((d) => d.minMiles === null && d.coverage === "complete")).toBe(true);

    const base = fixtureSnapshot({ rows: [] });
    const partial = {
      ...base,
      coverage: { ...base.coverage, state: "partial" as const, slices: base.coverage.slices.map((s) => ({ ...s, state: "partial" as const, reason: "page_cap" as const })) },
    };
    expect(projectResults(partial, fixturePrefs()).days.every((d) => d.coverage === "partial")).toBe(true);

    const unknown = { ...base, coverage: { ...base.coverage, state: "unknown" as const, slices: [] } };
    expect(projectResults(unknown, fixturePrefs()).days.every((d) => d.coverage === "unknown")).toBe(true);

    // A slice that covers only part of the range, or another cabin, proves nothing for the rest.
    const narrow = {
      ...base,
      coverage: { ...base.coverage, slices: base.coverage.slices.map((s) => ({ ...s, dateTo: "2026-10-10", cabins: ["J" as const] })) },
    };
    const days = projectResults(narrow, fixturePrefs({ calendarCabin: "J" })).days;
    expect(days.find((d) => d.date === "2026-10-10")!.coverage).toBe("complete");
    expect(days.find((d) => d.date === "2026-10-11")!.coverage).toBe("unknown");
    expect(projectResults(narrow, fixturePrefs({ calendarCabin: "F" })).days[0]!.coverage).toBe("unknown");
  });

  it("an unmonitored route does not weaken a day; a monitored one decides it; with no monitored route the day is 'unmonitored'", () => {
    const query = { ...fixtureQuery(), origins: ["HKG", "PVG"] };
    const base = fixtureSnapshot({ query, rows: [] });
    const withStates = (hkg: "complete" | "partial" | "unmonitored") => {
      const slices = base.coverage.slices.map((s) =>
        s.origin === "PVG"
          ? { ...s, state: "unmonitored" as const, reason: "not_monitored" as const }
          : { ...s, state: hkg, reason: hkg === "complete" ? ("exhausted" as const) : hkg === "partial" ? ("page_cap" as const) : ("not_monitored" as const) },
      );
      const state = hkg === "partial" ? ("partial" as const) : ("complete" as const);
      return projectResults({ ...base, coverage: { ...base.coverage, state, slices } }, fixturePrefs()).days;
    };
    expect(withStates("complete").every((d) => d.coverage === "complete")).toBe(true);
    expect(withStates("partial").every((d) => d.coverage === "partial")).toBe(true);
    expect(withStates("unmonitored").every((d) => d.coverage === "unmonitored")).toBe(true);
  });

  it("a slice proves a day only for the programs it covers, and a day is never stronger than the snapshot's verdict", () => {
    const base = fixtureSnapshot({ rows: [] });
    // Slices for another program prove nothing about the Aeroplan search.
    const other = { ...base, coverage: { ...base.coverage, slices: base.coverage.slices.map((s) => ({ ...s, programs: ["united"] })) } };
    expect(projectResults(other, fixturePrefs()).days.every((d) => d.coverage === "unknown")).toBe(true);
    // A search over all programs is proven only by a slice for all programs.
    const all = fixtureSnapshot({ query: { ...fixtureQuery(), programs: undefined }, rows: [] });
    const narrowed = { ...all, coverage: { ...all.coverage, slices: all.coverage.slices.map((s) => ({ ...s, programs: ["aeroplan"] })) } };
    expect(projectResults(narrowed, fixturePrefs()).days.every((d) => d.coverage === "unknown")).toBe(true);
    expect(projectResults(all, fixturePrefs()).days.every((d) => d.coverage === "complete")).toBe(true);
    // Complete-looking slices under an unknown verdict stay unknown.
    const capped = { ...base, coverage: { ...base.coverage, state: "unknown" as const } };
    expect(projectResults(capped, fixturePrefs()).days.every((d) => d.coverage === "unknown")).toBe(true);
  });

  it("a day whose rows the filter hides says so: it is never an empty, checked day", () => {
    const p = projectResults(fixtureSnapshot(), fixturePrefs({ calendarCabin: "J", localFilter: { maxMiles: 80000 } }));
    const oct20 = p.days.find((d) => d.date === "2026-10-20")!;
    expect(oct20).toMatchObject({ minMiles: null, rowKeys: [], hidden: 1 });
    expect(p.days.find((d) => d.date === "2026-10-18")!.hidden).toBe(0);
    // First's 110,000 on Oct 18 is hidden too, but it belongs to First's calendar, not Business's.
    expect(p.days.reduce((n, d) => n + d.hidden, 0)).toBe(1);
    expect(p.hiddenByFilter).toBe(2);
  });
});

describe("matrix cells", () => {
  it("a cell whose rows the filter hides is kept, with no rows and its hidden count", () => {
    const p = projectResults(fixtureSnapshot(), fixturePrefs({ localFilter: { maxMiles: 80000 } }));
    const hiddenCells = p.cells.filter((c) => c.hidden > 0).map((c) => [c.date, c.cabin, c.rowKeys.length, c.hidden]);
    expect(hiddenCells).toEqual([
      ["2026-10-18", "F", 0, 1],
      ["2026-10-20", "J", 0, 1],
    ]);
  });

  it("one cell per route, day and cabin that has rows, holding exactly those rows", () => {
    const p = projectResults(fixtureSnapshot(), fixturePrefs());
    const keys = p.cells.flatMap((c) => c.rowKeys);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(keys)).toEqual(new Set(p.rows.map((r) => r.key)));
    for (const cell of p.cells) {
      for (const key of cell.rowKeys) {
        const row = p.rows.find((r) => r.key === key)!.value;
        expect([row.origin, row.dest, row.date, row.cabin]).toEqual([cell.origin, cell.dest, cell.date, cell.cabin]);
      }
    }
  });
});

describe("sorting", () => {
  const miles = (p: ReturnType<typeof projectResults>) => p.rows.map((r) => r.value.miles);

  it("miles, lowest first; equal miles by fee within a currency, unknown fees after known", () => {
    const snapshot = snapshotOf([
      { date: "2026-10-05", miles: 90000, fees_cents: 1000, currency: "USD" },
      { date: "2026-10-06", miles: 70000, fees_cents: null, currency: null },
      { date: "2026-10-07", miles: 70000, fees_cents: 5000, currency: "USD" },
      { date: "2026-10-08", miles: 70000, fees_cents: 2000, currency: "USD" },
    ]);
    const p = projectResults(snapshot, fixturePrefs({ sort: "miles_asc" }));
    expect(p.rows.map((r) => [r.value.miles, r.value.fees_cents])).toEqual([
      [70000, 2000],
      [70000, 5000],
      [70000, null],
      [90000, 1000],
    ]);
  });

  it("fees, lowest first, never across currencies: each currency is its own group, then no currency, then unknown", () => {
    const snapshot = snapshotOf([
      { date: "2026-10-05", miles: 1, fees_cents: 9000, currency: "USD" },
      { date: "2026-10-06", miles: 2, fees_cents: 100, currency: "CAD" },
      { date: "2026-10-07", miles: 3, fees_cents: null, currency: null },
      { date: "2026-10-08", miles: 4, fees_cents: 500, currency: "USD" },
      { date: "2026-10-09", miles: 5, fees_cents: 50, currency: null },
      { date: "2026-10-10", miles: 6, fees_cents: 20000, currency: "CAD" },
    ]);
    const p = projectResults(snapshot, fixturePrefs({ sort: "fees_asc" }));
    expect(p.rows.map((r) => feeGroup(r.value))).toEqual(["CAD", "CAD", "USD", "USD", "currency_unknown", "unknown"]);
    expect(miles(p)).toEqual([2, 6, 4, 1, 5, 3]);
  });

  it("most seats first, and a seat count not provided comes last, not first", () => {
    const snapshot = snapshotOf([
      { date: "2026-10-05", miles: 1, seats_left: 0 },
      { date: "2026-10-06", miles: 2, seats_left: 4 },
      { date: "2026-10-07", miles: 3, seats_left: 1 },
    ]);
    expect(miles(projectResults(snapshot, fixturePrefs({ sort: "seats_desc" })))).toEqual([2, 3, 1]);
  });

  it("earliest date first, then miles", () => {
    const snapshot = snapshotOf([
      { date: "2026-10-07", miles: 1 },
      { date: "2026-10-05", miles: 9 },
      { date: "2026-10-05", miles: 3 },
    ]);
    expect(miles(projectResults(snapshot, fixturePrefs({ sort: "date_asc" })))).toEqual([3, 9, 1]);
  });

  it("the order is total: rows equal in every shown value keep one order whatever order they arrive in", () => {
    const values = [
      { date: "2026-10-05", miles: 70000, source_id: "b" },
      { date: "2026-10-05", miles: 70000, source_id: "a" },
    ];
    const one = projectResults(snapshotOf(values), fixturePrefs()).rows.map((r) => r.value.source_id);
    const two = projectResults(snapshotOf([...values].reverse()), fixturePrefs()).rows.map((r) => r.value.source_id);
    expect(one).toEqual(two);
  });

  it("the calendar and matrix are not reordered by the sort: days by date, cells by date, route, cabin", () => {
    const a = projectResults(fixtureSnapshot(), fixturePrefs({ sort: "miles_asc" }));
    const b = projectResults(fixtureSnapshot(), fixturePrefs({ sort: "fees_asc" }));
    expect(a.days).toEqual(b.days);
    expect(a.cells).toEqual(b.cells);
    expect(a.cells.map((c) => `${c.date}${c.cabin}`)).toEqual(["2026-10-18J", "2026-10-18F", "2026-10-19J", "2026-10-20J"]);
  });
});
