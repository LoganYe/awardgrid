/**
 * The grid, rendered flat.
 *
 * This is a phone-sized reading of `Grid` from `@awardgrid/core/grid/types` — not yet the web
 * app's virtualised component (PIVOT §6 leaves the full port for later; `src/search/search.ts`
 * keeps the `ApiResult` shape so it stays a small diff). What it does adopt now is the design
 * decision Phase 3 is actually about:
 *
 *   restful.dowhiz.com's two data components switch the glass off — no blur, no shadow, 1px
 *   hairlines, horizontal scroll. That is the instinct PIVOT §4 says to copy, and it is why this
 *   table sits inside `[data-surface="flat"]` even when the screen around it is rich. Blur behind
 *   a column of mileage numbers costs legibility and buys nothing.
 *
 * The sticky route column and the horizontal scroll are the phone answer to a wide table: the
 * TABLE scrolls sideways, the page never does.
 */
import type { Grid, GridCell } from "@awardgrid/core/grid/types";
import { tier as freshnessTier } from "@awardgrid/core/grid/freshness";

/** fresh < 2 h · aging 2-6 h · stale > 6 h. The palette has a token per tier. */
const TIER_CLASS: Record<string, string> = {
  fresh: "ag-fresh",
  aging: "ag-aging",
  stale: "ag-stale",
  unknown: "meta",
};

function Cell({ cell, now }: { cell: GridCell; now: Date }) {
  const best = cell.best;
  if (!best) {
    // An empty cell and an unfetched one are different facts and must not look the same.
    return <span className="none">{cell.status === "not_fetched" ? "not checked" : "—"}</span>;
  }
  const tier = freshnessTier(best.fetched_at, now);
  return (
    <>
      <span className="miles">{Number(best.miles).toLocaleString()}</span>
      <span className={`meta ${TIER_CLASS[tier] ?? ""}`}>
        {best.program}
        {best.seats_left ? ` · ${best.seats_left}` : ""}
      </span>
    </>
  );
}

export function GridTable({ grid, now = new Date() }: { grid: Grid; now?: Date }) {
  const hasAny = grid.cells.some((row) => row.some((c) => c.best));

  if (!hasAny) {
    return (
      <p className="ag-surface" style={{ margin: 0 }}>
        No availability for that query. The call worked — this route and date window simply has
        nothing cached at seats.aero right now.
      </p>
    );
  }

  return (
    <div className="ag-scroll" data-surface="flat">
      <table className="ag-grid">
        <caption className="sr-only">
          Award availability by route and date. Data: seats.aero.
        </caption>
        <thead>
          <tr>
            <th scope="col">{grid.orientation === "dates" ? "Date" : "Route"}</th>
            {grid.cols.map((col) => (
              <th key={col} scope="col">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((rowLabel, r) => (
            <tr key={rowLabel}>
              <th scope="row">{rowLabel}</th>
              {grid.cols.map((col, c) => (
                <td key={col}>
                  <Cell cell={grid.cells[r]![c]!} now={now} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
