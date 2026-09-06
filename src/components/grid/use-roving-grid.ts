"use client";

/**
 * Grid hooks (Phase 6.2): the roving-tabindex keyboard model (spec §3.4, docs/UI_PLAN.md §7)
 * and the density breakpoint (spec §6).
 *
 * Keyboard model: exactly one cell is tabbable (`tabindex=0`); arrows move one cell, Home/End
 * go to the row ends, Ctrl/Cmd+Home/End to the grid corners, PageUp/PageDown move PAGE_ROWS
 * rows, Enter/Space activate the cell. The movement itself is the pure `moveFocus` from
 * src/lib/grid/keyboard.ts; this hook only owns DOM focus.
 *
 * Focus survives virtualization: the focused coordinates live in state, the cell elements
 * register themselves in a map, and a pending-focus effect runs after every render — when the
 * target row is not mounted yet the hook asks the caller to scroll it into view and retries on
 * the re-render the virtualizer triggers.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { clampPosition, isNavigationKey, moveFocus, type CellPosition } from "@/lib/grid/keyboard";

// ---------------------------------------------------------------------------
// Density (spec §6): ≥ 1280 desktop, 768–1279 tablet, < 768 mobile. SSR default: desktop.
// ---------------------------------------------------------------------------

export type Density = "desktop" | "tablet" | "mobile";

const DESKTOP_QUERY = "(min-width: 1280px)";
const TABLET_QUERY = "(min-width: 768px)";

function readDensity(): Density {
  if (typeof window === "undefined" || !window.matchMedia) return "desktop";
  if (window.matchMedia(DESKTOP_QUERY).matches) return "desktop";
  if (window.matchMedia(TABLET_QUERY).matches) return "tablet";
  return "mobile";
}

/** Current density from matchMedia; "desktop" on the server and during hydration. */
export function useDensity(): Density {
  const [density, setDensity] = useState<Density>("desktop");
  useEffect(() => {
    if (!window.matchMedia) return;
    const update = () => setDensity(readDensity());
    update();
    const queries = [window.matchMedia(DESKTOP_QUERY), window.matchMedia(TABLET_QUERY)];
    for (const q of queries) q.addEventListener("change", update);
    return () => {
      for (const q of queries) q.removeEventListener("change", update);
    };
  }, []);
  return density;
}

/** Row heights per density (px). Mirrors --row-desktop / --row-tablet / --row-touch in tokens.css. */
export const ROW_HEIGHT: Record<Density, number> = { desktop: 48, tablet: 32, mobile: 40 };
/** Minimum column width (px), mirrors --column-min. Also the fixed width under column virtualization. */
export const COLUMN_MIN = 112;
/** Sticky row-header column width per density (docs/UI_PLAN.md §4). */
export const ROW_HEAD_WIDTH: Record<Density, number> = { desktop: 96, tablet: 80, mobile: 72 };
/** Floor for the sticky row header when the rows are route pairs ("HKG → SEA"), not dates. */
export const ROUTE_ROW_HEAD_WIDTH = 96;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export type GridPos = CellPosition;

export interface RovingGridOptions {
  rows: number;
  cols: number;
  /** Where Tab lands the first time (the first available cell, per the plan). */
  initial?: GridPos;
  /** Enter / Space on the focused cell. */
  onActivate: (pos: GridPos) => void;
  /** Ask the virtualizer to bring a row/column into view before focusing it. */
  scrollTo?: (pos: GridPos) => void;
  /** Fired on every keyboard-driven move (closes the tooltip, re-arms it). */
  onMove?: (pos: GridPos) => void;
}

export interface RovingGrid {
  /** The one tabbable cell. */
  focus: GridPos;
  /** Whether that cell should actually hold DOM focus after this render. */
  pending: boolean;
  /** Keydown handler for the grid element (events bubble up from the cells). */
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  /** Ref callback for every rendered cell: `ref={(el) => register(el, row, col)}`. */
  register: (el: HTMLElement | null, row: number, col: number) => void;
  /** The cell received DOM focus by mouse or Tab: make it the roving one. */
  onCellFocus: (pos: GridPos) => void;
  /** Move the roving focus and focus the element (scrolling it into view if needed). */
  focusCell: (pos: GridPos) => void;
  /** The mounted element for a position, when rendered. */
  elementAt: (pos: GridPos) => HTMLElement | null;
}

const key = (r: number, c: number) => `${r}:${c}`;

/** Frames to wait for a virtualized row to mount before giving up on a pending focus. */
const MAX_FOCUS_ATTEMPTS = 8;

export function useRovingGrid({ rows, cols, initial, onActivate, scrollTo, onMove }: RovingGridOptions): RovingGrid {
  const [rawFocus, setFocus] = useState<GridPos>(() => clampPosition(initial ?? { row: 0, col: 0 }, { rows, cols }));
  // The roving cell always lies inside the current grid shape (orientation toggle, re-run):
  // clamped while rendering, so a shrink never leaves focus on a cell that no longer exists.
  const focus = useMemo(() => clampPosition(rawFocus, { rows, cols }), [rawFocus, rows, cols]);
  const [pending, setPending] = useState(false);
  // Bumped to force a re-render while a not-yet-mounted target row scrolls into view.
  const [retry, setRetry] = useState(0);
  const cells = useRef(new Map<string, HTMLElement>());
  const attempts = useRef(0);

  const register = useCallback((el: HTMLElement | null, row: number, col: number) => {
    const k = key(row, col);
    if (el) cells.current.set(k, el);
    else cells.current.delete(k);
  }, []);

  const elementAt = useCallback((pos: GridPos) => cells.current.get(key(pos.row, pos.col)) ?? null, []);

  const focusCell = useCallback(
    (pos: GridPos) => {
      const next = clampPosition(pos, { rows, cols });
      attempts.current = 0;
      setFocus(next);
      setPending(true);
      onMove?.(next);
    },
    [rows, cols, onMove],
  );

  // Pending focus: runs after every render so a virtualized row that mounts on the next frame
  // still receives focus. Gives up after a handful of frames rather than looping forever.
  useEffect(() => {
    if (!pending) return;
    const el = cells.current.get(key(focus.row, focus.col));
    if (el) {
      if (document.activeElement !== el) el.focus({ preventScroll: true });
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
      setPending(false);
      return;
    }
    if (attempts.current >= MAX_FOCUS_ATTEMPTS) {
      setPending(false);
      return;
    }
    attempts.current += 1;
    scrollTo?.(focus);
    const id = window.requestAnimationFrame(() => setRetry((n) => n + 1));
    return () => window.cancelAnimationFrame(id);
  }, [pending, focus, scrollTo, retry]);

  const onCellFocus = useCallback((pos: GridPos) => {
    setFocus((f) => (f.row === pos.row && f.col === pos.col ? f : pos));
  }, []);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (e.altKey) return;
      if (isNavigationKey(e.key)) {
        // Cmd+Home/End on macOS, Ctrl+Home/End elsewhere: the grid corners. Other Cmd/Ctrl
        // combinations are browser shortcuts and stay untouched.
        const corner = e.ctrlKey || e.metaKey;
        if (corner && e.key !== "Home" && e.key !== "End") return;
        e.preventDefault();
        const next = moveFocus(focus, e.key, { rows, cols }, { ctrlKey: e.ctrlKey, metaKey: e.metaKey });
        if (next) focusCell(next);
        return;
      }
      if (e.metaKey || e.ctrlKey) return;
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        onActivate(focus);
      }
    },
    [focus, rows, cols, focusCell, onActivate],
  );

  return { focus, pending, onKeyDown, register, onCellFocus, focusCell, elementAt };
}
