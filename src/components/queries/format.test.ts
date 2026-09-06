import { describe, expect, it } from "vitest";
import {
  cabinSummary,
  defaultQueryName,
  describeCron,
  formCron,
  formProblems,
  formStateFrom,
  formToBody,
  initialFormState,
  looksLikeValidCron,
  presetForCron,
  queryFormReducer,
  queryScopeSummary,
  routeSummary,
  type QueryFormState,
} from "./format";
import { translator } from "@/lib/i18n";
import { QueryObject } from "@/lib/query/schema";

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
