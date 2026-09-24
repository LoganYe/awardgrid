/**
 * The matrix's keyboard model (UI/UX v1 T09; spec §14; APG data grid): one tab stop — the active cell — and the
 * keys that move it. The active cell is a coordinate (date index, route index), never a DOM index, so it survives
 * re-rendering, sorting of other views and scrolling; the DOM element is found from the coordinate when focus moves.
 *
 *   Arrow keys     one cell, stopping at the edges (no wrap)
 *   Home / End     first / last cell of the row
 *   Ctrl/Cmd+Home  first cell of the grid; Ctrl/Cmd+End the last
 *   PageUp/Down    seven rows (a week of dates)
 *   Enter          `onOpen` for the active cell
 */
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";

/**
 * Focus a cell and show it with the grid's own header and dates: the grid's scroller first comes wholly into view
 * (the page's scroll padding keeps it below the sticky header and summary), then the cell within the scroller.
 */
export function revealCell(el: HTMLElement) {
  el.closest<HTMLElement>(".ag-mx-scroll")?.scrollIntoView({ block: "nearest" });
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
}

export interface MatrixPoint {
  row: number;
  col: number;
}

export function useMatrixFocus(rows: number, cols: number, onOpen: (at: MatrixPoint) => void) {
  const [active, setActive] = useState<MatrixPoint>({ row: 0, col: 0 });
  const cells = useRef(new Map<string, HTMLElement>());
  // Set when a key moved the active cell, so the effect moves focus too; a click or a render never steals focus.
  const moved = useRef(false);

  // The grid can shrink (a new search): keep the active cell inside it.
  const clamped = { row: Math.min(active.row, Math.max(0, rows - 1)), col: Math.min(active.col, Math.max(0, cols - 1)) };

  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    const el = cells.current.get(`${clamped.row}:${clamped.col}`);
    if (el) revealCell(el);
  });

  const cellRef = useCallback(
    (at: MatrixPoint) => (el: HTMLElement | null) => {
      const key = `${at.row}:${at.col}`;
      if (el) cells.current.set(key, el);
      else cells.current.delete(key);
    },
    [],
  );

  const moveTo = (next: MatrixPoint) => {
    moved.current = true;
    setActive({ row: Math.max(0, Math.min(rows - 1, next.row)), col: Math.max(0, Math.min(cols - 1, next.col)) });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const { row, col } = clamped;
    const corner = event.ctrlKey || event.metaKey;
    const moves: Record<string, () => MatrixPoint> = {
      ArrowRight: () => ({ row, col: col + 1 }),
      ArrowLeft: () => ({ row, col: col - 1 }),
      ArrowDown: () => ({ row: row + 1, col }),
      ArrowUp: () => ({ row: row - 1, col }),
      Home: () => (corner ? { row: 0, col: 0 } : { row, col: 0 }),
      End: () => (corner ? { row: rows - 1, col: cols - 1 } : { row, col: cols - 1 }),
      PageDown: () => ({ row: row + 7, col }),
      PageUp: () => ({ row: row - 7, col }),
    };
    if (event.key === "Enter") {
      event.preventDefault();
      onOpen(clamped);
      return;
    }
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    moveTo(move());
  };

  /** Focus the active cell (the grid itself was focused, or focus comes back from the cell's options or a new search). */
  const focusActive = (at: MatrixPoint = clamped) => {
    const el = cells.current.get(`${at.row}:${at.col}`);
    if (el) revealCell(el);
  };

  return { active: clamped, setActive, cellRef, onKeyDown, focusActive };
}
