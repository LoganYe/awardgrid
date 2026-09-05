import { describe, expect, it } from "vitest";
import { NOW, makeQuery, makeRow } from "../../../test/fixtures/grid/rows";
import {
  buildGrid,
  cellAt,
  enumerateDates,
  enumeratePairs,
  gridStats,
  transposeGrid,
} from "@/lib/grid/pivot";

describe("enumerateDates", () => {
  it("is inclusive and crosses a month boundary", () => {
    expect(enumerateDates("2026-10-30", "2026-11-02")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
  });

  it("is timezone-independent across both US DST changes", () => {
    // vitest pins TZ=UTC, where a naive local-time loop would also pass. Node re-reads TZ at
    // runtime, so exercise a DST zone explicitly and restore it afterwards.
    const saved = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      // spring forward (2026-03-08 has 23 hours): still 4 distinct days
      expect(enumerateDates("2026-03-07", "2026-03-10")).toEqual(["2026-03-07", "2026-03-08", "2026-03-09", "2026-03-10"]);
      // fall back (2026-11-01 has 25 hours): no duplicated day
      expect(enumerateDates("2026-11-01", "2026-11-03")).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  });

  it("single day and reversed range", () => {
    expect(enumerateDates("2026-02-28", "2026-02-28")).toEqual(["2026-02-28"]);
    expect(enumerateDates("2026-02-28", "2026-02-27")).toEqual([]);
    expect(() => enumerateDates("2026/02/28", "2026-02-28")).toThrow();
  });
});

describe("enumeratePairs", () => {
  it("is origins × destinations in query order", () => {
    expect(
      enumeratePairs({ origins: ["HKG", "PVG"], destinations: ["SEA", "SFO"] }).map((p) => p.key),
    ).toEqual(["HKG-SEA", "HKG-SFO", "PVG-SEA", "PVG-SFO"]);
  });
});

describe("buildGrid", () => {
  const alaska = makeRow({ program: "alaska", miles: 80_000, fees_cents: 5_600 });
  const american = makeRow({ program: "american", miles: 70_000, fees_cents: 30_000, cabin: "F" });
  const united = makeRow({ program: "united", miles: 70_000, fees_cents: 1_000, direct: false });
  const day2 = makeRow({
    program: "aeroplan",
    date: "2026-10-16",
    miles: 55_000,
    computed_last_seen: "2026-10-01T06:00:00.000Z",
  });
  const economy = makeRow({ program: "delta", cabin: "Y", miles: 20_000 });
  const rows = [alaska, american, united, day2, economy];

  it("picks the best across programs per sort_by and keeps every row in `all`", () => {
    const grid = buildGrid(rows, makeQuery(), { now: NOW });
    expect(grid.rows).toEqual(["2026-10-15", "2026-10-16"]);
    expect(grid.cols).toEqual(["HKG-SEA"]);
    const cell = cellAt(grid, "HKG-SEA", "2026-10-15");
    expect(cell?.status).toBe("ok");
    expect(cell?.best?.program).toBe("united"); // 70k + $10 beats 70k + $300 and 80k
    expect(cell?.all.map((r) => r.program)).toEqual(["united", "american", "alaska"]);
    expect(cellAt(grid, "HKG-SEA", "2026-10-16")?.best).toBe(day2);
  });

  it("filters by cabin", () => {
    const grid = buildGrid(rows, makeQuery({ cabins: ["Y"] }), { now: NOW });
    expect(cellAt(grid, "HKG-SEA", "2026-10-15")?.all).toEqual([economy]);
    const firstOnly = buildGrid(rows, makeQuery({ cabins: ["F"] }), { now: NOW });
    expect(cellAt(firstOnly, "HKG-SEA", "2026-10-15")?.best).toBe(american);
  });

  it("filters by programs when set", () => {
    const grid = buildGrid(rows, makeQuery({ programs: ["alaska"] }), { now: NOW });
    expect(cellAt(grid, "HKG-SEA", "2026-10-15")?.all).toEqual([alaska]);
    expect(cellAt(grid, "HKG-SEA", "2026-10-16")?.status).toBe("none");
  });

  it("filters by max_miles (inclusive) and direct_only", () => {
    const capped = buildGrid(rows, makeQuery({ max_miles: 70_000 }), { now: NOW });
    expect(cellAt(capped, "HKG-SEA", "2026-10-15")?.all.map((r) => r.program)).toEqual([
      "united",
      "american",
    ]);
    const direct = buildGrid(rows, makeQuery({ direct_only: true }), { now: NOW });
    expect(cellAt(direct, "HKG-SEA", "2026-10-15")?.best?.program).toBe("american");
  });

  it("ignores rows outside the queried pairs and dates", () => {
    const stray = [makeRow({ origin: "PVG" }), makeRow({ date: "2026-10-17" })];
    const grid = buildGrid(stray, makeQuery(), { now: NOW });
    expect(gridStats(grid).ok_cells).toBe(0);
  });

  it("marks unmonitored pairs and lists them in meta", () => {
    const q = makeQuery({ origins: ["HKG", "PVG"] });
    const grid = buildGrid(rows, q, {
      now: NOW,
      unmonitored_pairs: [{ origin: "PVG", dest: "SEA" }],
    });
    expect(cellAt(grid, "PVG-SEA", "2026-10-15")?.status).toBe("unmonitored");
    expect(cellAt(grid, "HKG-SEA", "2026-10-15")?.status).toBe("ok");
    expect(grid.meta.unmonitored_pairs).toEqual([{ origin: "PVG", dest: "SEA", key: "PVG-SEA" }]);
  });

  it("fills meta", () => {
    const grid = buildGrid(rows, makeQuery(), {
      now: NOW,
      api_calls_used: 3,
      served_from_cache: true,
    });
    expect(grid.meta.generated_at).toBe(NOW);
    expect(grid.meta.api_calls_used).toBe(3);
    expect(grid.meta.served_from_cache).toBe(true);
    expect(grid.meta.oldest_seen).toBe("2026-10-01T06:00:00.000Z");
    expect(grid.meta.newest_seen).toBe("2026-10-01T10:00:00.000Z");
    const empty = buildGrid([], makeQuery(), { now: NOW });
    expect(empty.meta.oldest_seen).toBeNull();
    expect(empty.meta.api_calls_used).toBe(0);
  });

  it("orientation routes = transpose; cellAt works in both", () => {
    const q = makeQuery({ origins: ["HKG", "PVG"] });
    const dates = buildGrid(rows, q, { now: NOW });
    const routes = buildGrid(rows, q, { now: NOW, orientation: "routes" });
    expect(routes.orientation).toBe("routes");
    expect(routes.rows).toEqual(["HKG-SEA", "PVG-SEA"]);
    expect(routes.cols).toEqual(["2026-10-15", "2026-10-16"]);
    expect(routes.cells[0]?.[1]).toEqual(dates.cells[1]?.[0]);
    expect(cellAt(routes, "HKG-SEA", "2026-10-16")).toEqual(cellAt(dates, "HKG-SEA", "2026-10-16"));
    // transposing shares cell objects rather than copying them
    const back = transposeGrid(routes);
    expect(back.orientation).toBe("dates");
    expect(back.cells).toEqual(dates.cells);
    expect(back.cells[1]?.[0]).toBe(routes.cells[0]?.[1]);
    expect(cellAt(dates, "NOPE-SEA", "2026-10-16")).toBeUndefined();
  });
});

describe("gridStats", () => {
  it("counts statuses and finds the cheapest cell", () => {
    const q = makeQuery({ origins: ["HKG", "PVG"] });
    const rows = [makeRow({ miles: 90_000 }), makeRow({ miles: 45_000, date: "2026-10-16" })];
    const grid = buildGrid(rows, q, {
      now: NOW,
      unmonitored_pairs: [{ origin: "PVG", dest: "SEA" }],
    });
    const stats = gridStats(grid);
    expect(stats.total_cells).toBe(4);
    expect(stats.ok_cells).toBe(2);
    expect(stats.unmonitored_cells).toBe(2);
    expect(stats.none_cells).toBe(0);
    expect(stats.cheapest?.date).toBe("2026-10-16");
    expect(stats.cheapest?.best?.miles).toBe(45_000);
    expect(gridStats(buildGrid([], q, { now: NOW })).cheapest).toBeNull();
  });
});
