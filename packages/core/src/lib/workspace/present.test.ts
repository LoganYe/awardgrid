/**
 * Results put into words (UI/UX v1 T07; acceptance A02, A03 component half): unknown stays unknown, zero stays zero,
 * provider time is not local time, calendar days do not move with the device's zone.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import copyFixture from "../../../test/fixtures/uiux/copy.zh-en.json";
import { fixtureSnapshot } from "../../../test/fixtures/uiux/factory";
import { coverageFor } from "./coverage";
import {
  COPY,
  coverageLabel,
  coverageNotices,
  dayLabel,
  feesLabel,
  formatMiles,
  moreConditionsCount,
  querySubline,
  rangeLabel,
  resultName,
  routeLabel,
  seatsLabel,
  sortedRows,
  timeLabel,
} from "./present";

describe("approved copy", () => {
  it("every string used here is the handoff copy's, in both languages", () => {
    const rows = new Map(copyFixture.rows.map((r) => [r.key, r]));
    for (const [key, text] of Object.entries(COPY)) {
      expect(rows.get(key), key).toBeDefined();
      expect(text.en, key).toBe(rows.get(key)!.en);
      expect(text.zh, key).toBe(rows.get(key)!.zh);
    }
  });
});

describe("fees and seats", () => {
  it("unknown fees are not free; a real zero with its currency is 0.00; an amount without a currency says so", () => {
    expect(feesLabel(null, null, "en")).toBe("Fees not yet confirmed");
    expect(feesLabel(null, "USD", "zh")).toBe("税费待确认");
    expect(feesLabel(0, "USD", "en")).toBe("USD 0.00");
    expect(feesLabel(8620, "usd", "en")).toBe("USD 86.20");
    expect(feesLabel(8620, null, "en")).toBe("86.20 · Currency not provided");
    expect(feesLabel(8620, "", "zh")).toBe("86.20 · 币种未提供");
  });

  it("a seat count of 0 is not provided, never sold out", () => {
    expect(seatsLabel(0, "en")).toBe("Seat count not provided");
    expect(seatsLabel(undefined, "zh")).toBe("席位未提供");
    expect(seatsLabel(1, "en")).toBe("1 seat");
    expect(seatsLabel(2, "zh")).toBe("2 席");
  });
});

describe("time", () => {
  const now = "2026-10-18T08:30:00Z";
  it("a provider time is dated as the provider's, with its age", () => {
    expect(timeLabel({ basis: "provider_last_seen", providerAt: "2026-10-18T07:52:00Z", fetchedAt: "2026-10-18T08:00:00Z" }, now, "en")).toBe("Source updated 38 min ago");
    expect(timeLabel({ basis: "provider_updated", providerAt: "2026-10-17T06:00:00Z", fetchedAt: null }, now, "zh")).toBe("来源 1 天前更新");
  });
  it("without a provider time: source time unknown, and this device's fetch time beside it, with its day", () => {
    expect(timeLabel({ basis: "local_fallback", providerAt: null, fetchedAt: "2026-10-18T08:00:00Z" }, now, "en", "UTC")).toBe(
      "Source update time unknown · Fetched on this device at Oct 18, 08:00",
    );
    expect(timeLabel({ basis: "unknown", providerAt: null, fetchedAt: "2026-10-16T23:05:00Z" }, now, "zh", "UTC")).toBe("来源更新时间未知 · 本机获取于 10月16日 23:05");
    expect(timeLabel({ basis: "unknown", providerAt: null, fetchedAt: null }, now, "zh")).toBe("来源更新时间未知");
  });
  it("a provider time later than the display clock is not believed: unknown, never 'just now'", () => {
    expect(timeLabel({ basis: "provider_last_seen", providerAt: "2026-10-18T09:30:00Z", fetchedAt: null }, now, "en")).toBe("Source update time unknown");
    expect(timeLabel({ basis: "provider_last_seen", providerAt: "2026-10-18T08:30:30Z", fetchedAt: null }, now, "en")).toBe("Source updated just now");
  });
});

describe("dates in a zone far from UTC", () => {
  const original = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "Pacific/Honolulu";
  });
  afterAll(() => {
    process.env.TZ = original;
  });
  it("a calendar day is still that day, in both languages", () => {
    expect(new Date("2026-10-18T00:00:00Z").getDate()).toBe(17); // the zone really is in effect
    expect(dayLabel("2026-10-18", "en")).toBe("Sun, Oct 18");
    expect(dayLabel("2026-10-18", "zh")).toBe("10月18日 · 周日");
    expect(rangeLabel("2026-10-01", "2026-10-30", "zh")).toBe("10月1–30日");
  });
});

describe("dates and the query summary", () => {
  it("calendar days keep their date and weekday whatever the device's zone", () => {
    expect(dayLabel("2026-10-18", "en")).toBe("Sun, Oct 18");
    expect(dayLabel("2026-10-18", "zh")).toBe("10月18日 · 周日");
  });
  it("ranges: same month, across months, across years", () => {
    expect(rangeLabel("2026-10-01", "2026-10-30", "en")).toBe("Oct 1 – 30");
    expect(rangeLabel("2026-10-01", "2026-10-30", "zh")).toBe("10月1–30日");
    expect(rangeLabel("2026-10-30", "2026-11-05", "en")).toBe("Oct 30 – Nov 5");
    expect(rangeLabel("2026-12-30", "2027-01-05", "en")).toBe("Dec 30, 2026 – Jan 5, 2027");
    expect(rangeLabel("2026-10-18", "2026-10-18", "en")).toBe("Oct 18");
  });
  it("route and subline", () => {
    const q = { ...fixtureSnapshot().query, origins: ["HKG", "PVG"] };
    expect(routeLabel(q, "en")).toBe("HKG, PVG → SEA");
    expect(routeLabel(q, "zh")).toBe("HKG、PVG → SEA");
    expect(querySubline(q, "en")).toBe("Oct 1 – 30 · Business, First · 1 program");
    expect(querySubline({ ...q, programs: undefined, direct_only: true }, "zh")).toBe("10月1–30日 · 商务舱、头等舱 · 直飞");
  });
  it("the subline names every condition that changes the fetch; the More chip counts them", () => {
    const q = { ...fixtureSnapshot().query, programs: undefined, min_cabin_pct: 75, include_filtered: true, max_miles: 80000 };
    expect(querySubline(q, "en")).toBe("Oct 1 – 30 · Business, First · ≤ 80,000 miles · mixed cabin ≥ 75% · dynamic pricing included");
    expect(querySubline(q, "zh")).toBe("10月1–30日 · 商务舱、头等舱 · ≤ 80,000 里程 · 混合舱位 ≥ 75% · 含动态定价");
    expect(moreConditionsCount(q)).toBe(3);
    expect(moreConditionsCount(fixtureSnapshot().query)).toBe(0);
  });
  it("miles keep their digits grouped", () => {
    expect(formatMiles(75000)).toBe("75,000");
    expect(formatMiles(110000)).toBe("110,000");
  });
});

describe("coverage", () => {
  const snap = fixtureSnapshot();
  it("names the pairs: some not monitored, some not checked to the end, the rest checked", () => {
    const query = { ...snap.query, origins: ["HKG", "PVG"] };
    const mixed = coverageFor(query, [
      { origin: "HKG", dest: "SEA", unmonitored: false, evidence: { state: "complete", reason: "exhausted" } },
      { origin: "PVG", dest: "SEA", unmonitored: true, evidence: null },
    ]);
    expect(coverageNotices(mixed, 3, "en").map((n) => n.text)).toEqual(["These routes are not monitored by the data source. Not monitored: PVG → SEA."]);
    expect(coverageNotices(mixed, 0, "zh").map((n) => n.text)).toEqual(["数据源未监测这些机场对。未监测：PVG → SEA。", "已查询的范围内没有匹配结果。已查完：HKG → SEA。"]);
    const capped = coverageFor(query, [
      { origin: "HKG", dest: "SEA", unmonitored: false, evidence: { state: "partial", reason: "page_cap" } },
      { origin: "PVG", dest: "SEA", unmonitored: false, evidence: { state: "complete", reason: "exhausted" } },
    ]);
    expect(coverageNotices(capped, 2, "en").map((n) => n.text)).toEqual(["Results are incomplete. Not checked to the end: HKG → SEA."]);
  });
  it("complete with rows says nothing; complete and empty, partial, unknown and unmonitored each have their words", () => {
    expect(coverageLabel(snap.coverage, 3, "en")).toBeNull();
    expect(coverageLabel(snap.coverage, 0, "en")).toBe("No matches in the checked range.");
    expect(coverageLabel({ ...snap.coverage, state: "partial" }, 2, "en")).toBe("Results are incomplete.");
    expect(coverageLabel({ ...snap.coverage, state: "unknown", slices: [] }, 2, "zh")).toBe("完整性未知。");
    const unmonitored = { ...snap.coverage, slices: snap.coverage.slices.map((s) => ({ ...s, state: "unmonitored" as const, reason: "not_monitored" as const })) };
    expect(coverageLabel(unmonitored, 0, "en")).toBe("These routes are not monitored by the data source.");
  });
});

describe("order and names", () => {
  it("rows are shown in the query's order, unknown fees after known ones, ties by row key", () => {
    const snap = fixtureSnapshot();
    const byMiles = sortedRows(snap.rows, "miles_asc").map((r) => r.value.miles);
    expect(byMiles).toEqual([...byMiles].sort((a, b) => a - b));
    const byFees = sortedRows(snap.rows, "fees_asc").map((r) => r.value.fees_cents);
    expect(byFees.at(-1)).toBeNull();
    expect(byFees[0]).toBe(0);
  });
  it("two options on the same route, day and cabin get different names", () => {
    const [row] = fixtureSnapshot().rows;
    const other = { ...row!.value, program: "united", miles: 90000 };
    expect(resultName(row!.value, "en")).not.toBe(resultName(other, "en"));
    expect(resultName(row!.value, "en")).toBe("HKG → SEA, Sun, Oct 18, Business, Air Canada Aeroplan, 75,000 miles, Fees not yet confirmed, Seat count not provided");
    expect(resultName(row!.value, "zh")).toContain("，");
  });
});
