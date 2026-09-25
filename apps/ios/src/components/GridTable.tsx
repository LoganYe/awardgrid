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
    // Checked and empty, never fetched, and not tracked by seats.aero are three different facts and
    // must not look the same. "not monitored" comes from runFind's Get Routes check
    // (packages/core/src/lib/seatsaero/find.ts:360-377); "not checked" from a pull that stopped
    // early (seatsaero/not-fetched.ts).
    const label = cell.status === "not_fetched" ? "not checked" : cell.status === "unmonitored" ? "not monitored" : "—";
    return <span className="none">{label}</span>;
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

/**
 * The sentence shown INSTEAD of the table, or null when the table should render. Exported so the
 * cases are tested without a DOM (grid-message.test.ts).
 *
 *   every cell `none`         the call worked and seats.aero has nothing cached for this window
 *   every cell `unmonitored`  seats.aero tracks none of these pairs for the programs asked, so "no
 *                             availability" would state the wrong fact
 *   anything else             null. A mix of states, or a pull that did not reach every pair, has to
 *                             show which cell is which, so the table renders with its per-cell labels.
 */
export function emptyGridMessage(grid: Grid, opts: { saved?: boolean } = {}): string | null {
  const cells = grid.cells.flat();
  if (cells.every((c) => c.status === "none")) {
    // A saved snapshot shown again says what was true when it was fetched, not "right now".
    return opts.saved
      ? "No availability in these saved results. When they were fetched, the call worked and seats.aero had nothing cached for this route and date window."
      : "No availability for that query. The call worked — this route and date window simply has nothing cached at seats.aero right now.";
  }
  if (cells.every((c) => c.status === "unmonitored")) {
    return "Nothing to show for this query. seats.aero does not monitor these routes for the programs searched.";
  }
  return null;
}

export function GridTable({ grid, now = new Date(), saved = false }: { grid: Grid; now?: Date; saved?: boolean }) {
  const message = emptyGridMessage(grid, { saved });

  if (message) {
    return (
      <p className="ag-surface" style={{ margin: 0 }}>
        {message}
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
