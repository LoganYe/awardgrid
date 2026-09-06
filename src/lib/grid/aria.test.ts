import { describe, expect, it } from "vitest";
import { NOW, makeRow } from "../../../test/fixtures/grid/rows";
import { translator } from "@/lib/i18n";
import { cellAriaLabel } from "@/lib/grid/aria";
import type { GridCell } from "@/lib/grid/types";

const en = translator("en");
const zh = translator("zh");
const H = 3_600_000;
const minus = (ms: number) => new Date(Date.parse(NOW) - ms).toISOString();

function cell(over: Partial<GridCell> = {}): GridCell {
  const best = makeRow({ origin: "SEA", dest: "NRT", miles: 60_000, fees_cents: 560, seats_left: 2, computed_last_seen: minus(2 * H) });
  return { origin: "SEA", dest: "NRT", date: "2026-10-15", status: "ok", best, all: [best], ...over };
}

describe("cellAriaLabel (available)", () => {
  it("reads exactly as the spec sentence in English", () => {
    expect(cellAriaLabel(cell(), "en", en, NOW)).toBe(
      "SEA to NRT, October 15, business, 60,000 miles, $5.60 fees, 2 seats, Alaska, seen 2 hours ago.",
    );
  });

  it("zh variant with full-width punctuation", () => {
    expect(cellAriaLabel(cell(), "zh", zh, NOW)).toBe(
      "SEA 到 NRT，10月15日，商务舱，60,000 里程，税费 $5.60，2 个座位，Alaska，2 小时前查看。",
    );
  });

  it("first cabin, one seat, non-USD fees, minutes", () => {
    const best = makeRow({ origin: "SEA", dest: "NRT", cabin: "F", miles: 80_000, fees_cents: 5_600, currency: "EUR", seats_left: 1, program: "aeroplan", computed_last_seen: minus(45 * 60_000) });
    expect(cellAriaLabel(cell({ best, all: [best] }), "en", en, NOW)).toBe(
      "SEA to NRT, October 15, first, 80,000 miles, 56.00 EUR fees, 1 seat, Aeroplan, seen 45 minutes ago.",
    );
  });

  it("stale adds ', stale' after the age", () => {
    const best = makeRow({ origin: "SEA", dest: "NRT", computed_last_seen: minus(26 * H), miles: 60_000, fees_cents: 560 });
    expect(cellAriaLabel(cell({ best, all: [best] }), "en", en, NOW)).toBe(
      "SEA to NRT, October 15, business, 60,000 miles, $5.60 fees, 2 seats, Alaska, seen 1 day ago, stale.",
    );
    expect(cellAriaLabel(cell({ best, all: [best] }), "zh", zh, NOW)).toBe(
      "SEA 到 NRT，10月15日，商务舱，60,000 里程，税费 $5.60，2 个座位，Alaska，1 天前查看，已过期。",
    );
  });

  it("unknown freshness replaces the age clause; unknown fees drop theirs; unknown seats say so", () => {
    const best = makeRow({ origin: "SEA", dest: "NRT", computed_last_seen: "garbage", miles: 60_000, fees_cents: null, seats_left: 0 });
    expect(cellAriaLabel(cell({ best, all: [best] }), "en", en, NOW)).toBe(
      "SEA to NRT, October 15, business, 60,000 miles, seats unknown, Alaska, freshness unknown.",
    );
    expect(cellAriaLabel(cell({ best, all: [best] }), "zh", zh, NOW)).toBe(
      "SEA 到 NRT，10月15日，商务舱，60,000 里程，座位数未知，Alaska，数据时间未知。",
    );
  });

  it("filtered (dynamic pricing hidden) appends the dynamic tag", () => {
    const best = makeRow({ origin: "SEA", dest: "NRT", miles: 60_000, fees_cents: 560, dynamic: true, computed_last_seen: minus(2 * H) });
    expect(cellAriaLabel(cell({ status: "filtered", best, all: [best] }), "en", en, NOW)).toBe(
      "SEA to NRT, October 15, business, 60,000 miles, $5.60 fees, 2 seats, Alaska, seen 2 hours ago, dynamic.",
    );
  });
});

describe("cellAriaLabel (other states)", () => {
  const empty = (status: GridCell["status"], reason?: string): GridCell => ({
    origin: "SEA",
    dest: "NRT",
    date: "2026-10-15",
    status,
    best: null,
    all: [],
    ...(reason ? { reason } : {}),
  });

  it("none / not monitored / not fetched / loading, naming the grid's cabins", () => {
    const o = { cabins: ["J", "F"] as const };
    expect(cellAriaLabel(empty("none"), "en", en, NOW, o)).toBe("SEA to NRT, October 15, business and first, No availability.");
    expect(cellAriaLabel(empty("unmonitored"), "en", en, NOW, o)).toBe("SEA to NRT, October 15, business and first, Not monitored by seats.aero.");
    expect(cellAriaLabel(empty("not_fetched"), "en", en, NOW, o)).toBe("SEA to NRT, October 15, business and first, Not fetched.");
    expect(cellAriaLabel(empty("not_fetched", "grid.cell.not_fetched_quota"), "en", en, NOW, o)).toBe(
      "SEA to NRT, October 15, business and first, Not fetched: seats.aero daily limit reached.",
    );
    expect(cellAriaLabel(empty("not_fetched", "not.a.key"), "en", en, NOW, o)).toBe("SEA to NRT, October 15, business and first, Not fetched.");
    expect(cellAriaLabel(empty("loading"), "en", en, NOW, o)).toBe("SEA to NRT, October 15, business and first, Loading.");
  });

  it("omits the cabin clause when no cabins are given; zh", () => {
    expect(cellAriaLabel(empty("none"), "en", en, NOW)).toBe("SEA to NRT, October 15, No availability.");
    expect(cellAriaLabel(empty("unmonitored"), "zh", zh, NOW, { cabins: ["J"] })).toBe("SEA 到 NRT，10月15日，商务舱，seats.aero 未监控此航线。");
  });
});
