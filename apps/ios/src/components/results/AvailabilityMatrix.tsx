/**
 * The Matrix view (UI/UX v1 T09; docs/04 S03; spec §14 "矩阵"; reference desktop-matrix.png for its states only):
 * which dates and routes are worth a look, from the same projection as the list and calendar.
 *
 *   - Rows are the search's dates, columns its routes; each cell holds one slot per cabin asked, in cabin order, each
 *     labelled with its cabin — no number mixes cabins. A slot shows its lowest miles in full ("75,000"), the program's
 *     short name and the seats; an empty slot says why in words (no matches, not checked to the end, coverage unknown,
 *     not monitored, hidden by the view filter), never a bare dash. The caption says the numbers are the lowest (the
 *     lowest retrieved where coverage is not complete) and that miles in different programs are not equivalent.
 *   - Phone geometry: an 88 pt date column, then as many whole data columns of at least 124 as fit, sharing the rest
 *     (core mobileColumns: 135 × 2 at 390). The date column and the header stay put; sideways scrolling settles on
 *     whole columns, so a figure is never left cut to "000".
 *   - A keyboard grid (useMatrixFocus): one tab stop, arrows, Home/End, Ctrl/Cmd+Home/End; Enter (or a tap) opens the
 *     cell's options below, Esc returns focus to the cell. Every cell is named in full and carries its true row and
 *     column index. Nothing here fetches; selection is the list's.
 */
import { matrixModel, mobileColumns, sortRows } from "@awardgrid/core/workspace/projection";
import { copy, dayLabel, dayParts, emptyDayLabel, formatMiles, matrixCellName, programShortLabel, seatsLabel } from "@awardgrid/core/workspace/present";
import type { MatrixSlot, ProjectedResults, ResultSnapshot, RowKey, ViewPreferences } from "@awardgrid/core/workspace/types";
import { type CSSProperties, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Locale } from "../../app/locale";
import { AvailabilityList } from "./AvailabilityList";
import { RESULTS } from "./copy";
import { type MatrixPoint, useMatrixFocus } from "./useMatrixFocus";

export interface AvailabilityMatrixProps {
  snapshot: ResultSnapshot;
  projected: ProjectedResults;
  sort: ViewPreferences["sort"];
  selected: ReadonlySet<RowKey>;
  onToggle: (rowKey: RowKey, on: boolean) => void;
  now: string;
  locale: Locale;
  /** Open an option's details (T10): a one-option cell opens it directly, focus to come back to the cell. */
  onOpen?: (rowKey: RowKey, returnFocusId: string) => void;
}

