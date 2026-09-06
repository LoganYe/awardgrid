import { describe, expect, it } from "vitest";
import {
  DEFAULT_WEEK_START,
  EMPTY_RANGE,
  MONTH_CELLS,
  MONTH_ROWS,
  RANGE_PRESETS,
  addDays,
  addMonths,
  clampTo92,
  dayState,
  daysInclusive,
  formatRange,
  fromQueryDates,
  isCompleteRange,
  isISODate,
  matchedPreset,
  monthGrid,
  presetRange,
  rangeReducer,
  toQueryDates,
  weekdayOrder,
  type Weekday,
} from "./date-model";

const flat = (year: number, month: number, weekStart: Weekday = DEFAULT_WEEK_START) => monthGrid(year, month, weekStart).flat();

describe("monthGrid", () => {
  it("is always six rows of seven cells", () => {
    const grid = monthGrid(2026, 10);
    expect(grid).toHaveLength(MONTH_ROWS);
    expect(grid.every((row) => row.length === 7)).toBe(true);
    expect(grid.flat()).toHaveLength(MONTH_CELLS);
  });

  it("starts on Monday by default and on Sunday when asked", () => {
    // 2026-10-01 is a Thursday, so a Monday grid leads with Sep 28.
    expect(monthGrid(2026, 10)[0]![0]!.iso).toBe("2026-09-28");
    expect(monthGrid(2026, 10, 0)[0]![0]!.iso).toBe("2026-09-27");
    expect(weekdayOrder(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(weekdayOrder(0)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("flags the borrowed neighbour days and keeps every day of the month", () => {
    const cells = flat(2026, 10);
    const inMonth = cells.filter((c) => c.inMonth);
    expect(inMonth).toHaveLength(31);
    expect(inMonth[0]!.iso).toBe("2026-10-01");
    expect(inMonth.at(-1)!.iso).toBe("2026-10-31");
    expect(cells[0]!.inMonth).toBe(false);
    expect(cells[0]!.month).toBe(9);
  });

  it("handles leap and common Februaries", () => {
    expect(flat(2024, 2).filter((c) => c.inMonth)).toHaveLength(29);
    expect(flat(2026, 2).filter((c) => c.inMonth)).toHaveLength(28);
    expect(flat(2100, 2).filter((c) => c.inMonth)).toHaveLength(28); // 2100 is not a leap year
    expect(flat(2000, 2).filter((c) => c.inMonth)).toHaveLength(29);
    expect(flat(2024, 2).find((c) => c.iso === "2024-02-29")?.inMonth).toBe(true);
  });

  it("crosses year boundaries in both directions", () => {
    expect(flat(2026, 1)[0]!.year).toBe(2025);
    expect(flat(2026, 12).at(-1)!.year).toBe(2027);
    expect(addMonths(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(addMonths(2026, 10, 0)).toEqual({ year: 2026, month: 10 });
  });
});

describe("day arithmetic", () => {
  it("validates real calendar days only", () => {
    expect(isISODate("2026-10-01")).toBe(true);
    expect(isISODate("2026-02-30")).toBe(false);
    expect(isISODate("2026-13-01")).toBe(false);
    expect(isISODate("Oct 1")).toBe(false);
  });

  it("adds days across month, leap-day and year boundaries", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("counts days inclusively", () => {
    expect(daysInclusive("2026-10-01", "2026-10-30")).toBe(30);
    expect(daysInclusive("2026-10-01", "2026-10-01")).toBe(1);
    expect(daysInclusive("2024-02-01", "2024-03-01")).toBe(30); // leap February
  });
});

describe("range selection", () => {
  it("clicks start, clicks end, clicks again to reset", () => {
    const a = rangeReducer(EMPTY_RANGE, { type: "pick", date: "2026-10-01" });
    expect(a).toEqual({ start: "2026-10-01", end: null });
    expect(isCompleteRange(a)).toBe(false);
    const b = rangeReducer(a, { type: "pick", date: "2026-10-30" });
    expect(b).toEqual({ start: "2026-10-01", end: "2026-10-30" });
    expect(isCompleteRange(b)).toBe(true);
    const c = rangeReducer(b, { type: "pick", date: "2026-11-05" });
    expect(c).toEqual({ start: "2026-11-05", end: null });
  });

  it("orders a backwards second click and ignores unparseable dates", () => {
    const a = rangeReducer(EMPTY_RANGE, { type: "pick", date: "2026-10-10" });
    expect(rangeReducer(a, { type: "pick", date: "2026-10-02" })).toEqual({ start: "2026-10-02", end: "2026-10-10" });
    expect(rangeReducer(a, { type: "pick", date: "2026-02-30" })).toEqual(a);
    expect(rangeReducer(a, { type: "clear" })).toEqual(EMPTY_RANGE);
    expect(rangeReducer(a, { type: "set", start: "2026-10-30", end: "2026-10-01" })).toEqual({
      start: "2026-10-01",
      end: "2026-10-30",
    });
  });

  it("paints days as start, in, end or none", () => {
    const range = { start: "2026-10-01", end: "2026-10-05" };
    expect(dayState("2026-10-01", range)).toBe("start");
    expect(dayState("2026-10-03", range)).toBe("in");
    expect(dayState("2026-10-05", range)).toBe("end");
    expect(dayState("2026-10-06", range)).toBe("none");
    expect(dayState("2026-10-03", { start: "2026-10-01", end: null })).toBe("none");
  });
});

describe("presets and the 92-day cap", () => {
  it("counts the presets inclusively from today", () => {
    expect(RANGE_PRESETS).toEqual([30, 60, 90]);
    expect(presetRange(30, "2026-10-01")).toEqual({ start: "2026-10-01", end: "2026-10-30" });
    expect(presetRange(60, "2026-10-01")).toEqual({ start: "2026-10-01", end: "2026-11-29" });
    expect(presetRange(90, "2026-10-01")).toEqual({ start: "2026-10-01", end: "2026-12-29" });
    expect(daysInclusive("2026-10-01", presetRange(90, "2026-10-01").end!)).toBe(90);
  });

  it("recognises which preset a range is", () => {
    expect(matchedPreset(presetRange(60, "2026-10-01"), "2026-10-01")).toBe(60);
    expect(matchedPreset({ start: "2026-10-02", end: "2026-10-31" }, "2026-10-01")).toBeNull();
    expect(matchedPreset({ start: "2026-10-01", end: "2026-10-20" }, "2026-10-01")).toBeNull();
  });

  // What the editor stores after a pick, and what the query gets, are the same clamped range:
  // the day count under the calendar can never disagree with the chip above it.
  it("a pick far past the cap resolves to the 92 days that will actually be searched", () => {
    const raw = { start: "2026-09-06", end: "2027-02-28" };
    expect(daysInclusive(raw.start, raw.end)).toBe(176);
    expect(clampTo92(raw)).toEqual({ start: "2026-09-06", end: "2026-12-06", capped: true, days: 92 });
    expect(toQueryDates(raw)).toEqual({ date_from: "2026-09-06", date_to: "2026-12-06" });
  });

  it("clamps to 92 days with a note flag, never an error", () => {
    const long = clampTo92({ start: "2026-10-01", end: "2027-03-01" });
    expect(long.capped).toBe(true);
    expect(long.days).toBe(92);
    expect(long.end).toBe("2026-12-31");
    const ok = clampTo92({ start: "2026-10-01", end: "2026-10-30" });
    expect(ok.capped).toBe(false);
    expect(ok.days).toBe(30);
    expect(clampTo92({ start: "2026-10-01", end: null }).days).toBe(0);
    expect(presetRange(400, "2026-10-01").end).toBe("2026-12-31"); // presets clamp too
  });

  it("round-trips the QueryObject date fields", () => {
    expect(toQueryDates({ start: "2026-10-01", end: "2026-10-30" })).toEqual({
      date_from: "2026-10-01",
      date_to: "2026-10-30",
    });
    expect(toQueryDates({ start: "2026-10-01", end: null })).toBeNull();
    expect(fromQueryDates({ date_from: "2026-10-01", date_to: "2026-10-30" })).toEqual({
      start: "2026-10-01",
      end: "2026-10-30",
    });
  });
});

describe("formatRange", () => {
  it("uses an en dash with spaces in both languages", () => {
    expect(formatRange({ start: "2026-10-01", end: "2026-10-30" }, "en")).toBe("Oct 1 – Oct 30");
    expect(formatRange({ start: "2026-10-01", end: "2026-10-30" }, "zh")).toBe("10月1日 – 10月30日");
  });

  it("adds the year when the range crosses one", () => {
    expect(formatRange({ start: "2026-12-20", end: "2027-01-05" }, "en")).toBe("Dec 20, 2026 – Jan 5, 2027");
    expect(formatRange({ start: "2026-12-20", end: "2027-01-05" }, "zh")).toBe("2026年12月20日 – 2027年1月5日");
  });

  it("renders a half-open range and an empty one", () => {
    expect(formatRange({ start: "2026-10-01", end: null }, "en")).toBe("Oct 1");
    expect(formatRange(EMPTY_RANGE, "en")).toBe("");
  });
});
