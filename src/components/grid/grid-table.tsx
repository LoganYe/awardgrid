"use client";

/**
 * The grid (Phase 6.2, spec §3.4, §6, §8; docs/UI_PLAN.md §4–§7).
 *
 * Semantics: <table role="grid"> with aria-rowcount / aria-colcount; column headers are routes
 * ("SEA → NRT" — the arrow is the route notation) with the muted count of programs monitored;
 * row headers are dates ("Wed Oct 15", ISO in the title). Header row and first column are
 * position: sticky inside the one scroll container. Density (rows 48 / 32 / 40 px, cells with
 * 3 / 2 / 1 lines) comes from `data-density`, set by the matchMedia hook (SSR: desktop).
 *
 * Virtualization: rows × cols > 400 → @tanstack/react-virtual for rows (and for columns when
 * there are more than 24) with spacer rows / cells so the table semantics, the sticky header
 * (rendered outside the virtual body) and the sticky first column all keep working.
 *
 * Keyboard: roving tabindex (use-roving-grid.ts on top of src/lib/grid/keyboard.ts); Enter /
 * Space calls `onSelect`; Esc closes the tooltip and is otherwise left to the drawers. Hover /
 * focus highlight the row and column header and open the tooltip after 300 ms. The focused
 * coordinates live in state so focus survives virtualization.
 */
import "./grid-styles.css";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type Ref } from "react";
import { formatGridDate, formatRowDate } from "@/lib/grid/format";
import { enumerateDates, enumeratePairs, transposeGrid } from "@/lib/grid/pivot";
import type { Grid, GridCell, Orientation, RoutePair } from "@/lib/grid/types";
import { hasKey, type Locale, type Translate } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/client";
import type { QueryObject } from "@/lib/query/schema";
import { SEATS_SOURCES } from "@/lib/seatsaero/types";
import { Cell, uiCellStatus } from "@/components/grid/cell";
import { CellTooltip } from "@/components/grid/cell-tooltip";
import { COLUMN_MIN, ROUTE_ROW_HEAD_WIDTH, ROW_HEAD_WIDTH, ROW_HEIGHT, useDensity, useFinePointer, useRovingGrid, type Density, type GridPos } from "@/components/grid/use-roving-grid";

// Re-exported for src/components/grid/index.ts, which publishes these from here.
export { Cell } from "@/components/grid/cell";
export { FRESHNESS_GLYPH, TIER_TEXT } from "@/components/grid/freshness-mark";

/** Hover / focus delay before the tooltip opens (docs/UI_PLAN.md §7). */
export const TOOLTIP_DELAY_MS = 300;
/**
 * Grace after the pointer leaves a cell before its tooltip closes: long enough to move onto
 * the tooltip itself, which keeps it open (WCAG 2.1 SC 1.4.13 "hoverable").
 */
export const TOOLTIP_GRACE_MS = 100;
/** Above this many cells the body is virtualized (spec §11). */
export const VIRTUALIZE_ABOVE_CELLS = 400;
/** Above this many columns a horizontal virtualizer joins the vertical one. */
export const VIRTUALIZE_COLS_ABOVE = 24;

export interface GridTableHandle {
  /** Move the roving focus to the first "not monitored" cell; false when there is none. */
  focusFirstUnmonitored: () => boolean;
}

export interface GridTableProps {
  grid: Grid;
  now: number;
  selected: GridCell | null;
  onSelect: (cell: GridCell) => void;
  /** Render every cell as a skeleton (the grid shape is the real one; see `skeletonGridFor`). */
  loading?: boolean;
  /** Modified query not yet run: 80 % opacity, "Run to refresh" strip, no interaction. */
  dimmed?: boolean;
  /**
   * Programs monitored per pair key from the routes catalog ("N programs"). When absent the
   * header counts the programs seen in the pair's cells and says so ("N with availability").
   */
  programsByPair?: Record<string, number>;
  ref?: Ref<GridTableHandle>;
}

