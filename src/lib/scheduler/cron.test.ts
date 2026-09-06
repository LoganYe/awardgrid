import { describe, expect, it } from "vitest";
import { DEFAULT_CRON, describeCron, isDue, matchesMinute, nextMatch, nextRunAt, parseCron, validateCron } from "./cron";

describe("parseCron / validateCron", () => {
  it("accepts the default every-3-hours expression (kickoff §12) and node-cron agrees", () => {
    expect(DEFAULT_CRON).toBe("0 */3 * * *");
    expect(validateCron(DEFAULT_CRON)).toEqual({ valid: true });
    const f = parseCron(DEFAULT_CRON);
    expect([...f.minute]).toEqual([0]);
    expect([...f.hour]).toEqual([0, 3, 6, 9, 12, 15, 18, 21]);
    expect(f.domAny && f.dowAny).toBe(true);
  });

  it("parses lists, ranges, ranges with steps and start/step", () => {
    const f = parseCron("0,30 9-17 1-31/10 1,6,12 1-5");
    expect([...f.minute]).toEqual([0, 30]);
    expect([...f.hour]).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect([...f.dom]).toEqual([1, 11, 21, 31]);
    expect([...f.month]).toEqual([1, 6, 12]);
    expect([...f.dow]).toEqual([1, 2, 3, 4, 5]);
    expect([...parseCron("5/20 * * * *").minute]).toEqual([5, 25, 45]);
  });

  it("maps day-of-week 7 to Sunday (0)", () => {
    expect([...parseCron("0 0 * * 7").dow]).toEqual([0]);
    expect([...parseCron("0 0 * * 1,7").dow].sort()).toEqual([0, 1]);
  });

  it.each([
    ["", "empty"],
    ["0 0 * *", "4 fields"],
    ["0 0 * * * *", "6 fields"],
    ["60 * * * *", "minute out of range"],
    ["0 24 * * *", "hour out of range"],
    ["0 0 0 * *", "dom 0"],
    ["0 0 * 13 *", "month 13"],
    ["0 0 * * 8", "dow 8"],
    ["*/0 * * * *", "step 0"],
    ["5-1 * * * *", "reversed range"],
    ["a * * * *", "letters"],
    ["0,,5 * * * *", "empty list item"],
    ["*/5/2 * * * *", "double slash"],
  ])("rejects %j (%s)", (expr) => {
    const v = validateCron(expr);
    expect(v.valid).toBe(false);
    expect(v.error).toBeTruthy();
  });
});

describe("matchesMinute (Vixie dom/dow rule)", () => {
  it("matches EITHER when both dom and dow are restricted", () => {
    const f = parseCron("0 0 15 * 1"); // the 15th OR any Monday
    expect(matchesMinute(f, new Date("2026-06-15T00:00:00Z"))).toBe(true); // 15th (a Monday too)
    expect(matchesMinute(f, new Date("2026-06-22T00:00:00Z"))).toBe(true); // a Monday, not the 15th
    expect(matchesMinute(f, new Date("2026-06-23T00:00:00Z"))).toBe(false); // Tuesday 23rd
    expect(matchesMinute(f, new Date("2026-06-15T00:01:00Z"))).toBe(false); // wrong minute
  });

  it("uses only the restricted one when the other is a star", () => {
    expect(matchesMinute(parseCron("0 0 * * 1"), new Date("2026-06-23T00:00:00Z"))).toBe(false);
    expect(matchesMinute(parseCron("0 0 * * 1"), new Date("2026-06-22T00:00:00Z"))).toBe(true);
    expect(matchesMinute(parseCron("0 0 23 * *"), new Date("2026-06-23T00:00:00Z"))).toBe(true);
  });
});

describe("isDue", () => {
  it("is due immediately when the query has never run", () => {
    expect(isDue(DEFAULT_CRON, null, "2026-10-01T13:37:00Z")).toBe(true);
  });

  it("every 3 h: due once the 3-hour boundary is crossed, not before", () => {
    expect(isDue(DEFAULT_CRON, "2026-10-01T12:00:10Z", "2026-10-01T14:59:59Z")).toBe(false);
    expect(isDue(DEFAULT_CRON, "2026-10-01T12:00:10Z", "2026-10-01T15:00:00Z")).toBe(true);
    expect(isDue(DEFAULT_CRON, "2026-10-01T12:00:10Z", "2026-10-01T15:04:00Z")).toBe(true); // tick a few minutes late
  });

  it("does not re-fire for the minute the last run happened in", () => {
    expect(isDue(DEFAULT_CRON, "2026-10-01T15:00:30Z", "2026-10-01T15:00:59Z")).toBe(false);
    expect(isDue("* * * * *", "2026-10-01T15:00:30Z", "2026-10-01T15:00:59Z")).toBe(false);
    expect(isDue("* * * * *", "2026-10-01T15:00:30Z", "2026-10-01T15:01:00Z")).toBe(true);
  });

  it("*/15: due across a quarter-hour boundary, nothing due inside one", () => {
    expect(isDue("*/15 * * * *", "2026-10-01T10:16:00Z", "2026-10-01T10:29:00Z")).toBe(false);
    expect(isDue("*/15 * * * *", "2026-10-01T10:16:00Z", "2026-10-01T10:30:00Z")).toBe(true);
  });

  it("lists and ranges: weekday-mornings-only schedule", () => {
    const expr = "0 9 * * 1-5";
    expect(isDue(expr, "2026-10-02T09:00:00Z", "2026-10-03T12:00:00Z")).toBe(false); // Saturday
    expect(isDue(expr, "2026-10-02T09:00:00Z", "2026-10-04T12:00:00Z")).toBe(false); // Sunday
    expect(isDue(expr, "2026-10-04T12:00:00Z", "2026-10-05T09:00:00Z")).toBe(true); // Monday 09:00
    expect(isDue("0 8,20 * * *", "2026-10-01T08:00:00Z", "2026-10-01T19:59:00Z")).toBe(false);
    expect(isDue("0 8,20 * * *", "2026-10-01T08:00:00Z", "2026-10-01T20:00:00Z")).toBe(true);
  });

  it("caps the look-back at 24 h: a daily 03:00 job that slept a week is due once, a job whose only slot was 30 h ago is not", () => {
    expect(isDue("0 3 * * *", "2026-09-20T03:00:00Z", "2026-10-01T12:00:00Z")).toBe(true); // 03:00 today is inside 24 h
    // Fires only on the 1st at 03:00; now is the 2nd at 09:00 → the slot is 30 h back, past the cap.
    expect(isDue("0 3 1 * *", "2026-09-01T03:00:00Z", "2026-10-02T09:00:00Z")).toBe(false);
    // Same schedule, now = the 2nd 02:59 → slot 23h59m back, inside the cap.
    expect(isDue("0 3 1 * *", "2026-09-01T03:00:00Z", "2026-10-02T02:59:00Z")).toBe(true);
  });

  it("never throws: an invalid expression or timestamp is simply not due", () => {
    expect(isDue("nope", null, "2026-10-01T12:00:00Z")).toBe(false);
    expect(isDue("0 0 * * *", "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z")).toBe(true);
  });
});

