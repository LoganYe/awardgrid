import { describe, expect, it } from "vitest";
import {
  CLOSED_DRAWER_STATE,
  cellKeyOf,
  drawerMode,
  drawerReducer,
  isAskOpen,
  isModalMode,
  openCellKey,
  parseCellKey,
  selectedCellKey,
  type DrawerState,
} from "@/components/drawers/use-drawer-state";

const CELL = { origin: "HKG", dest: "SEA", date: "2026-10-15" };
const OTHER = { origin: "NRT", dest: "SEA", date: "2026-10-16" };

describe("drawerReducer", () => {
  it("starts with both drawers closed", () => {
    expect(CLOSED_DRAWER_STATE.open).toBeNull();
    expect(openCellKey(CLOSED_DRAWER_STATE)).toBeNull();
    expect(selectedCellKey(CLOSED_DRAWER_STATE)).toBeNull();
    expect(isAskOpen(CLOSED_DRAWER_STATE)).toBe(false);
  });

  it("opens the cell drawer", () => {
    const state = drawerReducer(CLOSED_DRAWER_STATE, { type: "open_cell", cellKey: cellKeyOf(CELL) });
    expect(state.open).toEqual({ kind: "cell", cellKey: "HKG-SEA-2026-10-15" });
    expect(openCellKey(state)).toBe("HKG-SEA-2026-10-15");
  });

  it("opening Ask closes the cell drawer (spec §3: mutually exclusive)", () => {
    const cell = drawerReducer(CLOSED_DRAWER_STATE, { type: "open_cell", cellKey: cellKeyOf(CELL) });
    const ask = drawerReducer(cell, { type: "open_ask" });
    expect(isAskOpen(ask)).toBe(true);
    expect(openCellKey(ask)).toBeNull();
    // …but the selection survives, or the Ask drawer could never show its "Selected: …" pill.
    expect(selectedCellKey(ask)).toBe("HKG-SEA-2026-10-15");
  });

  it("close clears the retained selection, so a later Ask starts with no cell pill", () => {
    let state = drawerReducer(CLOSED_DRAWER_STATE, { type: "open_cell", cellKey: cellKeyOf(CELL) });
    state = drawerReducer(state, { type: "open_ask" });
    state = drawerReducer(state, { type: "close" });
    expect(selectedCellKey(state)).toBeNull();
    expect(drawerReducer(state, { type: "open_ask" }).lastCell).toBeNull();
  });

  it("close_cell drops the retained selection even while Ask is open (a re-run invalidates it)", () => {
    let state = drawerReducer(CLOSED_DRAWER_STATE, { type: "open_cell", cellKey: cellKeyOf(CELL) });
    state = drawerReducer(state, { type: "open_ask" });
    const after = drawerReducer(state, { type: "close_cell" });
    expect(isAskOpen(after)).toBe(true);
    expect(selectedCellKey(after)).toBeNull();
  });

  it("opening a cell closes the Ask drawer", () => {
    const ask = drawerReducer(CLOSED_DRAWER_STATE, { type: "open_ask" });
    const cell = drawerReducer(ask, { type: "open_cell", cellKey: cellKeyOf(CELL) });
    expect(isAskOpen(cell)).toBe(false);
    expect(openCellKey(cell)).toBe("HKG-SEA-2026-10-15");
  });

  it("selecting another cell replaces the open one", () => {
    let state = drawerReducer(CLOSED_DRAWER_STATE, { type: "open_cell", cellKey: cellKeyOf(CELL) });
    state = drawerReducer(state, { type: "open_cell", cellKey: cellKeyOf(OTHER) });
    expect(openCellKey(state)).toBe("NRT-SEA-2026-10-16");
  });

  it("re-opening what is already open returns the same object (no re-render, no re-entry)", () => {
    const cell = drawerReducer(CLOSED_DRAWER_STATE, { type: "open_cell", cellKey: cellKeyOf(CELL) });
    expect(drawerReducer(cell, { type: "open_cell", cellKey: cellKeyOf(CELL) })).toBe(cell);
    const ask = drawerReducer(CLOSED_DRAWER_STATE, { type: "open_ask" });
    expect(drawerReducer(ask, { type: "open_ask" })).toBe(ask);
    expect(drawerReducer(CLOSED_DRAWER_STATE, { type: "close" })).toBe(CLOSED_DRAWER_STATE);
  });

  it("close shuts whichever drawer is open", () => {
    for (const state of [
      drawerReducer(CLOSED_DRAWER_STATE, { type: "open_cell", cellKey: cellKeyOf(CELL) }),
      drawerReducer(CLOSED_DRAWER_STATE, { type: "open_ask" }),
    ]) {
      expect(drawerReducer(state, { type: "close" }).open).toBeNull();
    }
  });

  it("close_cell leaves an open Ask drawer alone", () => {
    const ask = drawerReducer(CLOSED_DRAWER_STATE, { type: "open_ask" });
    expect(drawerReducer(ask, { type: "close_cell" })).toBe(ask);
    expect(isAskOpen(drawerReducer(ask, { type: "close_cell" }))).toBe(true);
    const cell = drawerReducer(CLOSED_DRAWER_STATE, { type: "open_cell", cellKey: cellKeyOf(CELL) });
    expect(drawerReducer(cell, { type: "close_cell" }).open).toBeNull();
  });

  it("never has two drawers open at once, whatever the sequence", () => {
    const actions = [
      { type: "open_cell", cellKey: cellKeyOf(CELL) },
      { type: "open_ask" },
      { type: "open_cell", cellKey: cellKeyOf(OTHER) },
      { type: "close_cell" },
      { type: "open_ask" },
      { type: "close" },
    ] as const;
    let state: DrawerState = CLOSED_DRAWER_STATE;
    for (const action of actions) {
      state = drawerReducer(state, action);
      expect(openCellKey(state) !== null && isAskOpen(state)).toBe(false);
    }
  });
});

describe("cell keys", () => {
  it("round-trips an address", () => {
    expect(parseCellKey(cellKeyOf(CELL))).toEqual(CELL);
  });

  it("keeps the ISO date's own hyphens out of the split", () => {
    expect(parseCellKey("HKG-SEA-2026-10-15")).toEqual({ origin: "HKG", dest: "SEA", date: "2026-10-15" });
  });

  it("rejects anything that is not exactly a cell key", () => {
    for (const bad of [null, "", "HKG-SEA", "HKG-SEA-2026-10", "hkg-sea-2026-10-15", "HKGX-SEA-2026-10-15", "HKG-SEA-2026-10-15-J"]) {
      expect(parseCellKey(bad)).toBeNull();
    }
  });
});

describe("drawerMode (spec §6)", () => {
  it("pushes at ≥ 1280, overlays at 768–1279", () => {
    expect(drawerMode("desktop", "sheet")).toBe("push");
    expect(drawerMode("desktop", "bottom-sheet")).toBe("push");
    expect(drawerMode("tablet", "sheet")).toBe("overlay");
    expect(drawerMode("tablet", "bottom-sheet")).toBe("overlay");
  });

  it("below 768 the cell drawer is a sheet and Ask is a bottom sheet", () => {
    expect(drawerMode("mobile", "sheet")).toBe("sheet");
    expect(drawerMode("mobile", "bottom-sheet")).toBe("bottom-sheet");
  });

  it("only the pushing drawer is non-modal", () => {
    expect(isModalMode("push")).toBe(false);
    expect(isModalMode("overlay")).toBe(true);
    expect(isModalMode("sheet")).toBe(true);
    expect(isModalMode("bottom-sheet")).toBe(true);
  });
});