/** The grid a query WILL produce, every cell empty: the loading skeleton with the real shape (spec §3.7). */
export function skeletonGridFor(query: QueryObject, orientation: Orientation, now: number = Date.now()): Grid {
  const pairs = enumeratePairs(query);
  const dates = enumerateDates(query.date_from, query.date_to);
  const cells: GridCell[][] = dates.map((date) => pairs.map((p) => ({ origin: p.origin, dest: p.dest, date, status: "loading" as const, best: null, all: [] })));
  const grid: Grid = {
    orientation: "dates",
    rows: dates,
    cols: pairs.map((p) => p.key),
    cells,
    pairs,
    dates,
    query,
    meta: {
      generated_at: new Date(now).toISOString(),
      unmonitored_pairs: [],
      not_fetched_pairs: [],
      oldest_seen: null,
      newest_seen: null,
      api_calls_used: 0,
      served_from_cache: false,
    },
  };
  return orientation === "routes" ? transposeGrid(grid) : grid;
}

function samePos(a: GridPos | null, b: GridPos | null): boolean {
  return a === b || (a !== null && b !== null && a.row === b.row && a.col === b.col);
}

function firstCellWhere(grid: Grid, pred: (c: GridCell) => boolean): GridPos | null {
  for (let r = 0; r < grid.cells.length; r += 1) {
    const line = grid.cells[r] ?? [];
    for (let c = 0; c < line.length; c += 1) {
      const cell = line[c];
      if (cell && pred(cell)) return { row: r, col: c };
    }
  }
  return null;
}

interface TooltipState {
  pos: GridPos;
  rect: DOMRect;
}

/** "2 h" / "45 m" / "1 d" (en), "2 小时" (zh): the spaced age used in sentences. */
export function ageSpaced(iso: string, now: number, t: Translate): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "?";
  const minutes = Math.max(0, Math.floor((now - ms) / 60_000));
  if (minutes < 60) return `${Math.max(1, minutes)} ${t("grid.unit.m")}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${t("grid.unit.h")}`;
  return `${Math.floor(hours / 24)} ${t("grid.unit.d")}`;
}

// ---------------------------------------------------------------------------
// Empty results (spec §3.7)
// ---------------------------------------------------------------------------

export interface GridEmptyResultsProps {
  grid: Grid;
  now: number;
  /** Programs the run checked for these pairs (/api/find `programs_checked`); falls back to the query's list. */
  programsChecked?: number;
  /** Opens the Dates chip editor (6.3). Omitted when the range is already the longest one. */
  onWidenDates?: () => void;
  /** Shown in place of "Widen the dates" when the window is already at the 92-day cap. */
  dateCapNote?: string;
  /** Opens the Cabins chip editor (6.3). */
  onAddCabin?: () => void;
  /** Focuses the first hatched cell (GridTableHandle.focusFirstUnmonitored). */
  onReviewUnmonitored?: () => void;
}

