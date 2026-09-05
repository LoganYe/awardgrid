import { describe, expect, it } from "vitest";
import { capRange, parseDates, parseISODate, parseSmallNumber } from "@/lib/query/dates";

const today = "2026-09-06";

describe("parseDates — relative windows", () => {
  it.each([
    ["未来一个月", "2026-09-06", "2026-10-06"],
    ["接下来一个月", "2026-09-06", "2026-10-06"],
    ["next month", "2026-09-06", "2026-10-06"],
    ["next 30 days", "2026-09-06", "2026-10-06"],
    ["in the next month", "2026-09-06", "2026-10-06"],
    ["未来两周", "2026-09-06", "2026-09-20"],
    ["next two weeks", "2026-09-06", "2026-09-20"],
    ["next 14 days", "2026-09-06", "2026-09-20"],
    ["未来45天", "2026-09-06", "2026-10-21"],
    ["未来十天", "2026-09-06", "2026-09-16"],
    ["next 7 days", "2026-09-06", "2026-09-13"],
    ["未来三个月", "2026-09-06", "2026-12-05"],
    ["next 3 months", "2026-09-06", "2026-12-05"],
    ["this month", "2026-09-06", "2026-09-30"],
  ])("%s", (text, from, to) => {
    expect(parseDates(text, today)).toEqual({ date_from: from, date_to: to, capped: false });
  });

  it("caps 4 months at 92 days and flags it", () => {
    expect(parseDates("未来四个月", today)).toEqual({ date_from: "2026-09-06", date_to: "2026-12-06", capped: true });
    expect(parseDates("next 200 days", today)).toEqual({ date_from: "2026-09-06", date_to: "2026-12-06", capped: true });
  });
  it("three-digit day counts are deterministic in both languages (capped, not sent to the LLM)", () => {
    expect(parseDates("未来100天", today)).toEqual({ date_from: "2026-09-06", date_to: "2026-12-06", capped: true });
    expect(parseDates("100天内", today)).toEqual({ date_from: "2026-09-06", date_to: "2026-12-06", capped: true });
    expect(parseDates("next 100 days", today)).toEqual({ date_from: "2026-09-06", date_to: "2026-12-06", capped: true });
  });
});

describe("parseDates — bare months", () => {
  it("next occurrence of a future month", () => {
    expect(parseDates("十月", today)).toEqual({ date_from: "2026-10-01", date_to: "2026-10-31", capped: false });
    expect(parseDates("11月", today)).toEqual({ date_from: "2026-11-01", date_to: "2026-11-30", capped: false });
    expect(parseDates("October", today)).toEqual({ date_from: "2026-10-01", date_to: "2026-10-31", capped: false });
    expect(parseDates("in Oct", today)).toEqual({ date_from: "2026-10-01", date_to: "2026-10-31", capped: false });
  });
  it("a month already past rolls to next year", () => {
    expect(parseDates("二月", today)).toEqual({ date_from: "2027-02-01", date_to: "2027-02-28", capped: false });
    expect(parseDates("February", today)).toEqual({ date_from: "2027-02-01", date_to: "2027-02-28", capped: false });
  });
  it("the current month starts today", () => {
    expect(parseDates("九月", today)).toEqual({ date_from: "2026-09-06", date_to: "2026-09-30", capped: false });
  });
  it("lower-case 'may' is a verb, capitalised 'May' is a month", () => {
    expect(parseDates("I may go", today)).toBeNull();
    expect(parseDates("in May", today)).toEqual({ date_from: "2027-05-01", date_to: "2027-05-31", capped: false });
  });
  it("一个月 is not January", () => {
    expect(parseDates("一个月", today)).toBeNull();
  });
});

