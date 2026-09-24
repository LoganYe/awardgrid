/**
 * The selection set (UI/UX v1 T12; acceptance A22): at most four references, a fifth refused (never swapped in),
 * the same reference twice clears it, and a reference always names its own snapshot, so a newer search with the same
 * row never stands in for it.
 */
import { describe, expect, it } from "vitest";
import { fixtureSnapshot } from "../../../test/fixtures/uiux/factory";
import { COMPARE_FIELDS, MAX_COMPARE, compareLayout, compareNotes, refKey, resolveSelection, sameRef, toggleSelection } from "./selection";

const ref = (rowKey: string, snapshotId = "s1") => ({ snapshotId, rowKey });

describe("toggleSelection", () => {
  it("never silently replaces a fifth option", () => {
    const current = ["a", "b", "c", "d"].map((rowKey) => ({ snapshotId: "s1", rowKey }));
    const result = toggleSelection(current, { snapshotId: "s1", rowKey: "e" });
    expect(result.reason).toBe("limit");
    expect(result.selected).toEqual(current);
    expect(toggleSelection(current, current[0]!).selected).toHaveLength(3);
  });

  it("adds at the end, clears on the second press, and leaves the array it was given alone", () => {
    const current = [ref("a")];
    const added = toggleSelection(current, ref("b"));
    expect(added).toEqual({ selected: [ref("a"), ref("b")] });
    expect(current).toEqual([ref("a")]);
    expect(toggleSelection(added.selected, ref("a"))).toEqual({ selected: [ref("b")] });
  });

  it("the same row key in another snapshot is another reference: both can be selected, and neither replaces the other", () => {
    const older = ref("row-1", "snap-1");
    const newer = ref("row-1", "snap-2");
    expect(sameRef(older, newer)).toBe(false);
    const both = toggleSelection(toggleSelection([], older).selected, newer).selected;
    expect(both).toEqual([older, newer]);
    expect(toggleSelection(both, newer).selected).toEqual([older]);
  });

  it("the limit is four by default and can be set lower, never below one", () => {
    expect(MAX_COMPARE).toBe(4);
    const two = [ref("a"), ref("b")];
    expect(toggleSelection(two, ref("c"), 2)).toEqual({ selected: two, reason: "limit" });
    expect(toggleSelection(two, ref("a"), 2)).toEqual({ selected: [ref("b")] });
    expect(toggleSelection([], ref("a"), 0)).toEqual({ selected: [ref("a")] });
  });
});

describe("resolveSelection", () => {
  const snapshot = fixtureSnapshot();
  const [first, second] = snapshot.rows;

  it("reads each option from its own snapshot, in the order chosen", () => {
    const refs = [ref(second!.key, snapshot.id), ref(first!.key, snapshot.id)];
    const entries = resolveSelection(refs, [snapshot]);
    expect(entries.map((e) => [e.source, e.row?.key])).toEqual([
      ["snapshot", second!.key],
      ["snapshot", first!.key],
    ]);
    expect(entries[0]!.query).toBe(snapshot.query);
    expect(entries[0]!.snapshotCreatedAt).toBe(snapshot.createdAt);
  });

  it("an evicted snapshot: the copy kept when chosen, labelled; nothing kept: said to be gone, never invented", () => {
    const kept = { ref: ref(first!.key, "gone-1"), row: first!, query: snapshot.query, snapshotCreatedAt: "2026-10-01T00:00:00.000Z" };
    const entries = resolveSelection([kept.ref, ref("nowhere", "gone-2")], [snapshot], new Map([[refKey(kept.ref), kept]]));
    expect(entries[0]).toMatchObject({ source: "kept_copy", row: first, snapshotCreatedAt: "2026-10-01T00:00:00.000Z" });
    expect(entries[1]).toEqual({ ref: ref("nowhere", "gone-2"), source: "missing", row: null, query: null, snapshotCreatedAt: null });
  });

  it("a newer snapshot with the same row key never stands in for the one chosen", () => {
    const newer = fixtureSnapshot({ id: "snap-newer", revision: 9 });
    const entries = resolveSelection([ref(first!.key, "snap-evicted")], [newer]);
    expect(entries[0]!.source).toBe("missing");
  });
});

describe("what a comparison shows", () => {
  it("the fields, in the order docs/04 S05 fixes; nothing that scores or totals", () => {
    expect(COMPARE_FIELDS).toEqual(["route_date", "cabin", "program", "miles", "fees", "itineraries", "seats", "source_time", "link"]);
  });

  it("notes, read as the columns read fees: known currencies (normalised), unknown fees, amounts without a currency, programs", () => {
    const base = fixtureSnapshot();
    const template = base.rows[0]!;
    const row = (key: string, value: Partial<typeof template.value>) => ({ ...template, key, value: { ...template.value, ...value } });
    const snapshot = fixtureSnapshot({
      rows: [
        row("usd", { program: "aeroplan", fees_cents: 5000, currency: "USD" }),
        row("usd-lower", { program: "aeroplan", fees_cents: 7000, currency: " usd " }),
        row("eur", { program: "american", fees_cents: 4200, currency: "EUR" }),
        row("no-currency", { program: "american", fees_cents: 8620, currency: null }),
        row("unknown", { program: "united", fees_cents: null, currency: null }),
        row("bad-code", { program: "united", fees_cents: 100, currency: "US$" }),
      ],
    });
    const entries = resolveSelection(
      snapshot.rows.map((r) => ref(r.key, snapshot.id)),
      [snapshot],
    );
    expect(compareNotes(entries)).toEqual({ currencies: ["EUR", "USD"], unknownFees: 1, currencyMissing: 2, programs: ["aeroplan", "american", "united"] });
  });

  it("notes for one program and one currency: nothing to warn about", () => {
    const snapshot = fixtureSnapshot();
    const known = snapshot.rows.filter((r) => r.value.fees_cents !== null && r.value.currency === "USD").slice(0, 2);
    expect(known).toHaveLength(2);
    const notes = compareNotes(resolveSelection(known.map((r) => ref(r.key, snapshot.id)), [snapshot]));
    expect(notes).toEqual({ currencies: ["USD"], unknownFees: 0, currencyMissing: 0, programs: [known[0]!.value.program] });
  });
});

describe("compareLayout", () => {
  it("390 (358 content): two at a time, a picker for a third or fourth", () => {
    expect(compareLayout(358, 1, 2)).toEqual({ columns: 2, picker: false, scroll: false });
    expect(compareLayout(358, 1, 4)).toEqual({ columns: 2, picker: true, scroll: false });
  });

  it("320 or 200% text: one column", () => {
    expect(compareLayout(288, 1, 3)).toEqual({ columns: 1, picker: false, scroll: false });
    expect(compareLayout(358, 2, 3)).toEqual({ columns: 1, picker: false, scroll: false });
  });

  it("wide: every option side by side, 220 each, scrolling sideways when they do not fit", () => {
    expect(compareLayout(936, 1, 4)).toEqual({ columns: 4, picker: false, scroll: false });
    expect(compareLayout(600, 1, 4)).toEqual({ columns: 4, picker: false, scroll: true });
  });

  it("one option or none", () => {
    expect(compareLayout(358, 1, 1).columns).toBe(1);
    expect(compareLayout(358, 1, 0).columns).toBe(0);
  });
});
