import { describe, expect, it } from "vitest";
import { PAGE_ROWS, clampPosition, isNavigationKey, moveFocus, rovingTabIndex } from "@/lib/grid/keyboard";

const dims = { rows: 30, cols: 4 };

describe("moveFocus", () => {
  it("arrows move one cell and clamp at the edges (no wrap)", () => {
    expect(moveFocus({ row: 5, col: 2 }, "ArrowUp", dims)).toEqual({ row: 4, col: 2 });
    expect(moveFocus({ row: 5, col: 2 }, "ArrowDown", dims)).toEqual({ row: 6, col: 2 });
    expect(moveFocus({ row: 5, col: 2 }, "ArrowLeft", dims)).toEqual({ row: 5, col: 1 });
    expect(moveFocus({ row: 5, col: 2 }, "ArrowRight", dims)).toEqual({ row: 5, col: 3 });
    expect(moveFocus({ row: 0, col: 0 }, "ArrowUp", dims)).toEqual({ row: 0, col: 0 });
    expect(moveFocus({ row: 0, col: 0 }, "ArrowLeft", dims)).toEqual({ row: 0, col: 0 });
    expect(moveFocus({ row: 29, col: 3 }, "ArrowDown", dims)).toEqual({ row: 29, col: 3 });
    expect(moveFocus({ row: 29, col: 3 }, "ArrowRight", dims)).toEqual({ row: 29, col: 3 });
  });

  it("Home/End go to the row ends; with Ctrl or Cmd to the grid corners", () => {
    expect(moveFocus({ row: 5, col: 2 }, "Home", dims)).toEqual({ row: 5, col: 0 });
    expect(moveFocus({ row: 5, col: 2 }, "End", dims)).toEqual({ row: 5, col: 3 });
    expect(moveFocus({ row: 5, col: 2 }, "Home", dims, { ctrlKey: true })).toEqual({ row: 0, col: 0 });
    expect(moveFocus({ row: 5, col: 2 }, "End", dims, { ctrlKey: true })).toEqual({ row: 29, col: 3 });
    expect(moveFocus({ row: 5, col: 2 }, "Home", dims, { metaKey: true })).toEqual({ row: 0, col: 0 });
    expect(moveFocus({ row: 5, col: 2 }, "End", dims, { metaKey: true })).toEqual({ row: 29, col: 3 });
  });

  it("PageUp/PageDown move 7 rows and clamp", () => {
    expect(PAGE_ROWS).toBe(7);
    expect(moveFocus({ row: 10, col: 1 }, "PageDown", dims)).toEqual({ row: 17, col: 1 });
    expect(moveFocus({ row: 10, col: 1 }, "PageUp", dims)).toEqual({ row: 3, col: 1 });
    expect(moveFocus({ row: 3, col: 1 }, "PageUp", dims)).toEqual({ row: 0, col: 1 });
    expect(moveFocus({ row: 25, col: 1 }, "PageDown", dims)).toEqual({ row: 29, col: 1 });
  });

  it("returns null for keys it does not own", () => {
    expect(moveFocus({ row: 1, col: 1 }, "Enter", dims)).toBeNull();
    expect(moveFocus({ row: 1, col: 1 }, " ", dims)).toBeNull();
    expect(moveFocus({ row: 1, col: 1 }, "Escape", dims)).toBeNull();
    expect(moveFocus({ row: 1, col: 1 }, "Tab", dims)).toBeNull();
    expect(isNavigationKey("ArrowUp")).toBe(true);
    expect(isNavigationKey("a")).toBe(false);
  });

  it("clamps an out-of-range start (grid shrank) and survives an empty grid", () => {
    expect(moveFocus({ row: 99, col: 99 }, "ArrowDown", dims)).toEqual({ row: 29, col: 3 });
    expect(moveFocus({ row: -3, col: -1 }, "ArrowUp", dims)).toEqual({ row: 0, col: 0 });
    expect(moveFocus({ row: 4, col: 4 }, "End", { rows: 0, cols: 0 })).toEqual({ row: 0, col: 0 });
    expect(clampPosition({ row: 50, col: 1 }, dims)).toEqual({ row: 29, col: 1 });
  });
});

describe("rovingTabIndex", () => {
  it("only the focused cell is a tab stop", () => {
    const focused = { row: 2, col: 1 };
    expect(rovingTabIndex({ row: 2, col: 1 }, focused)).toBe(0);
    expect(rovingTabIndex({ row: 2, col: 0 }, focused)).toBe(-1);
    expect(rovingTabIndex({ row: 0, col: 1 }, focused)).toBe(-1);
  });
});