describe("nextMatch", () => {
  it("finds the next 3-hour slot", () => {
    expect(nextMatch(DEFAULT_CRON, new Date("2026-10-01T12:00:00Z"))?.toISOString()).toBe("2026-10-01T15:00:00.000Z");
    expect(nextMatch(DEFAULT_CRON, new Date("2026-10-01T14:59:00Z"))?.toISOString()).toBe("2026-10-01T15:00:00.000Z");
  });
});

describe("nextRunAt (Phase 6 §4: the queries table's next-run column)", () => {
  it("returns the next slot after the given instant, as an ISO string", () => {
    expect(nextRunAt(DEFAULT_CRON, "2026-10-01T12:00:00Z")).toBe("2026-10-01T15:00:00.000Z");
    expect(nextRunAt(DEFAULT_CRON, "2026-10-01T15:00:00Z")).toBe("2026-10-01T18:00:00.000Z");
    expect(nextRunAt("0 9 * * 1-5", "2026-10-02T09:00:00Z")).toBe("2026-10-05T09:00:00.000Z"); // Friday → Monday
  });

  it("is strictly after: a run inside the matching minute does not return that same minute", () => {
    expect(nextRunAt("* * * * *", "2026-10-01T15:00:30Z")).toBe("2026-10-01T15:01:00.000Z");
  });

  it("returns null for an invalid expression or timestamp instead of throwing", () => {
    expect(nextRunAt("nope", "2026-10-01T12:00:00Z")).toBeNull();
    expect(nextRunAt(DEFAULT_CRON, "not-a-date")).toBeNull();
    expect(nextRunAt("0 0 30 2 *", "2026-10-01T12:00:00Z")).toBeNull(); // February 30th never comes
  });
});

describe("describeCron", () => {
  it("recognises the every-n-hours shape (n divides 24, starting at midnight)", () => {
    expect(describeCron(DEFAULT_CRON)).toEqual({ kind: "every_hours", n: 3 });
    expect(describeCron("0 */6 * * *")).toEqual({ kind: "every_hours", n: 6 });
    expect(describeCron("0 0,12 * * *")).toEqual({ kind: "every_hours", n: 12 });
    expect(describeCron("0 * * * *")).toEqual({ kind: "every_hours", n: 1 });
    expect(describeCron("  0   */4   *  *  * ")).toEqual({ kind: "every_hours", n: 4 });
  });

  it("recognises a daily schedule with its hour and minute", () => {
    expect(describeCron("0 8 * * *")).toEqual({ kind: "daily", hh: 8, mm: 0 });
    expect(describeCron("30 23 * * *")).toEqual({ kind: "daily", hh: 23, mm: 30 });
  });

  it("falls back to custom rather than describing a schedule inaccurately", () => {
    expect(describeCron("0 8,20 * * *")).toEqual({ kind: "custom", expr: "0 8,20 * * *" }); // twice a day, not from midnight
    expect(describeCron("0 9 * * 1-5")).toEqual({ kind: "custom", expr: "0 9 * * 1-5" }); // weekdays only
    expect(describeCron("0 3 1 * *")).toEqual({ kind: "custom", expr: "0 3 1 * *" }); // monthly
    expect(describeCron("0 0 * 6 *")).toEqual({ kind: "custom", expr: "0 0 * 6 *" }); // June only
    expect(describeCron("0,30 * * * *")).toEqual({ kind: "custom", expr: "0,30 * * * *" }); // two minutes
    expect(describeCron("0 */5 * * *")).toEqual({ kind: "custom", expr: "0 */5 * * *" }); // 0,5,10,15,20 — not a full day
  });

  it("never throws on garbage: it comes back as custom with the trimmed text", () => {
    expect(describeCron("nope")).toEqual({ kind: "custom", expr: "nope" });
    expect(describeCron("  ")).toEqual({ kind: "custom", expr: "" });
  });
});
