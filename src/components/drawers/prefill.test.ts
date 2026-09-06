import { describe, expect, it } from "vitest";
import { PREFILL_WINDOW_DAYS, prefillFromCell, prefillNameFromCell } from "@/components/drawers/prefill";
import { NAME_MAX_LENGTH } from "@/components/queries/format";
import { MAX_SPAN_DAYS, QueryObject } from "@/lib/query/schema";

const BASE: QueryObject = {
  origins: ["HKG", "PVG", "NRT", "ICN"],
  destinations: ["SEA"],
  date_from: "2026-10-01",
  date_to: "2026-10-30",
  cabins: ["J", "F"],
  programs: ["alaska", "american"],
  direct_only: true,
  include_filtered: true,
  sort_by: "fees_asc",
  raw_text: "HKG, SHA, TYO, SEL to SEA, next 30 days, first",
  language: "en",
};

const CELL = { origin: "NRT", dest: "SEA", date: "2026-10-15" };

describe("prefillFromCell", () => {
  it("narrows the route to the cell's own pair", () => {
    const { query } = prefillFromCell(CELL, BASE);
    expect(query.origins).toEqual(["NRT"]);
    expect(query.destinations).toEqual(["SEA"]);
  });

  it("opens a ±3-day window around the cell's date (spec §3.5)", () => {
    expect(PREFILL_WINDOW_DAYS).toBe(3);
    const { query } = prefillFromCell(CELL, BASE);
    expect(query.date_from).toBe("2026-10-12");
    expect(query.date_to).toBe("2026-10-18");
  });

  it("crosses month and year boundaries by calendar days, not by string arithmetic", () => {
    expect(prefillFromCell({ ...CELL, date: "2026-01-01" }, BASE).query).toMatchObject({
      date_from: "2025-12-29",
      date_to: "2026-01-04",
    });
    expect(prefillFromCell({ ...CELL, date: "2028-02-28" }, BASE).query).toMatchObject({
      date_from: "2028-02-25",
      date_to: "2028-03-02", // 2028 is a leap year: Feb 29 is a real day in the window
    });
  });

  it("keeps every other field of the grid's query", () => {
    const { query } = prefillFromCell(CELL, BASE);
    expect(query.cabins).toEqual(["J", "F"]);
    expect(query.programs).toEqual(["alaska", "american"]);
    expect(query.direct_only).toBe(true);
    expect(query.include_filtered).toBe(true);
    expect(query.sort_by).toBe("fees_asc");
    expect(query.raw_text).toBe(BASE.raw_text);
    expect(query.language).toBe("en");
  });

  it("does not mutate the base query", () => {
    const before = structuredClone(BASE);
    prefillFromCell(CELL, BASE);
    expect(BASE).toEqual(before);
  });

  it("clamps the window's start to today, so a standing query never watches the past", () => {
    const { query } = prefillFromCell(CELL, BASE, "2026-10-14");
    expect(query.date_from).toBe("2026-10-14");
    expect(query.date_to).toBe("2026-10-18");
  });

  it("keeps date_to on or after date_from for a cell already in the past", () => {
    const { query } = prefillFromCell({ ...CELL, date: "2026-01-05" }, BASE, "2026-10-14");
    expect(query.date_from).toBe("2026-10-14");
    expect(query.date_to).toBe("2026-10-14");
  });

  it("produces a QueryObject the schema accepts", () => {
    for (const today of [undefined, "2026-10-14", "2026-12-01"]) {
      const { query } = prefillFromCell(CELL, BASE, today);
      expect(QueryObject.safeParse(query).success).toBe(true);
      const span = (Date.parse(`${query.date_to}T00:00:00Z`) - Date.parse(`${query.date_from}T00:00:00Z`)) / 86_400_000 + 1;
      expect(span).toBeGreaterThan(0);
      expect(span).toBeLessThanOrEqual(MAX_SPAN_DAYS);
    }
  });

  it("names the saved query after the route, cabins and date", () => {
    expect(prefillFromCell(CELL, BASE).name).toBe("NRT → SEA F,J 2026-10-15");
  });
});

describe("prefillNameFromCell", () => {
  it("stays inside the dialog's name limit", () => {
    const long = prefillNameFromCell(CELL, { cabins: ["F", "J", "W", "Y"] }, 12);
    expect(long).toBe("NRT → SEA F…");
    expect(long.length).toBe(12);
    expect(prefillNameFromCell(CELL, BASE).length).toBeLessThanOrEqual(NAME_MAX_LENGTH);
  });
});
