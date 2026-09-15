import { describe, expect, it } from "vitest";
import {
  cabinSummary,
  defaultQueryName,
  describeCron,
  diffGridCell,
  formCron,
  formProblems,
  formStateFrom,
  formToBody,
  initialFormState,
  looksLikeValidCron,
  nextRunFromCron,
  presetForCron,
  queryFormReducer,
  queryScopeSummary,
  relativeTime,
  routeSummary,
  runResultText,
  scheduleText,
  toDiffRow,
  type QueryFormState,
} from "./format";
import { translator } from "@awardgrid/core/i18n";
import { QueryObject } from "@awardgrid/core/query/schema";

const Q = { origins: ["HKG", "PVG", "NRT", "ICN"], destinations: ["SEA"], cabins: ["F", "J"] as ("F" | "J")[] };

describe("queryScopeSummary", () => {
  const cellWindow = QueryObject.parse({
    origins: ["PVG"],
    destinations: ["SEA"],
    date_from: "2026-09-07",
    date_to: "2026-09-13",
    cabins: ["J", "F"],
    raw_text: "x",
    language: "en",
  });

  it("says the route, the window and the cabins the save will actually watch", () => {
    // The ±3-day window from a cell drawer save — not the grid's own 7-route, 30-day query.
    expect(queryScopeSummary(cellWindow, translator("en"), "en")).toBe("Watches PVG to SEA, Sep 7–13, First and Business.");
  });

  it("reads in the UI language, with the locale's own punctuation", () => {
    const zh = queryScopeSummary(cellWindow, translator("zh"), "zh");
    expect(zh).toContain("PVG 到 SEA");
    expect(zh).toContain("头等舱");
    expect(zh).not.toContain(" · ");
  });

  it("names every origin and destination of a multi-route query", () => {
    const grid = QueryObject.parse({ ...cellWindow, origins: ["HKG", "SHA"], destinations: ["SEA", "PDX"], date_to: "2026-10-06" });
    expect(queryScopeSummary(grid, translator("en"), "en")).toContain("HKG, SHA to SEA, PDX");
  });
});

describe("summaries", () => {
  it("routeSummary truncates after three codes", () => {
    expect(routeSummary(Q)).toBe("HKG,PVG,NRT… → SEA");
    expect(routeSummary({ origins: ["HKG"], destinations: ["SEA", "SFO"] })).toBe("HKG → SEA,SFO");
  });
  it("cabinSummary keeps the F/J/W/Y order", () => {
    expect(cabinSummary({ cabins: ["Y", "F", "J"] })).toBe("F,J,Y");
  });
  it("defaultQueryName fits 60 chars", () => {
    expect(defaultQueryName(Q)).toBe("HKG,PVG,NRT… → SEA F,J");
    expect(defaultQueryName(Q, 12)).toHaveLength(12);
  });
});

describe("cron helpers", () => {
  it("maps stored crons to presets", () => {
    expect(presetForCron("0 */3 * * *")).toBe("every_3h");
    expect(presetForCron("0  8 * * *")).toBe("daily_08");
    expect(presetForCron("30 9 * * 1-5")).toBe("custom");
  });
  it("describes the common shapes", () => {
    expect(describeCron("0 */3 * * *")).toEqual({ kind: "every_hours", hours: 3 });
    expect(describeCron("0 */1 * * *")).toEqual({ kind: "hourly" });
    expect(describeCron("15 * * * *")).toEqual({ kind: "hourly" });
    expect(describeCron("0 8 * * *")).toEqual({ kind: "daily", time: "08:00" });
    expect(describeCron("30 9 * * 1-5")).toEqual({ kind: "custom", cron: "30 9 * * 1-5" });
    expect(describeCron("bogus")).toEqual({ kind: "custom", cron: "bogus" });
  });
  it("looksLikeValidCron mirrors the ≤ hourly rule loosely", () => {
    expect(looksLikeValidCron("0 */3 * * *")).toBe(true);
    expect(looksLikeValidCron("* * * * *")).toBe(false);
    expect(looksLikeValidCron("0 0 */3 * * *")).toBe(false);
    expect(looksLikeValidCron("60 * * * *")).toBe(false);
  });
});