/** A cell's element id: stable across renders and new snapshots, so focus can come back to it. */
const cellId = (date: string, origin: string, dest: string) => `mx-${date}-${origin}-${dest}`;

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function AvailabilityMatrix({ snapshot, projected, sort, selected, onToggle, now, locale, onOpen }: AvailabilityMatrixProps) {
  const t = RESULTS[locale];
  const id = useId();
  const model = useMemo(() => matrixModel(snapshot, projected), [snapshot, projected]);
  const rowOf = useMemo(() => new Map(projected.rows.map((r) => [r.key, r.value])), [projected.rows]);
  // The opened cell belongs to the snapshot it was opened on: a new snapshot closes it in the same render.
  const [opened, setOpened] = useState<{ at: MatrixPoint; snapshotId: string } | null>(null);
  const open = opened && opened.snapshotId === snapshot.id ? opened.at : null;
  const setOpen = (at: MatrixPoint | null) => setOpened(at ? { at, snapshotId: snapshot.id } : null);
  const panelHeading = useRef<HTMLHeadingElement>(null);

  const openCell = (at: MatrixPoint) => {
    const cell = model.cells[at.row]?.[at.col];
    if (!cell || !cell.slots.some((s) => s.state === "results")) return;
    // One option: straight to its details (Esc there comes back to this cell). More: the cell's options below.
    const keys = cell.slots.flatMap((s) => s.rowKeys);
    if (keys.length === 1 && onOpen) {
      onOpen(keys[0]!, cellId(cell.date, cell.origin, cell.dest));
      return;
    }
    setOpen(at);
    window.requestAnimationFrame(() => panelHeading.current?.focus());
  };
  const focus = useMatrixFocus(model.dates.length, model.routes.length, openCell);

  // A new search keeps the matrix (no remount): the active coordinate is clamped to the new grid, an opened cell's
  // options close (they were the old snapshot's), and focus that was in the matrix comes back to the active cell.
  const wrap = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLTableElement>(null);
  const focusInside = useRef(false);
  const focusActive = focus.focusActive;
  useEffect(() => {
    // Focus that was in the matrix but is no longer on a cell of the grid (it was in the old snapshot's options, now
    // closed, or on a cell the new grid dropped) comes back to the active cell.
    if (focusInside.current && !grid.current?.contains(document.activeElement)) focusActive();
    // Only a new snapshot does this; focusActive changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.id]);

  // Whole columns: measured on the content box (inside the 16 pt gutters), as docs/04 asks, at the current text scale.
  const [box, setBox] = useState({ width: 358, scale: 1 });
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => {
      const style = getComputedStyle(el);
      const width = el.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
      const scale = Number.parseFloat(style.getPropertyValue("--ag-text-scale")) || 1;
      setBox((b) => (b.width === width && b.scale === scale ? b : { width, scale }));
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, []);
  const columns = mobileColumns(box.width, model.routes.length, box.scale);

  const complete = projected.coverage.state === "complete";
  const caption = complete ? t.matrixCaption : `${copy("result.min_partial", locale)} · ${t.matrixCaption}`;
  const openCellModel = open ? model.cells[open.row]?.[open.col] : undefined;
  const openRows = openCellModel ? sortRows(projected.rows.filter((r) => openCellModel.slots.some((s) => s.rowKeys.includes(r.key))), sort) : [];

  const slot = (s: MatrixSlot) => {
    const row = s.best ? rowOf.get(s.best) : undefined;
    if (s.state === "results" && row) {
      // The frame and tick belong to the option the slot shows; another selected option of the slot is said in words.
      const shownSelected = selected.has(s.best!);
      const others = s.rowKeys.filter((k) => k !== s.best && selected.has(k)).length;
      return (
        <div key={s.cabin} className="ag-mx-slot" data-state="results" data-selected={shownSelected || undefined}>
          <span className="ag-mx-line">
            <span className="ag-mx-miles">{formatMiles(row.miles)}</span>
            <span className="ag-mx-cabin">{s.cabin}</span>
            {shownSelected ? <span className="ag-mx-tick">✓</span> : null}
          </span>
          <span className="ag-mx-meta">
            <span className="ag-mx-program">{programShortLabel(row.program)}</span>
            <span className="ag-mx-seats">{seatsLabel(row.seats_left, locale)}</span>
          </span>
          {others > 0 ? <span className="ag-mx-others">{t.othersSelected(others)}</span> : null}
        </div>
      );
    }
    const kind = s.state === "results" ? "unknown" : s.state;
    return (
      <div key={s.cabin} className="ag-mx-slot" data-state={kind}>
        {/* One line where it fits: the dash is never alone, its reason is beside it. */}
        <span className="ag-mx-line ag-mx-empty">
          <span className="ag-mx-empty-mark">—</span>
          <span className="ag-mx-cabin">{s.cabin}</span>
          <span className="ag-mx-reason">{capitalise(emptyDayLabel(kind, locale))}</span>
        </span>
      </div>
    );
  };

  return (
    <div
      className="ag-mx"
      data-testid="matrix-view"
      ref={wrap}
      onFocus={() => {
        focusInside.current = true;
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) focusInside.current = false;
      }}
    >
      <p className="ag-mx-caption" id={`${id}-caption`}>
        {caption}
      </p>
      <div className="ag-mx-scroll" style={{ "--mx-col": `${columns.width}px`, "--mx-date": `${columns.date}px` } as CSSProperties}>
        {/* The grid itself is focusable only to hand focus to its active cell: one tab stop, on a cell. */}
        <table
          ref={grid}
          role="grid"
          className="ag-mx-grid"
          aria-labelledby={`${id}-caption`}
          aria-rowcount={model.dates.length + 1}
          aria-colcount={model.routes.length + 1}
          tabIndex={-1}
          onFocus={(e) => {
            if (e.target === e.currentTarget) focus.focusActive();
          }}
          // A tap on a date, a route or the corner must not focus the grid (which would jump to the active cell).
          onMouseDown={(e) => {
            if (!(e.target as Element).closest("[role=gridcell]")) e.preventDefault();
          }}
          onKeyDown={focus.onKeyDown}
        >
          <thead>
            <tr role="row" aria-rowindex={1}>
              <th role="columnheader" aria-colindex={1} className="ag-mx-corner" scope="col">
                {t.matrixDate}
              </th>
              {model.routes.map((r, c) => (
                <th key={`${r.origin}-${r.dest}`} role="columnheader" aria-colindex={c + 2} className="ag-mx-route" scope="col">
                  {r.origin} → {r.dest}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.dates.map((date, r) => {
              const parts = dayParts(date, locale);
              return (
                <tr key={date} role="row" aria-rowindex={r + 2} data-cabins={model.cabins.length}>
                  <th role="rowheader" aria-colindex={1} className="ag-mx-date" scope="row">
                    <span className="ag-mx-date-day">{parts.date}</span>
                    <span className="ag-mx-date-week">{parts.weekday}</span>
                  </th>
                  {model.cells[r]!.map((cell, c) => {
                    const at = { row: r, col: c };
                    const isActive = focus.active.row === r && focus.active.col === c;
                    return (
                      <td
                        key={`${cell.origin}-${cell.dest}`}
                        ref={focus.cellRef(at)}
                        id={cellId(cell.date, cell.origin, cell.dest)}
                        role="gridcell"
                        aria-colindex={c + 2}
                        aria-label={matrixCellName(cell, rowOf, locale, selected)}
                        // Only a cell with several options expands; a one-option cell opens that option's details.
                        aria-expanded={cell.slots.reduce((n, s) => n + s.rowKeys.length, 0) > 1 || !onOpen ? (cell.slots.some((s) => s.state === "results") ? open?.row === r && open.col === c : undefined) : undefined}
                        tabIndex={isActive ? 0 : -1}
                        className="ag-mx-cell"
                        data-date={date}
                        data-route={`${cell.origin}-${cell.dest}`}
                        onFocus={() => {
                          if (!isActive) focus.setActive(at);
                        }}
                        onClick={() => {
                          focus.setActive(at);
                          openCell(at);
                        }}
                      >
                        {cell.slots.map(slot)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="ag-mx-hint">{t.matrixKeys}</p>

      {open && openCellModel && openRows.length > 0 ? (
        <section
          className="ag-cal-panel"
          aria-labelledby={`${id}-cell`}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            const back = open;
            setOpen(null);
            window.requestAnimationFrame(() => focus.focusActive(back));
          }}
        >
          <h2 className="ag-cal-day-title" id={`${id}-cell`} tabIndex={-1} ref={panelHeading}>
            {t.cellHeading(dayLabel(openCellModel.date, locale), `${openCellModel.origin} → ${openCellModel.dest}`, openRows.length)}
          </h2>
          <AvailabilityList
            rows={openRows}
            sort={sort}
            snapshotId={snapshot.id}
            selected={selected}
            onToggle={onToggle}
            now={now}
            locale={locale}
            headingLevel={3}
            testId="matrix-cell-list"
            onOpen={onOpen}
          />
        </section>
      ) : null}
    </div>
  );
}
