"use client";
/**
 * The Web matrix (UI/UX v1 T19; spec §17; reference desktop-matrix.png for its states, never its data): the search's
 * dates down, its routes across, from core's matrixModel over the same projection as the list and calendar.
 *
 *   - Each cell holds one slot per cabin asked, labelled with its cabin, so no number mixes cabins. A slot shows its
 *     lowest miles in full, the program and the seats; an empty slot says why in words (no matches, not checked to the
 *     end, coverage unknown, not monitored, hidden by the view filter), never a bare dash.
 *   - A keyboard grid: one tab stop; arrows, Home/End, Ctrl/Cmd+Home/End move; Enter or Space opens. One option
 *     opens its details; several are listed under the matrix, and Esc there returns to the cell.
 *   - The date column and header stay put while the routes scroll sideways inside the matrix, never the page.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useLocale, useT } from "@awardgrid/core/i18n/client";
import type { QueryObject } from "@awardgrid/core/query/schema";
import { matrixModel } from "@awardgrid/core/workspace/projection";
import { dayParts, emptyDayLabel, formatMiles, matrixCellName, programShortLabel, seatsLabel } from "@awardgrid/core/workspace/present";
import { cabinName } from "@awardgrid/core/workspace/query-editor";
import type { EmptyKind, ProjectedResults, ResultSnapshot } from "@awardgrid/core/workspace/types";
import { useFinePointer } from "@/components/grid/use-roving-grid";
import { ListView, type OptionActions } from "./list-view";

export interface MatrixViewProps extends OptionActions {
  snapshot: ResultSnapshot;
  projected: ProjectedResults;
  sort: QueryObject["sort_by"];
  now: string;
  onSort: (sort: QueryObject["sort_by"]) => void;
}

interface Point {
  row: number;
  col: number;
}

const cellDomId = (snapshotId: string, date: string, origin: string, dest: string) => `mx-${snapshotId}-${date}-${origin}-${dest}`.replace(/[^A-Za-z0-9_-]/g, "_");

export function MatrixView({ snapshot, projected, sort, now, onSort, ...actions }: MatrixViewProps) {
  const t = useT();
  const locale = useLocale();
  const fine = useFinePointer();
  const model = useMemo(() => matrixModel(snapshot, projected), [snapshot, projected]);
  const rowOf = useMemo(() => new Map(projected.rows.map((r) => [r.key, r.value])), [projected.rows]);
  const [active, setActive] = useState<Point>({ row: 0, col: 0 });
  // The cell whose options are listed below, on the snapshot it was opened on.
  const [opened, setOpened] = useState<{ at: Point; snapshotId: string } | null>(null);
  const open = opened && opened.snapshotId === snapshot.id ? opened.at : null;
  const optionsHeading = useRef<HTMLHeadingElement>(null);
  // Focus moves to the listed options' heading once they are drawn (not a frame later, where a key could slip past).
  const [focusOptions, setFocusOptions] = useState(0);
  useEffect(() => {
    if (focusOptions) optionsHeading.current?.focus();
  }, [focusOptions]);

  const rows = model.dates.length;
  const cols = model.routes.length;
  const at = { row: Math.min(active.row, Math.max(rows - 1, 0)), col: Math.min(active.col, Math.max(cols - 1, 0)) };
  const cellAt = (p: Point) => model.cells[p.row]?.[p.col];
  const focusCell = (p: Point) => {
    const cell = cellAt(p);
    if (!cell) return;
    setActive(p);
    document.getElementById(cellDomId(snapshot.id, cell.date, cell.origin, cell.dest))?.focus();
  };

  const activate = (p: Point) => {
    const cell = cellAt(p);
    if (!cell) return;
    setActive(p);
    const keys = cell.slots.flatMap((s) => s.rowKeys);
    if (keys.length === 0) return;
    if (keys.length === 1) {
      actions.onOpen(keys[0]!, document.getElementById(cellDomId(snapshot.id, cell.date, cell.origin, cell.dest)) ?? undefined);
      return;
    }
    setOpened({ at: p, snapshotId: snapshot.id });
    setFocusOptions((n) => n + 1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, p: Point) => {
    if (event.nativeEvent.isComposing) return;
    const mod = event.ctrlKey || event.metaKey;
    let next: Point | null = null;
    switch (event.key) {
      case "ArrowRight":
        next = { row: p.row, col: Math.min(p.col + 1, cols - 1) };
        break;
      case "ArrowLeft":
        next = { row: p.row, col: Math.max(p.col - 1, 0) };
        break;
      case "ArrowDown":
        next = { row: Math.min(p.row + 1, rows - 1), col: p.col };
        break;
      case "ArrowUp":
        next = { row: Math.max(p.row - 1, 0), col: p.col };
        break;
      case "Home":
        next = mod ? { row: 0, col: 0 } : { row: p.row, col: 0 };
        break;
      case "End":
        next = mod ? { row: rows - 1, col: cols - 1 } : { row: p.row, col: cols - 1 };
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        activate(p);
        return;
      default:
        return;
    }
    event.preventDefault();
    focusCell(next);
  };

  const openCell = open ? cellAt(open) : undefined;
  const openKeys = openCell ? new Set(openCell.slots.flatMap((s) => s.rowKeys)) : null;
  const openRows = openKeys ? projected.rows.filter((r) => openKeys.has(r.key)) : [];
  const openName = openCell ? matrixCellName(openCell, rowOf, locale) : "";

  return (
    <div className="ag-ws-matrix" data-testid="matrix-view">
      <div className="ag-ws-matrix-scroll">
        <table role="grid" className="ag-ws-matrix-table" aria-rowcount={rows + 1} aria-colcount={cols + 1} aria-describedby="ag-ws-matrix-caption">
          <thead>
            <tr role="row" aria-rowindex={1}>
              <th scope="col" role="columnheader" aria-colindex={1} className="ag-ws-mx-date ag-ws-mx-head">
                {t("workspace.matrix_date")}
              </th>
              {model.routes.map((route, c) => (
                <th key={`${route.origin}-${route.dest}`} scope="col" role="columnheader" aria-colindex={c + 2} className="ag-ws-mx-head">
                  {route.origin} → {route.dest}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.cells.map((line, r) => {
              const parts = dayParts(model.dates[r]!, locale);
              return (
                <tr key={model.dates[r]} role="row" aria-rowindex={r + 2}>
                  <th scope="row" role="rowheader" aria-colindex={1} className="ag-ws-mx-date">
                    <span className="ag-ws-mx-day tabular">{parts.date}</span>
                    <span className="ag-ws-sub">{parts.weekday}</span>
                  </th>
                  {line.map((cell, c) => {
                    const here = at.row === r && at.col === c;
                    const hasResults = cell.slots.some((s) => s.state === "results");
                    const empty = cell.slots.every((s) => s.state !== "results");
                    const tone = empty ? (cell.slots.find((s) => s.state !== "complete")?.state ?? "complete") : "results";
                    return (
                      <td
                        key={`${cell.origin}-${cell.dest}`}
                        id={cellDomId(snapshot.id, cell.date, cell.origin, cell.dest)}
                        role="gridcell"
                        aria-colindex={c + 2}
                        tabIndex={here ? 0 : -1}
                        aria-label={matrixCellName(cell, rowOf, locale)}
                        aria-selected={open ? open.row === r && open.col === c : undefined}
                        className="ag-ws-mx-cell"
                        data-state={tone}
                        data-has-results={hasResults || undefined}
                        onClick={() => activate({ row: r, col: c })}
                        onFocus={() => setActive({ row: r, col: c })}
                        onKeyDown={(e) => onKeyDown(e, { row: r, col: c })}
                      >
                        {cell.slots.map((slot) => {
                          const best = slot.best ? rowOf.get(slot.best) : undefined;
                          return (
                            <span key={slot.cabin} className="ag-ws-mx-slot" data-state={slot.state} aria-hidden>
                              {best ? (
                                <>
                                  <span className="ag-ws-mx-miles tabular">
                                    {formatMiles(best.miles)} <span className="ag-ws-mx-cabin">{cabinName(slot.cabin, locale)}</span>
                                  </span>
                                  <span className="ag-ws-sub">
                                    {programShortLabel(best.program)} · {seatsLabel(best.seats_left, locale)}
                                  </span>
                                </>
                              ) : (
                                <span className="ag-ws-mx-empty">
                                  {model.cabins.length > 1 ? `${cabinName(slot.cabin, locale)} ` : ""}
                                  {emptyDayLabel(slot.state as EmptyKind, locale)}
                                </span>
                              )}
                            </span>
                          );
                        })}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p id="ag-ws-matrix-caption" className="ag-ws-hint">
        {t("workspace.matrix_caption")}
        {fine ? ` ${t("workspace.matrix_keys")}` : ""}
      </p>
      {open && openCell ? (
        <section
          className="ag-ws-cell-options"
          aria-labelledby="ag-ws-cell-options-title"
          onKeyDown={(e) => {
            if (e.key !== "Escape" || e.defaultPrevented || e.nativeEvent.isComposing) return;
            e.preventDefault();
            setOpened(null);
            focusCell(open);
          }}
        >
          <h2 id="ag-ws-cell-options-title" ref={optionsHeading} tabIndex={-1} className="ag-ws-section-title">
            {t("workspace.matrix_options", { name: openName })}
          </h2>
          <ListView snapshot={snapshot} rows={openRows} sort={sort} now={now} onSort={onSort} label={t("workspace.matrix_options", { name: openName })} testId="matrix-cell-options" {...actions} />
        </section>
      ) : null}
    </div>
  );
}
