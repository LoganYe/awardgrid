/**
 * Roving-tabindex keyboard model for the grid (Phase 6 §3.4, UI_PLAN §8). Pure: takes the
 * focused cell position, the key, and the grid dimensions; returns the new position or null
 * when the key is not a navigation key (so the component leaves the event alone).
 *
 *   ArrowUp / ArrowDown / ArrowLeft / ArrowRight   one cell; no wrap, clamped at the edges
 *   Home / End                                     first / last cell of the row
 *   PageUp / PageDown                              PAGE_ROWS (7) rows up / down, clamped
 *   Ctrl+Home / Ctrl+End (Cmd on macOS)            top-left / bottom-right corner
 *
 * Enter / Space (open the drawer) and Escape (close it) are actions, not moves, and stay in
 * the component.
 */

export interface CellPosition {
  row: number;
  col: number;
}

export interface GridDimensions {
  rows: number;
  cols: number;
}

/** Keys the model handles; anything else returns null from moveFocus. */
export type NavigationKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Home" | "End" | "PageUp" | "PageDown";

export interface KeyModifiers {
  ctrlKey?: boolean;
  metaKey?: boolean;
}

/** Rows a PageUp/PageDown press moves (one week of dates). */
export const PAGE_ROWS = 7;

export const NAVIGATION_KEYS: readonly NavigationKey[] = [
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
];

export function isNavigationKey(key: string): key is NavigationKey {
  return (NAVIGATION_KEYS as readonly string[]).includes(key);
}

function clamp(n: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(Math.max(0, n), max - 1);
}

/** Bring any position (e.g. after the grid shrank) back inside the grid. */
export function clampPosition(pos: CellPosition, dims: GridDimensions): CellPosition {
  return { row: clamp(pos.row, dims.rows), col: clamp(pos.col, dims.cols) };
}

/**
 * New focus position for `key`, or null when the key is not a navigation key. Never wraps:
 * moving past an edge stays on the edge cell. An empty grid always yields {0, 0}.
 */
export function moveFocus(pos: CellPosition, key: string, dims: GridDimensions, mods: KeyModifiers = {}): CellPosition | null {
  if (!isNavigationKey(key)) return null;
  const { row, col } = clampPosition(pos, dims);
  const corner = Boolean(mods.ctrlKey || mods.metaKey);
  switch (key) {
    case "ArrowUp":
      return { row: clamp(row - 1, dims.rows), col };
    case "ArrowDown":
      return { row: clamp(row + 1, dims.rows), col };
    case "ArrowLeft":
      return { row, col: clamp(col - 1, dims.cols) };
    case "ArrowRight":
      return { row, col: clamp(col + 1, dims.cols) };
    case "Home":
      return corner ? { row: 0, col: 0 } : { row, col: 0 };
    case "End":
      return corner ? { row: clamp(dims.rows - 1, dims.rows), col: clamp(dims.cols - 1, dims.cols) } : { row, col: clamp(dims.cols - 1, dims.cols) };
    case "PageUp":
      return { row: clamp(row - PAGE_ROWS, dims.rows), col };
    case "PageDown":
      return { row: clamp(row + PAGE_ROWS, dims.rows), col };
  }
}

/** The `tabindex` for a cell under the roving model: 0 for the focused cell, -1 elsewhere. */
export function rovingTabIndex(pos: CellPosition, focused: CellPosition): 0 | -1 {
  return pos.row === focused.row && pos.col === focused.col ? 0 : -1;
}