describe("parseDates — explicit", () => {
  it("zh range, zh range with omitted second month, single zh date", () => {
    expect(parseDates("10月1日到10月15日", today)).toEqual({ date_from: "2026-10-01", date_to: "2026-10-15", capped: false });
    expect(parseDates("10月1日至15日", today)).toEqual({ date_from: "2026-10-01", date_to: "2026-10-15", capped: false });
    expect(parseDates("10月15号", today)).toEqual({ date_from: "2026-10-15", date_to: "2026-10-15", capped: false });
  });
  it("Chinese-numeral months and days are explicit dates, not a bare month", () => {
    expect(parseDates("十月一日到十月十五日", today)).toEqual({ date_from: "2026-10-01", date_to: "2026-10-15", capped: false });
    expect(parseDates("十月一日至十五日", today)).toEqual({ date_from: "2026-10-01", date_to: "2026-10-15", capped: false });
    expect(parseDates("十月十五日", today)).toEqual({ date_from: "2026-10-15", date_to: "2026-10-15", capped: false });
    expect(parseDates("十一月二十一号", today)).toEqual({ date_from: "2026-11-21", date_to: "2026-11-21", capped: false });
    expect(parseDates("HKG to SEA 十月一日到十月十五日", today)).toEqual({ date_from: "2026-10-01", date_to: "2026-10-15", capped: false });
  });
  it("en ranges", () => {
    expect(parseDates("Oct 1 - Oct 15", today)).toEqual({ date_from: "2026-10-01", date_to: "2026-10-15", capped: false });
    expect(parseDates("October 1st to 15th", today)).toEqual({ date_from: "2026-10-01", date_to: "2026-10-15", capped: false });
    expect(parseDates("Dec 20 - Jan 5", today)).toEqual({ date_from: "2026-12-20", date_to: "2027-01-05", capped: false });
  });
  it("ISO and slash forms", () => {
    expect(parseDates("2026-10-01 to 2026-10-15", today)).toEqual({ date_from: "2026-10-01", date_to: "2026-10-15", capped: false });
    expect(parseDates("2026-10-01", today)).toEqual({ date_from: "2026-10-01", date_to: "2026-10-01", capped: false });
    expect(parseDates("10/1-10/15", today)).toEqual({ date_from: "2026-10-01", date_to: "2026-10-15", capped: false });
  });
  it("a single date already past rolls to next year", () => {
    expect(parseDates("1月5日", today)).toEqual({ date_from: "2027-01-05", date_to: "2027-01-05", capped: false });
  });
  it("explicit ranges beyond the cap are truncated", () => {
    expect(parseDates("2026-10-01 to 2027-03-01", today)).toEqual({ date_from: "2026-10-01", date_to: "2026-12-31", capped: true });
  });
  it("impossible dates are rejected", () => {
    expect(parseDates("2月30日", today)).toBeNull();
    expect(parseDates("二月三十日", today)).toBeNull();
  });
  it("a reversed explicit range is swapped and carries a warning (never a silent single day)", () => {
    expect(parseDates("2026-10-15 to 2026-10-01", today)).toEqual({
      date_from: "2026-10-01",
      date_to: "2026-10-15",
      capped: false,
      warning: expect.stringContaining("end-first"),
    });
    expect(parseDates("2026年10月15日到2026年10月1日", today)).toMatchObject({ date_from: "2026-10-01", date_to: "2026-10-15", warning: expect.any(String) });
    expect(parseDates("Oct 15, 2026 - Oct 1, 2026", today)).toMatchObject({ date_from: "2026-10-01", date_to: "2026-10-15", warning: expect.any(String) });
    expect(parseDates("10/15/2026-10/1/2026", today)).toMatchObject({ date_from: "2026-10-01", date_to: "2026-10-15", warning: expect.any(String) });
    // Without years the end rolls into next year ("Dec 20 - Jan 5" semantics), so it is not "reversed".
    expect(parseDates("10月15日到10月1日", today)).toEqual({ date_from: "2026-10-15", date_to: "2027-01-14", capped: true });
  });
});

describe("parseDates — not handled (LLM territory)", () => {
  it.each(["国庆", "春节期间", "Thanksgiving week", "Christmas", "圣诞", "十月国庆", "sometime soon", ""])("%s → null", (text) => {
    expect(parseDates(text, today)).toBeNull();
  });
  it("an explicit range next to a holiday word still wins", () => {
    expect(parseDates("国庆 10月1日到10月7日", today)).toEqual({ date_from: "2026-10-01", date_to: "2026-10-07", capped: false });
  });
});

describe("helpers", () => {
  it("parseSmallNumber", () => {
    expect(parseSmallNumber("三")).toBe(3);
    expect(parseSmallNumber("十")).toBe(10);
    expect(parseSmallNumber("十五")).toBe(15);
    expect(parseSmallNumber("二十一")).toBe(21);
    expect(parseSmallNumber("两")).toBe(2);
    expect(parseSmallNumber("12")).toBe(12);
    expect(parseSmallNumber("x")).toBeNull();
  });
  it("capRange keeps date_from and truncates date_to to a 92-day span", () => {
    const r = capRange(parseISODate("2026-10-01"), parseISODate("2027-06-30"));
    expect(r).toEqual({ date_from: "2026-10-01", date_to: "2026-12-31", capped: true });
  });
  it("rejects a malformed today", () => {
    expect(() => parseDates("next month", "not-a-date")).toThrow();
  });
});
