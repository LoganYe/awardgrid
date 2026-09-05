import { describe, expect, it } from "vitest";
import { makeRow } from "../../../test/fixtures/grid/rows";
import {
  bestRow,
  cheapestRow,
  compareRows,
  isImplementedSortBy,
  programDisplayName,
} from "@/lib/grid/ranking";

describe("compareRows", () => {
  const cheap = makeRow({ miles: 60_000, fees_cents: 9_000, seats_left: 1, program: "united" });
  const mid = makeRow({ miles: 80_000, fees_cents: 5_600, seats_left: 2, program: "alaska" });
  const midNullFees = makeRow({
    miles: 80_000,
    fees_cents: null,
    seats_left: 9,
    program: "aeroplan",
  });
  const midSameFeesFewerSeats = makeRow({
    miles: 80_000,
    fees_cents: 5_600,
    seats_left: 1,
    program: "american",
  });
  const pricey = makeRow({ miles: 120_000, fees_cents: 100, seats_left: 4, program: "delta" });

  it("miles_asc: miles, then fees (null last), then seats desc, then program name", () => {
    const sorted = [pricey, midNullFees, midSameFeesFewerSeats, mid, cheap].sort(
      compareRows("miles_asc"),
    );
    expect(sorted.map((r) => r.program)).toEqual([
      "united",
      "alaska",
      "american",
      "aeroplan",
      "delta",
    ]);
  });

  it("miles_asc: equal miles/fees/seats fall back to program display name", () => {
    const a = makeRow({ program: "united" }); // "United MileagePlus"
    const b = makeRow({ program: "american" }); // "American Airlines AAdvantage"
    expect([a, b].sort(compareRows("miles_asc")).map((r) => r.program)).toEqual([
      "american",
      "united",
    ]);
  });

  it("fees_asc: null fees last, then miles", () => {
    const sorted = [midNullFees, mid, cheap, pricey].sort(compareRows("fees_asc"));
    expect(sorted.map((r) => r.program)).toEqual(["delta", "alaska", "united", "aeroplan"]);
    const nullA = makeRow({ fees_cents: null, miles: 90_000 });
    const nullB = makeRow({ fees_cents: null, miles: 70_000 });
    expect([nullA, nullB].sort(compareRows("fees_asc"))[0]).toBe(nullB);
  });

  it("seats_desc: seats, then miles", () => {
    const sorted = [cheap, mid, midNullFees, pricey].sort(compareRows("seats_desc"));
    expect(sorted.map((r) => r.program)).toEqual(["aeroplan", "delta", "alaska", "united"]);
  });

  it("date_asc: date first, then miles", () => {
    const later = makeRow({ date: "2026-10-20", miles: 10_000 });
    const earlierExpensive = makeRow({ date: "2026-10-10", miles: 200_000 });
    const earlierCheap = makeRow({ date: "2026-10-10", miles: 50_000 });
    const sorted = [later, earlierExpensive, earlierCheap].sort(compareRows("date_asc"));
    expect(sorted).toEqual([earlierCheap, earlierExpensive, later]);
  });

  it("is a total order: identical rows differing only by source_id sort deterministically", () => {
    const a = makeRow({ source_id: "b" });
    const b = makeRow({ source_id: "a" });
    expect([a, b].sort(compareRows("miles_asc")).map((r) => r.source_id)).toEqual(["a", "b"]);
    expect([b, a].sort(compareRows("miles_asc")).map((r) => r.source_id)).toEqual(["a", "b"]);
  });
});

describe("bestRow / cheapestRow", () => {
  it("returns null for an empty set and does not mutate input", () => {
    expect(bestRow([], "miles_asc")).toBeNull();
    const a = makeRow({ miles: 90_000 });
    const b = makeRow({ miles: 70_000 });
    const rows = [a, b];
    expect(bestRow(rows, "miles_asc")).toBe(b);
    expect(rows).toEqual([a, b]);
    expect(cheapestRow(rows)).toBe(b);
  });

  it("bestRow honours the sort order", () => {
    const manySeats = makeRow({ miles: 90_000, seats_left: 7 });
    const cheap = makeRow({ miles: 70_000, seats_left: 1 });
    expect(bestRow([manySeats, cheap], "seats_desc")).toBe(manySeats);
    expect(bestRow([manySeats, cheap], "miles_asc")).toBe(cheap);
  });
});

describe("helpers", () => {
  it("programDisplayName is text-only and falls back to the code", () => {
    expect(programDisplayName("alaska")).toBe("Alaska Mileage Plan");
    expect(programDisplayName("mystery")).toBe("mystery");
  });

  it("cpp_desc is typed but not implemented", () => {
    expect(isImplementedSortBy("cpp_desc")).toBe(false);
    expect(isImplementedSortBy("miles_asc")).toBe(true);
  });
});
