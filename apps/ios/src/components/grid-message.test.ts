/**
 * When the grid is replaced by one sentence, and which sentence (`emptyGridMessage`), plus the label
 * each empty cell carries when the table does render.
 *
 * Every grid comes from the core's own `buildGrid` with the options search.ts passes, so the cell
 * statuses are the ones a real search produces. No DOM: the one render goes through react-dom/server,
 * with `now` injected so nothing depends on when it runs.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildGrid } from "@awardgrid/core/grid/pivot";
import type { AvailabilityRow } from "@awardgrid/core/grid/types";
import { QueryObject } from "@awardgrid/core/query/schema";
import { GridTable, emptyGridMessage } from "./GridTable";

const NOW = new Date("2026-10-01T12:00:00.000Z");

/** Two dates to one destination, so every pair is two cells. */
function query(origins: string[]): QueryObject {
  return QueryObject.parse({
    origins,
    destinations: ["SEA"],
    date_from: "2026-10-05",
    date_to: "2026-10-06",
    cabins: ["J"],
    raw_text: "test",
    language: "en",
  });
}

/** HKG to SEA on the first date only. */
const ROW: AvailabilityRow = {
  program: "alaska",
  origin: "HKG",
  dest: "SEA",
  date: "2026-10-05",
  cabin: "J",
  miles: 80_000,
  fees_cents: null,
  currency: null,
  seats_left: 2,
  direct: true,
  airlines: ["AS"],
  computed_last_seen: "2026-10-01T11:00:00.000Z",
  source_id: "id-1",
  booking_url: null,
  fetched_at: "2026-10-01T11:00:00.000Z",
};

describe("emptyGridMessage", () => {
  it("keeps the no-availability sentence when every cell was checked and had nothing", () => {
    const grid = buildGrid([], query(["HKG", "PVG"]), { now: NOW });
    expect(emptyGridMessage(grid)).toBe(
      "No availability for that query. The call worked — this route and date window simply has nothing cached at seats.aero right now.",
    );
  });

  it("says seats.aero does not monitor the routes when no pair is monitored", () => {
    const grid = buildGrid([], query(["HKG", "PVG"]), {
      now: NOW,
      unmonitored_pairs: [
        { origin: "HKG", dest: "SEA" },
        { origin: "PVG", dest: "SEA" },
      ],
    });
    expect(emptyGridMessage(grid)).toBe("Nothing to show for this query. seats.aero does not monitor these routes for the programs searched.");
  });

  it("returns null whenever the cells say different things, so the table renders with its labels", () => {
    const q = query(["HKG", "PVG"]);
    const grids = {
      "some rows": buildGrid([ROW], q, { now: NOW }),
      "unmonitored beside checked-and-empty": buildGrid([], q, { now: NOW, unmonitored_pairs: [{ origin: "PVG", dest: "SEA" }] }),
      // A pull that stopped early has not shown there is nothing: it must not get either sentence.
      "nothing fetched": buildGrid([], q, {
        now: NOW,
        not_fetched_pairs: ["HKG", "PVG"].map((origin) => ({ pair: { origin, dest: "SEA" }, reason: "grid.cell.not_fetched" })),
      }),
    };
    for (const [name, grid] of Object.entries(grids)) expect(emptyGridMessage(grid), name).toBeNull();
  });
});

describe("GridTable", () => {
  it("labels each empty cell with its own fact: checked and empty, not checked, not monitored", () => {
    const grid = buildGrid([ROW], query(["HKG", "PVG", "ICN"]), {
      now: NOW,
      unmonitored_pairs: [{ origin: "ICN", dest: "SEA" }],
      not_fetched_pairs: [{ pair: { origin: "PVG", dest: "SEA" }, reason: "grid.cell.not_fetched" }],
    });
    const html = renderToStaticMarkup(createElement(GridTable, { grid, now: NOW }));
    const count = (label: string) => html.split(`<span class="none">${label}</span>`).length - 1;
    // HKG has a row on one date and nothing on the other; PVG and ICN have two empty cells each.
    expect([count("—"), count("not checked"), count("not monitored")]).toEqual([1, 2, 2]);
  });
});
