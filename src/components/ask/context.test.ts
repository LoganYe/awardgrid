import { describe, expect, it } from "vitest";
import { QueryObject } from "@/lib/query/schema";
import type { GridCell } from "@/lib/grid/types";
import { addToolName, buildAskContext, cellContextFromCell, formatUsd, summarizeCell, summarizeQuery } from "./context";

const query = QueryObject.parse({
  origins: ["HKG", "PVG"],
  destinations: ["SEA"],
  date_from: "2026-10-01",
  date_to: "2026-10-30",
  cabins: ["F"],
  direct_only: true,
  raw_text: "x",
  language: "en",
});

const cell: GridCell = {
  origin: "SEA",
  dest: "NRT",
  date: "2026-10-15",
  status: "ok",
  best: {
    program: "american",
    origin: "SEA",
    dest: "NRT",
    date: "2026-10-15",
    cabin: "F",
    miles: 80000,
    fees_cents: 1250,
    currency: "USD",
    seats_left: 2,
    direct: true,
    airlines: ["JL"],
    computed_last_seen: "2026-09-06T00:00:00Z",
    source_id: "abc",
    booking_url: "https://example.invalid/secret-link",
    fetched_at: "2026-09-06T00:00:00Z",
  },
  all: [],
};

describe("ask context helpers", () => {
  it("summarizes the query and cell on one line each", () => {
    expect(summarizeQuery(query)).toBe("HKG,PVG → SEA · 2026-10-01..2026-10-30 · F · direct");
    expect(summarizeCell(cellContextFromCell(cell)!)).toBe("SEA→NRT 2026-10-15 F · 80,000 mi · $13 · 2 seats · american");
  });

  it("sends only the documented cell fields (no booking URL / timestamps) and honours the toggles", () => {
    const c = cellContextFromCell(cell)!;
    expect(Object.keys(c).sort()).toEqual(["cabin", "date", "dest", "fees_cents", "miles", "origin", "program", "seats_left", "source_id"]);
    expect(cellContextFromCell({ ...cell, best: null })).toBeNull();
    expect(buildAskContext({ query, cell: c, includeQuery: false, includeCell: true })).toEqual({ cell: c });
    expect(buildAskContext({ query, cell: c, includeQuery: true, includeCell: false })).toEqual({ query });
  });

  it("dedupes tool names and formats dollars", () => {
    expect(addToolName(addToolName([], "Skill"), " Skill ")).toEqual(["Skill"]);
    expect(formatUsd(0.0042)).toBe("$0.0042");
    expect(formatUsd(1.5)).toBe("$1.50");
  });
});
