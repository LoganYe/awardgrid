/**
 * Row height per density and cabin-line count (docs/UI_PLAN.md §4). Pure arithmetic, so it is
 * tested here rather than through a rendered grid: it is the one number the per-cabin cell mode
 * changes, and the claim that a one-cabin query renders byte-identically to today rests on
 * `rowHeightFor(density, 1) === ROW_HEIGHT[density]` for every density.
 */
import { describe, expect, it } from "vitest";
import { ROW_HEIGHT, rowHeightFor, type Density } from "@/components/grid/use-roving-grid";

const DENSITIES: Density[] = ["desktop", "tablet", "mobile"];

describe("rowHeightFor", () => {
  it("one line is today's density height, unchanged", () => {
    expect(DENSITIES.map((d) => rowHeightFor(d, 1))).toEqual([48, 32, 40]);
    for (const d of DENSITIES) expect(rowHeightFor(d, 1)).toBe(ROW_HEIGHT[d]);
  });

  it("two cabins cost desktop and mobile nothing and grow tablet 32 to 40", () => {
    expect(DENSITIES.map((d) => rowHeightFor(d, 2))).toEqual([48, 40, 40]);
  });

  it("three and four cabins are the same at every density", () => {
    expect(DENSITIES.map((d) => rowHeightFor(d, 3))).toEqual([56, 56, 56]);
    expect(DENSITIES.map((d) => rowHeightFor(d, 4))).toEqual([72, 72, 72]);
  });
});
