"use client";

/**
 * The last run's new / dropped cells, drawn with the REAL grid cell (src/components/grid/cell.tsx)
 * so the anatomy, the cabin tag and the freshness mark are the ones the user already read on the
 * grid — spec §4. Each cell is its own one-cell grid, because a diff has no row or column
 * headers to sit under; the route and date the grid would have shown in those headers are the
 * caption underneath, and a dropped cell carries a muted "dropped" tag beside it.
 *
 * The rows come from `query_runs.cells_json`, which stores miles, fees, seats and freshness but
 * not the currency, the airlines or the booking link — the cell renders what is there and
 * invents nothing.
 *
 * Three kinds, because the scheduler notifies on three: new cells, dropped cells, and cells
 * that got cheaper. A price drop shows the cell at its NEW price with "−12% from 70,000"
 * beside the route and date, so the fall is readable without a second cell.
 */
import { Cell } from "@/components/grid/cell";
import { useDensity } from "@/components/grid/use-roving-grid";
import { formatRowDate } from "@awardgrid/core/grid/format";
import type { AvailabilityRow } from "@awardgrid/core/grid/types";
import { useLocale, useT } from "@awardgrid/core/i18n/client";
import { diffGridCell } from "@/components/queries/format";
import "@/components/grid/grid-styles.css";

export interface DiffCellsProps {
  /** Section heading, e.g. "New cells". */
  title: string;
  rows: readonly AvailabilityRow[];
  /** Dropped cells are tagged; new cells are shown as the grid shows them. */
  kind: "new" | "dropped" | "price_drop";
  /** Optional caption tag per row, by index (price drops: "−12% from 70,000"). */
  tags?: readonly string[];
  /** "Now" in ms, for the freshness mark and the age text. */
  now: number;
}

const noop = () => undefined;

export function DiffCells({ title, rows, kind, tags, now }: DiffCellsProps) {
  const t = useT();
  const locale = useLocale();
  const density = useDensity();
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-1" data-testid={`diff-${kind}`}>
      <p className="aq-section-title">{title}</p>
      <ul className="aq-diff-list">
        {rows.map((row, index) => {
          const cell = diffGridCell(row);
          const tag = kind === "dropped" ? t("saved.diff.dropped_tag") : tags?.[index];
          return (
            <li key={`${row.program}-${row.origin}-${row.dest}-${row.date}-${row.cabin}`} className="aq-diff-item" data-kind={kind}>
              <div className="ag-wrap" data-density={density}>
                <table className="ag-table" role="grid" aria-label={title}>
                  <tbody role="rowgroup">
                    <tr role="row">
                      <Cell
                        cell={cell}
                        status="ok"
                        now={now}
                        density={density}
                        showCabinTag
                        cabins={[row.cabin]}
                        row={0}
                        col={0}
                        tabbable={false}
                        selected={false}
                        t={t}
                        locale={locale}
                        register={noop}
                        onActivate={noop}
                        onFocusCell={noop}
                        onHover={noop}
                      />
                    </tr>
                  </tbody>
                </table>
              </div>
              <span className="aq-diff-caption">
                <span>{t("grid.drawer.route", { origin: row.origin, dest: row.dest })}</span>
                <span>{formatRowDate(row.date, locale)}</span>
                {tag !== undefined && <span className="aq-dropped-tag">{tag}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