/** "No J or F availability on these 4 routes between Oct 1 and Oct 30. Checked 3 programs, 2 h ago." + three links. */
export function GridEmptyResults({ grid, now, programsChecked, onWidenDates, dateCapNote, onAddCabin, onReviewUnmonitored }: GridEmptyResultsProps) {
  const t = useT();
  const locale = useLocale();
  const q = grid.query;
  const or = t("grid.join.or");
  const cabins = q.cabins.map((c) => (locale === "zh" ? t(`grid.cabin.${c}`) : c)).join(locale === "zh" ? or : ` ${or} `);
  const text = t("grid.empty.no_results_detail", {
    cabins,
    routes: grid.pairs.length,
    from: formatGridDate(q.date_from, locale),
    to: formatGridDate(q.date_to, locale),
    programs: programsChecked ?? (q.programs && q.programs.length > 0 ? q.programs.length : SEATS_SOURCES.length),
    age: ageSpaced(grid.meta.generated_at, now, t),
  });
  const hasUnmonitored = grid.meta.unmonitored_pairs.length > 0;
  return (
    <div className="ag-empty" role="status" data-testid="grid-empty-results">
      <p>{text}</p>
      <div className="ag-empty-links">
        {onWidenDates && (
          <button type="button" className="ag-link" onClick={onWidenDates}>
            {t("grid.empty.widen_dates")}
          </button>
        )}
        {!onWidenDates && dateCapNote && (
          <span className="text-fg-muted" data-testid="empty-date-cap">
            {dateCapNote}
          </span>
        )}
        {onAddCabin && (
          <button type="button" className="ag-link" onClick={onAddCabin}>
            {t("grid.empty.add_cabin")}
          </button>
        )}
        {onReviewUnmonitored && hasUnmonitored && (
          <button type="button" className="ag-link" onClick={onReviewUnmonitored}>
            {t("grid.empty.review_unmonitored")}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

interface HeaderText {
  label: string;
  sub: string | null;
  title: string | undefined;
}

function useHeaderText(grid: Grid, loading: boolean, locale: Locale, t: Translate, programsByPair: Record<string, number> | undefined, density: Density) {
  const pairByKey = useMemo(() => new Map(grid.pairs.map((p) => [p.key, p])), [grid.pairs]);
  const unmonitored = useMemo(() => new Set(grid.meta.unmonitored_pairs.map((p) => p.key)), [grid.meta.unmonitored_pairs]);
  // A pair whose fetch never completed: its cells all read "Not fetched", so its header says so
  // too. Without this the one column that explains nothing was the one that most needed to.
  const notFetched = useMemo(
    () => new Map(grid.meta.not_fetched_pairs.map((p) => [`${p.pair.origin}-${p.pair.dest}`, p.reason])),
    [grid.meta.not_fetched_pairs],
  );

  // Programs per pair: the routes catalog's monitoring count when the caller knows it ("N
  // programs"); otherwise the distinct programs seen in the pair's cells, labelled as such ("N
  // with availability") — the header never claims a monitoring count it cannot know.
  const programsPerPair = useMemo(() => {
    const seen = new Map<string, Set<string>>();
    for (const line of grid.cells) {
      for (const cell of line) {
        const key = `${cell.origin}-${cell.dest}`;
        let set = seen.get(key);
        if (!set) {
          set = new Set();
          seen.set(key, set);
        }
        for (const row of cell.all) set.add(row.program);
      }
    }
    const out = new Map<string, number>();
    for (const p of grid.pairs) out.set(p.key, programsByPair?.[p.key] ?? seen.get(p.key)?.size ?? 0);
    return out;
  }, [grid, programsByPair]);

  return useCallback(
    (label: string, kind: "pair" | "date"): HeaderText => {
      // "Wed Oct 15" (spec §3.4): Intl's en-US form is "Wed, Oct 15", so the comma goes; zh has none.
      // Below 768 px the sticky column is 72 px, so the weekday goes ("Oct 15", plan §6.4).
      if (kind === "date") return { label: density === "mobile" ? formatGridDate(label, locale) : formatRowDate(label, locale).replace(/,\s*/, " "), sub: null, title: label };
      const pair: RoutePair | undefined = pairByKey.get(label);
      const text = pair ? `${pair.origin} → ${pair.dest}` : label.replace("-", " → ");
      if (unmonitored.has(label)) return { label: text, sub: t("grid.cell.unmonitored_short"), title: t("grid.cell.not_monitored") };
      const missed = notFetched.get(label);
      if (missed !== undefined && !loading) {
        const reason = hasKey(missed) ? t(missed) : t("grid.cell.not_fetched");
        return { label: text, sub: t("grid.cell.not_fetched"), title: reason };
      }
      const n = programsPerPair.get(label) ?? 0;
      const monitored = programsByPair !== undefined;
      const sub =
        loading || n === 0
          ? null
          : monitored
            ? n === 1
              ? t("grid.header.programs_one")
              : t("grid.header.programs_other", { n })
            : n === 1
              ? t("grid.header.available_one")
              : t("grid.header.available_other", { n });
      return { label: text, sub, title: undefined };
    },
    [locale, pairByKey, unmonitored, notFetched, programsPerPair, programsByPair, loading, t, density],
  );
}

export function GridTable({ grid, now, selected, onSelect, loading = false, dimmed = false, programsByPair, ref }: GridTableProps) {
  const t = useT();
  const locale = useLocale();
  const density = useDensity();
  const rowHeight = ROW_HEIGHT[density];
  /*
    The sticky row-header width follows what the row headers ARE, not only the density. 72 / 80 px
    were sized for a date ("Sep 6"); in Routes orientation the same column holds a pair, and at
    mobile density every header ellipsed to "HKG → …" — no row could be identified. 96 px is the
    figure desktop already proves fits "HKG → SEA" (with a sub-line, which mobile drops).
  */
  const rowsAre: "pair" | "date" = grid.orientation === "dates" ? "date" : "pair";
  const rowHeadWidth = rowsAre === "pair" ? Math.max(ROW_HEAD_WIDTH[density], ROUTE_ROW_HEAD_WIDTH) : ROW_HEAD_WIDTH[density];
  const tooltipId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);

  const rowCount = grid.rows.length;
  const colCount = grid.cols.length;
  const virtualize = rowCount * colCount > VIRTUALIZE_ABOVE_CELLS;
  const virtualizeCols = virtualize && colCount > VIRTUALIZE_COLS_ABOVE;
  const showCabinTag = grid.query.cabins.length > 1;

  const headerText = useHeaderText(grid, loading, locale, t, programsByPair, density);
  const colKind: "pair" | "date" = grid.orientation === "dates" ? "pair" : "date";
  const rowKind: "pair" | "date" = rowsAre;

  // ---- hover, focus, tooltip ----
  const finePointer = useFinePointer();
  const [hover, setHover] = useState<GridPos | null>(null);
  const [hasFocus, setHasFocus] = useState(false);
  const [tip, setTip] = useState<TooltipState | null>(null);
  // Mirror of `tip` for the hover handlers, so opening a tooltip never re-creates them (and
  // never re-renders every memoized cell).
  const tipRef = useRef<TooltipState | null>(null);
  useEffect(() => {
    tipRef.current = tip;
  }, [tip]);
  const tipTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const cancelPendingOpen = useCallback(() => {
    if (tipTimer.current !== null) window.clearTimeout(tipTimer.current);
    tipTimer.current = null;
  }, []);
  const cancelPendingClose = useCallback(() => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  /** Close now (keyboard move, Esc, blur, activation). */
  const disarmTooltip = useCallback(() => {
    cancelPendingOpen();
    cancelPendingClose();
    setTip((cur) => (cur === null ? cur : null));
  }, [cancelPendingOpen, cancelPendingClose]);
  /** Close after the grace period unless the pointer reaches the tooltip or comes back to its cell. */
  const scheduleClose = useCallback(() => {
    cancelPendingClose();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setTip((cur) => (cur === null ? cur : null));
    }, TOOLTIP_GRACE_MS);
  }, [cancelPendingClose]);
  // The pointer is on the tooltip: it stays open, and no other cell's tooltip may replace it.
  const onTipEnter = useCallback(() => {
    cancelPendingClose();
    cancelPendingOpen();
  }, [cancelPendingClose, cancelPendingOpen]);
  const onTipLeave = useCallback(() => scheduleClose(), [scheduleClose]);
  // Scrolling closes an OPEN tooltip (its anchor rect is stale) but leaves a pending one alone:
  // a keyboard move scrolls the container itself (scrollIntoView, the sticky-header nudge), and
  // that scroll must not cancel the tooltip the move just armed. The timer reads the cell's
  // rect when it fires, so the tooltip lands where the cell is after the scroll.
  const onScroll = useCallback(() => setTip((cur) => (cur === null ? cur : null)), []);

  const rowV = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 6,
    enabled: virtualize,
  });
  const colV = useVirtualizer({
    horizontal: true,
    count: colCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => COLUMN_MIN,
    overscan: 4,
    paddingStart: rowHeadWidth,
    enabled: virtualizeCols,
  });
  useEffect(() => {
    rowV.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-measure only when the row height changes
  }, [rowHeight]);

  const scrollTo = useCallback(
    (pos: GridPos) => {
      if (virtualize) rowV.scrollToIndex(pos.row, { align: "auto" });
      if (virtualizeCols) colV.scrollToIndex(pos.col, { align: "auto" });
    },
    [virtualize, virtualizeCols, rowV, colV],
  );

  // Tab lands on the first available cell (docs/UI_PLAN.md §7), else the top-left one.
  const initial = useMemo(() => firstCellWhere(grid, (c) => c.status === "ok") ?? { row: 0, col: 0 }, [grid]);

  const cellAt = useCallback((pos: GridPos): GridCell | null => grid.cells[pos.row]?.[pos.col] ?? null, [grid]);

  const activate = useCallback(
    (pos: GridPos) => {
      if (loading || dimmed) return;
      const cell = cellAt(pos);
      if (cell) {
        disarmTooltip();
        onSelect(cell);
      }
    },
    [loading, dimmed, cellAt, disarmTooltip, onSelect],
  );

  const roving = useRovingGrid({
    rows: rowCount,
    cols: colCount,
    initial,
    onActivate: activate,
    scrollTo,
    onMove: disarmTooltip,
  });
  const { register, elementAt, focusCell, onCellFocus } = roving;

  const armTooltip = useCallback(
    (pos: GridPos) => {
      cancelPendingOpen();
      if (loading || dimmed) return;
      tipTimer.current = window.setTimeout(() => {
        tipTimer.current = null;
        const el = elementAt(pos);
        if (!el) return;
        setTip({ pos, rect: el.getBoundingClientRect() });
      }, TOOLTIP_DELAY_MS);
    },
    [loading, dimmed, elementAt, cancelPendingOpen],
  );
  useEffect(() => () => disarmTooltip(), [disarmTooltip]);

  // The drawer just opened for a cell: no tooltip on top of it.
  useEffect(() => {
    if (selected) disarmTooltip();
  }, [selected, disarmTooltip]);

  // Keyboard move: the tooltip re-opens on the new cell after the same delay.
  const lastFocus = useRef<GridPos | null>(null);
  useEffect(() => {
    if (!hasFocus || roving.pending) return;
    if (samePos(lastFocus.current, roving.focus)) return;
    lastFocus.current = roving.focus;
    // Only when the focus came from the keyboard. `:focus-visible` is exactly that question, and
    // asking it is what keeps the tooltip off a touchscreen (issue #32): closing the drawer hands
    // focus back to the cell that opened it, which armed the tooltip over the row below with no
    // pointer left to move away and dismiss it. A tap does not match `:focus-visible`; an arrow
    // key does, so the keyboard path — and WCAG 2.1 SC 1.4.13 with it — is untouched.
    const focused = elementAt(roving.focus);
    if (focused?.matches(":focus-visible") ?? false) armTooltip(roving.focus);
    // Sticky header / first column: scrollIntoView ignores them, so nudge the scroll container.
    const el = elementAt(roving.focus);
    const scroller = scrollRef.current;
    if (el && scroller) {
      const cell = el.getBoundingClientRect();
      const box = scroller.getBoundingClientRect();
      if (cell.top < box.top + rowHeight) scroller.scrollTop -= box.top + rowHeight - cell.top;
      if (cell.left < box.left + rowHeadWidth) scroller.scrollLeft -= box.left + rowHeadWidth - cell.left;
    }
  }, [hasFocus, roving.focus, roving.pending, armTooltip, elementAt, rowHeight, rowHeadWidth]);

  const onHover = useCallback(
    (row: number, col: number, entering: boolean) => {
      // A touchscreen has no hover to report. iOS synthesises `mouseenter` on tap and never sends
      // `mouseleave`, so arming the tooltip here would open it after every tap and leave it over
      // the row below. The FOCUS path still opens it — including for keyboards, which is what
      // WCAG 2.1 SC 1.4.13 ("hoverable") is about — and a tap focuses the cell it activates.
      if (!finePointer) return;
      if (entering) {
        setHover({ row, col });
        const open = tipRef.current;
        // Back onto the cell of the open tooltip (from the tooltip itself): keep it, no re-open.
        if (open && open.pos.row === row && open.pos.col === col) {
          cancelPendingClose();
          return;
        }
        armTooltip({ row, col });
      } else {
        setHover((h) => (h && h.row === row && h.col === col ? null : h));
        cancelPendingOpen();
        scheduleClose();
      }
    },
    [armTooltip, cancelPendingClose, cancelPendingOpen, scheduleClose, finePointer],
  );

  const onFocusCell = useCallback((row: number, col: number) => onCellFocus({ row, col }), [onCellFocus]);
  const onActivateCell = useCallback((row: number, col: number) => activate({ row, col }), [activate]);

  const onKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    if (e.key === "Escape") {
      // Closes the tooltip only; the event keeps bubbling so an open drawer can close too.
      disarmTooltip();
      return;
    }
    roving.onKeyDown(e);
  };
  const onFocus = () => setHasFocus(true);
  const onBlur = (e: FocusEvent<HTMLTableElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setHasFocus(false);
    lastFocus.current = null;
    disarmTooltip();
  };

  useImperativeHandle(
    ref,
    () => ({
      focusFirstUnmonitored: () => {
        const pos = firstCellWhere(grid, (c) => c.status === "unmonitored");
        if (!pos) return false;
        focusCell(pos);
        return true;
      },
    }),
    [grid, focusCell],
  );

  // Header highlight follows the hovered cell, else the focused one while the grid has focus.
  const hl: GridPos | null = hover ?? (hasFocus ? roving.focus : null);

  // ---- rows / columns to render ----
  const rowItems = virtualize ? rowV.getVirtualItems() : null;
  const colItems = virtualizeCols ? colV.getVirtualItems() : null;
  const rowIndexes = rowItems ? rowItems.map((it) => it.index) : Array.from({ length: rowCount }, (_, i) => i);
  const colIndexes = colItems ? colItems.map((it) => it.index) : Array.from({ length: colCount }, (_, i) => i);
  const padTop = rowItems && rowItems.length > 0 ? (rowItems[0]?.start ?? 0) : 0;
  const padBottom = rowItems && rowItems.length > 0 ? rowV.getTotalSize() - (rowItems[rowItems.length - 1]?.end ?? 0) : 0;
  const padLeft = colItems && colItems.length > 0 ? (colItems[0]?.start ?? rowHeadWidth) - rowHeadWidth : 0;
  const padRight = colItems && colItems.length > 0 ? colV.getTotalSize() - (colItems[colItems.length - 1]?.end ?? 0) : 0;

  const isSelected = (c: GridCell) => selected !== null && selected.origin === c.origin && selected.dest === c.dest && selected.date === c.date;

  // The one tab stop. Under virtualization the roving cell may be scrolled out of the rendered
  // window; the first rendered cell then carries tabindex=0 so the grid never loses its tab stop
  // (onCellFocus adopts whichever cell Tab lands on).
  const focusMounted = rowIndexes.includes(roving.focus.row) && colIndexes.includes(roving.focus.col);
  const tabStop: GridPos = focusMounted ? roving.focus : { row: rowIndexes[0] ?? 0, col: colIndexes[0] ?? 0 };
  const tipCell = tip ? cellAt(tip.pos) : null;

  const colSpanAll = colIndexes.length + 1 + (colItems ? 2 : 0);
  const style = { "--ag-row-h": `${rowHeight}px`, "--ag-rowhead-w": `${rowHeadWidth}px` } as React.CSSProperties;
  const spacer = { padding: 0, border: 0 } as const;

  return (
    <div className="ag-wrap" data-density={density} data-rows={rowKind} data-dimmed={dimmed ? "true" : undefined} data-virtualized={virtualize ? "true" : "false"} data-loading={loading ? "true" : undefined} style={style}>
      <p className="sr-only" id={`${tooltipId}-legend`}>
        {t("grid.legend")}
      </p>
      {dimmed && <div className="ag-strip">{t("grid.run_to_refresh")}</div>}
      <div ref={scrollRef} className="ag-scroll" onScroll={onScroll}>
        <table
          role="grid"
          className="ag-table"
          data-fixed={virtualizeCols ? "true" : undefined}
          aria-label={t("grid.grid_label")}
          aria-describedby={`${tooltipId}-legend`}
          aria-rowcount={rowCount + 1}
          aria-colcount={colCount + 1}
          aria-busy={loading ? "true" : undefined}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          onBlur={onBlur}
        >
          <thead>
            <tr role="row" aria-rowindex={1}>
              <th scope="col" role="columnheader" className="ag-corner" aria-colindex={1}>
                {rowKind === "date" ? t("grid.toolbar.rows_dates") : t("grid.toolbar.rows_routes")}
              </th>
              {colItems && <th role="presentation" style={{ width: padLeft, minWidth: padLeft, ...spacer }} />}
              {colIndexes.map((c) => {
                const label = grid.cols[c] ?? "";
                const h = headerText(label, colKind);
                return (
                  <th key={label} scope="col" role="columnheader" aria-colindex={c + 2} data-hl={hl && hl.col === c ? "true" : undefined} title={h.title} style={virtualizeCols ? { width: COLUMN_MIN } : undefined}>
                    {h.label}
                    {h.sub && <span className="ag-head-sub">{h.sub}</span>}
                  </th>
                );
              })}
              {colItems && <th role="presentation" style={{ width: padRight, minWidth: padRight, ...spacer }} />}
            </tr>
          </thead>
          <tbody>
            {rowItems && padTop > 0 && (
              <tr role="presentation" style={{ height: padTop }}>
                <td colSpan={colSpanAll} style={spacer} />
              </tr>
            )}
            {rowIndexes.map((r) => {
              const label = grid.rows[r] ?? "";
              const h = headerText(label, rowKind);
              const line = grid.cells[r] ?? [];
              return (
                <tr key={label} role="row" aria-rowindex={r + 2}>
                  <th scope="row" role="rowheader" className="ag-rowhead" aria-colindex={1} data-hl={hl && hl.row === r ? "true" : undefined} title={h.title}>
                    {h.label}
                    {h.sub && density === "desktop" && <span className="ag-head-sub">{h.sub}</span>}
                  </th>
                  {colItems && <td role="presentation" style={spacer} />}
                  {colIndexes.map((c) => {
                    const cell = line[c];
                    if (!cell) return null;
                    const status = uiCellStatus(cell, loading);
                    const tabbable = !loading && tabStop.row === r && tabStop.col === c;
                    return (
                      <Cell
                        key={`${cell.origin}-${cell.dest}-${cell.date}`}
                        cell={cell}
                        status={status}
                        now={now}
                        density={density}
                        showCabinTag={showCabinTag}
                        cabins={grid.query.cabins}
                        row={r}
                        col={c}
                        tabbable={tabbable}
                        selected={isSelected(cell)}
                        describedBy={tip && tip.pos.row === r && tip.pos.col === c ? tooltipId : undefined}
                        t={t}
                        locale={locale}
                        register={register}
                        onActivate={onActivateCell}
                        onFocusCell={onFocusCell}
                        onHover={onHover}
                      />
                    );
                  })}
                  {colItems && <td role="presentation" style={spacer} />}
                </tr>
              );
            })}
            {rowItems && padBottom > 0 && (
              <tr role="presentation" style={{ height: padBottom }}>
                <td colSpan={colSpanAll} style={spacer} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {tip && tipCell && (
        <CellTooltip id={tooltipId} cell={tipCell} status={uiCellStatus(tipCell, loading)} now={now} anchor={tip.rect} t={t} locale={locale} onPointerEnter={onTipEnter} onPointerLeave={onTipLeave} />
      )}
    </div>
  );
}