describe("form reducer", () => {
  it("starts from §12 defaults for a new query", () => {
    expect(initialFormState(Q)).toEqual({ name: "HKG,PVG,NRT… → SEA F,J", preset: "every_3h", customCron: "", notifyOn: "both", thresholdPct: 10 });
  });
  it("restores an existing query, including a custom cron", () => {
    const s = formStateFrom({ name: "n", schedule_cron: "30 9 * * 1-5", notify_on: "price_drop", drop_threshold_pct: 25 });
    expect(s).toEqual({ name: "n", preset: "custom", customCron: "30 9 * * 1-5", notifyOn: "price_drop", thresholdPct: 25 });
    expect(formCron(s)).toBe("30 9 * * 1-5");
  });
  it("clamps threshold, caps name length and validates", () => {
    let s: QueryFormState = initialFormState(Q);
    s = queryFormReducer(s, { type: "set_threshold", value: 500 });
    expect(s.thresholdPct).toBe(90);
    s = queryFormReducer(s, { type: "set_threshold", value: -3 });
    expect(s.thresholdPct).toBe(1);
    s = queryFormReducer(s, { type: "set_threshold", value: Number.NaN });
    expect(s.thresholdPct).toBe(1);
    s = queryFormReducer(s, { type: "set_name", value: "x".repeat(80) });
    expect(s.name).toHaveLength(60);
    expect(formProblems(s)).toEqual([]);
    s = queryFormReducer(s, { type: "set_name", value: "   " });
    expect(formProblems(s)).toEqual(["name"]);
    s = queryFormReducer(s, { type: "set_preset", value: "custom" });
    expect(formProblems(s)).toEqual(["name", "cron"]);
    s = queryFormReducer(s, { type: "set_custom_cron", value: " 0  */4 * * * " });
    s = queryFormReducer(s, { type: "set_name", value: "ok" });
    s = queryFormReducer(s, { type: "set_notify", value: "new_cells" });
    expect(formProblems(s)).toEqual([]);
    expect(formToBody(s)).toEqual({ name: "ok", schedule_cron: "0 */4 * * *", notify_on: "new_cells", drop_threshold_pct: 1 });
  });
});

// ---------------------------------------------------------------------------
// Queries page (spec §4): schedule label, run result, relative times, next run, diff rows
// ---------------------------------------------------------------------------

describe("scheduleText", () => {
  const t = translator("en");
  const zh = translator("zh");

  it("prefers the API's schedule label over re-parsing the expression", () => {
    expect(scheduleText(t, "0 */3 * * *", { kind: "every_hours", n: 3 })).toBe("every 3 hours");
    expect(scheduleText(t, "0 * * * *", { kind: "every_hours", n: 1 })).toBe("hourly");
    expect(scheduleText(t, "30 8 * * *", { kind: "daily", hh: 8, mm: 30 })).toBe("daily at 08:30");
    expect(scheduleText(zh, "0 */3 * * *", { kind: "every_hours", n: 3 })).toBe("每 3 小时");
  });

  it("shows a custom expression verbatim, in both languages", () => {
    expect(scheduleText(t, "0 8,20 * * *", { kind: "custom", expr: "0 8,20 * * *" })).toBe("0 8,20 * * *");
    expect(scheduleText(zh, "0 8,20 * * *", { kind: "custom", expr: "0 8,20 * * *" })).toBe("0 8,20 * * *");
  });

  it("falls back to its own parser when no label is supplied", () => {
    expect(scheduleText(t, "0 */6 * * *")).toBe("every 6 hours");
    expect(scheduleText(t, "0 8 * * *")).toBe("daily at 08:00");
    expect(scheduleText(t, "0 8,20 * * *")).toBe("0 8,20 * * *");
  });
});

describe("runResultText", () => {
  const t = translator("en");
  const run = (over: Partial<Parameters<typeof runResultText>[0]> = {}) => ({ new_cells: 0, dropped_cells: 0, skipped_reason: null, ...over });

  it("counts what changed, says so when nothing did", () => {
    expect(runResultText(run({ new_cells: 2, dropped_cells: 1 }), t)).toBe("+2 new, −1 dropped");
    expect(runResultText(run(), t)).toBe("no change");
  });

  it("names the skip reason, and calls the first run a baseline", () => {
    expect(runResultText(run({ skipped_reason: "quota" }), t)).toBe("skipped: daily limit");
    expect(runResultText(run({ skipped_reason: "first_run", new_cells: 12 }), t)).toBe("baseline");
  });

  it("shows an unknown reason code rather than swallowing it", () => {
    expect(runResultText(run({ skipped_reason: "moon_phase" }), t)).toBe("skipped: moon_phase");
  });

  it("does not call a delivered price drop 'no change'", () => {
    // query_runs counts new and dropped cells but not price drops, and shouldNotify fires on
    // price drops too — so a run that sent a digest with no cell movement changed prices.
    expect(runResultText(run({ notified: true }), t)).toBe("prices dropped");
    // A run that found nothing and sent nothing still reads as no change.
    expect(runResultText(run({ notified: false }), t)).toBe("no change");
    // Cell movement always wins: the counts are the more specific fact.
    expect(runResultText(run({ new_cells: 1, notified: true }), t)).toBe("+1 new, −0 dropped");
  });
});


