/**
 * One drawer at a time (spec §3, §11 "Drawers … mutually exclusive"; docs/UI_PLAN.md §10).
 *
 * The grid page has two right-hand drawers — the cell drawer and the Ask drawer — and the spec
 * says opening one closes the other. Modelling that as two booleans makes the exclusion a rule
 * every call site has to remember; modelling it as ONE nullable slot makes it impossible to get
 * wrong: `open` holds either a cell, or Ask, or nothing.
 *
 * Nothing here persists: a reload starts with both drawers closed (spec §3.6 says even the Ask
 * history lives only in the browser session, so the open/closed state certainly does not).
 *
 * Pure module apart from the hook at the bottom — the reducer and the key helpers are unit
 * tested in use-drawer-state.test.ts without React.
 */
import { useCallback, useMemo, useReducer } from "react";
import type { Density } from "@/components/grid/use-roving-grid";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Which drawer is on screen. `cellKey` identifies the grid cell (see `cellKeyOf`). */
export type DrawerOpen = { kind: "cell"; cellKey: string } | { kind: "ask" };

export interface DrawerState {
  open: DrawerOpen | null;
  /**
   * The cell the user last selected, which OUTLIVES the cell drawer when Ask replaces it in the
   * slot. Without it the Ask drawer could never show the "Selected: SEA→NRT Oct 15 F 80,000
   * Alaska" pill spec §3.6 asks for: opening Ask closes the cell drawer, and the selection would
   * go with it. Cleared by `close` and by `close_cell` (a re-run invalidates the selection).
   */
  lastCell: string | null;
}

export type DrawerAction =
  | { type: "open_cell"; cellKey: string }
  | { type: "open_ask" }
  /** Close whichever drawer is open. */
  | { type: "close" }
  /** Close only the cell drawer (a re-run invalidates the selected cell, not the conversation). */
  | { type: "close_cell" };

export const CLOSED_DRAWER_STATE: DrawerState = { open: null, lastCell: null };

/**
 * The whole mutual-exclusion rule: every "open" replaces the slot, so the other drawer is
 * closed in the same render. Re-opening what is already open returns the SAME object, so a
 * repeated click never re-renders the page (and never re-triggers the open transition).
 */
export function drawerReducer(state: DrawerState, action: DrawerAction): DrawerState {
  switch (action.type) {
    case "open_cell":
      if (state.open?.kind === "cell" && state.open.cellKey === action.cellKey) return state;
      return { open: { kind: "cell", cellKey: action.cellKey }, lastCell: action.cellKey };
    case "open_ask":
      if (state.open?.kind === "ask") return state;
      // The selection survives: Ask takes the slot, not the cell the question is about.
      return { open: { kind: "ask" }, lastCell: state.lastCell };
    case "close":
      return state.open === null && state.lastCell === null ? state : CLOSED_DRAWER_STATE;
    case "close_cell":
      if (state.open?.kind === "cell") return CLOSED_DRAWER_STATE;
      return state.lastCell === null ? state : { ...state, lastCell: null };
  }
}

/** The open cell's key, or null when the cell drawer is closed. */
export function openCellKey(state: DrawerState): string | null {
  return state.open?.kind === "cell" ? state.open.cellKey : null;
}

/** The last selected cell's key, whichever drawer is open (null once the selection is cleared). */
export function selectedCellKey(state: DrawerState): string | null {
  return state.lastCell;
}

/** True while the Ask drawer is the open one. */
export function isAskOpen(state: DrawerState): boolean {
  return state.open?.kind === "ask";
}

// ---------------------------------------------------------------------------
// Cell keys
// ---------------------------------------------------------------------------

/** A grid cell's identity — the three fields that address one (pair, date) square. */
export interface CellAddress {
  origin: string;
  dest: string;
  date: string;
}

/** `{ HKG, SEA, 2026-10-15 }` → `"HKG-SEA-2026-10-15"`. */
export function cellKeyOf(cell: CellAddress): string {
  return `${cell.origin}-${cell.dest}-${cell.date}`;
}

const CELL_KEY = /^([A-Z]{3})-([A-Z]{3})-(\d{4}-\d{2}-\d{2})$/;

/**
 * The inverse of `cellKeyOf`. The ISO date carries its own hyphens, so this is a regex and not
 * a `split("-")`; anything that does not match the exact shape is `null` rather than a partly
 * filled address (a bad ?q= or a stale key must not select a phantom cell).
 */
export function parseCellKey(key: string | null): CellAddress | null {
  if (key === null) return null;
  const m = CELL_KEY.exec(key);
  if (!m) return null;
  return { origin: m[1]!, dest: m[2]!, date: m[3]! };
}

// ---------------------------------------------------------------------------
// Presentation mode (spec §6)
// ---------------------------------------------------------------------------

/**
 * How a drawer is presented at the current width:
 *   push         ≥ 1280 — an in-page column; the content beside it shrinks, no scrim, not modal
 *   overlay      768–1279 — over the page with a scrim, modal
 *   sheet        < 768, cell drawer — a full-height sheet
 *   bottom-sheet < 768, Ask drawer — a bottom sheet with a drag handle
 */
export type DrawerMode = "push" | "overlay" | "sheet" | "bottom-sheet";

/** The `< 768` presentation a drawer asks for (spec §6: cell = sheet, Ask = bottom sheet). */
export type MobilePresentation = "sheet" | "bottom-sheet";

export function drawerMode(density: Density, mobile: MobilePresentation): DrawerMode {
  if (density === "desktop") return "push";
  if (density === "tablet") return "overlay";
  return mobile;
}

/** A pushing drawer sits beside the page; every other mode sits on top of it and traps focus. */
export function isModalMode(mode: DrawerMode): boolean {
  return mode !== "push";
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseDrawerState {
  state: DrawerState;
  /** The open cell's key, or null. */
  cellKey: string | null;
  /** The open cell's address, or null. */
  cell: CellAddress | null;
  /**
   * The selected cell's address — the same as `cell` while the cell drawer is open, and still
   * set while the Ask drawer has taken the slot. This is what the Ask context pill reads.
   */
  selected: CellAddress | null;
  askOpen: boolean;
  openCell: (cell: CellAddress | string) => void;
  openAsk: () => void;
  close: () => void;
  /** Close the cell drawer only; leaves an open Ask drawer alone. */
  closeCell: () => void;
}

/** The grid page's single drawer slot. */
export function useDrawerState(initial: DrawerState = CLOSED_DRAWER_STATE): UseDrawerState {
  const [state, dispatch] = useReducer(drawerReducer, initial);
  const openCell = useCallback((cell: CellAddress | string) => {
    dispatch({ type: "open_cell", cellKey: typeof cell === "string" ? cell : cellKeyOf(cell) });
  }, []);
  const openAsk = useCallback(() => dispatch({ type: "open_ask" }), []);
  const close = useCallback(() => dispatch({ type: "close" }), []);
  const closeCell = useCallback(() => dispatch({ type: "close_cell" }), []);
  const cellKey = openCellKey(state);
  const cell = useMemo(() => parseCellKey(cellKey), [cellKey]);
  const selected = useMemo(() => parseCellKey(state.lastCell), [state.lastCell]);
  return { state, cellKey, cell, selected, askOpen: isAskOpen(state), openCell, openAsk, close, closeCell };
}