describe("relativeTime", () => {
  const now = Date.parse("2026-10-15T12:00:00.000Z");

  it("picks the unit the reader would use", () => {
    expect(relativeTime("2026-10-15T11:58:00.000Z", now, "en")).toBe("2 minutes ago");
    expect(relativeTime("2026-10-15T10:00:00.000Z", now, "en")).toBe("2 hours ago");
    expect(relativeTime("2026-10-13T12:00:00.000Z", now, "en")).toBe("2 days ago");
    expect(relativeTime("2026-10-15T12:58:00.000Z", now, "en")).toBe("in 58 minutes");
  });

  it("translates through Intl", () => {
    expect(relativeTime("2026-10-15T10:00:00.000Z", now, "zh")).toContain("小时");
  });

  it("returns nothing for a missing or unparseable timestamp", () => {
    expect(relativeTime(null, now, "en")).toBe("");
    expect(relativeTime("not a date", now, "en")).toBe("");
  });
});

describe("nextRunFromCron", () => {
  const now = Date.parse("2026-10-15T12:10:00.000Z");

  it("finds the next matching minute in UTC", () => {
    expect(nextRunFromCron("0 */3 * * *", now)).toBe("2026-10-15T15:00:00.000Z");
    expect(nextRunFromCron("0 * * * *", now)).toBe("2026-10-15T13:00:00.000Z");
    expect(nextRunFromCron("30 8 * * *", now)).toBe("2026-10-16T08:30:00.000Z");
  });

  it("rolls a daily time that is still ahead today", () => {
    expect(nextRunFromCron("0 20 * * *", now)).toBe("2026-10-15T20:00:00.000Z");
  });

  it("declines an expression it cannot read rather than guessing", () => {
    expect(nextRunFromCron("0 8,20 * * *", now)).toBeNull();
    expect(nextRunFromCron("nonsense", now)).toBeNull();
  });
});

describe("toDiffRow", () => {
  const seen = "2026-10-15T10:00:00.000Z";

  it("expands a stored snapshot into a row the grid cell can render", () => {
    const row = toDiffRow({ key: "alaska|HKG|SEA|2026-10-18|J", miles: 60000, fees_cents: 560, seats_left: 2, computed_last_seen: seen }, "x");
    expect(row).toMatchObject({ program: "alaska", origin: "HKG", dest: "SEA", date: "2026-10-18", cabin: "J", miles: 60000, fees_cents: 560, seats_left: 2 });
    expect(row?.computed_last_seen).toBe(seen);
    // A snapshot carries no currency, airlines or booking link: they stay empty, never invented.
    expect(row).toMatchObject({ currency: null, airlines: [], booking_url: null, direct: false });
  });

  it("accepts an already-expanded row", () => {
    const row = toDiffRow({ program: "united", origin: "ICN", dest: "SEA", date: "2026-10-20", cabin: "F", miles: 90000, currency: "USD" }, seen);
    expect(row).toMatchObject({ program: "united", cabin: "F", miles: 90000, currency: "USD" });
    expect(row?.fetched_at).toBe(seen);
  });

  it("rejects anything that is not a five-part key with miles", () => {
    expect(toDiffRow({ key: "alaska|HKG|SEA|2026-10-18", miles: 1 }, seen)).toBeNull();
    expect(toDiffRow({ key: "alaska|HKG|SEA|2026-10-18|Z", miles: 1 }, seen)).toBeNull();
    expect(toDiffRow({ key: "alaska|HKG|SEA|2026-10-18|J", miles: 0 }, seen)).toBeNull();
    expect(toDiffRow(null, seen)).toBeNull();
  });

  it("wraps a row as a one-row grid cell", () => {
    const row = toDiffRow({ key: "alaska|HKG|SEA|2026-10-18|J", miles: 60000, fees_cents: null, seats_left: 0, computed_last_seen: seen }, seen)!;
    expect(diffGridCell(row)).toMatchObject({ origin: "HKG", dest: "SEA", date: "2026-10-18", status: "ok", best: row, all: [row] });
  });
});
