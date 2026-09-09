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

// ---------------------------------------------------------------------------
// Per-cabin labels (docs/UI_PLAN.md §6.2b)
// ---------------------------------------------------------------------------

describe("cellAriaLabel (per cabin)", () => {
  const j = makeRow({ origin: "SEA", dest: "NRT", cabin: "J", miles: 60_000, fees_cents: 560, seats_left: 2, computed_last_seen: minus(2 * H) });
  const f = makeRow({ origin: "SEA", dest: "NRT", cabin: "F", miles: 80_000, fees_cents: 5_600, currency: "EUR", seats_left: 1, program: "aeroplan", computed_last_seen: minus(45 * 60_000) });
  const slots = (...s: Array<{ cabin: "J" | "F"; row: typeof j | null; filtered?: boolean }>) =>
    s.map((x) => ({ cabin: x.cabin, row: x.row, filtered: x.filtered ?? false }));

  it("names each cabin in turn, in en and zh", () => {
    const c = cell({ best: j, all: [j, f] });
    expect(cellAriaLabel(c, "en", en, NOW, { cabins: ["J", "F"], perCabin: slots({ cabin: "J", row: j }, { cabin: "F", row: f }) })).toBe(
      "SEA to NRT, October 15. business, 60,000 miles, $5.60 fees, 2 seats, Alaska, seen 2 hours ago. first, 80,000 miles, 56.00 EUR fees, 1 seat, Aeroplan, seen 45 minutes ago.",
    );
    expect(cellAriaLabel(c, "zh", zh, NOW, { cabins: ["J", "F"], perCabin: slots({ cabin: "J", row: j }, { cabin: "F", row: f }) })).toBe(
      "SEA 到 NRT，10月15日。商务舱，60,000 里程，税费 $5.60，2 个座位，Alaska，2 小时前查看。头等舱，80,000 里程，税费 56.00 EUR，1 个座位，Aeroplan，45 分钟前查看。",
    );
  });

  it("REGRESSION: two clause groups in one sentence must not leak a sentinel (aria.ts's RegExp has no g flag)", () => {
    const a = makeRow({ origin: "SEA", dest: "NRT", cabin: "J", miles: 60_000, fees_cents: null, seats_left: 0, computed_last_seen: minus(2 * H) });
    const b = makeRow({ origin: "SEA", dest: "NRT", cabin: "F", miles: 80_000, fees_cents: null, seats_left: 0, program: "aeroplan", computed_last_seen: minus(45 * 60_000) });
    for (const [locale, t] of [["en", en], ["zh", zh]] as const) {
      const label = cellAriaLabel(cell({ best: a, all: [a, b] }), locale, t, NOW, { cabins: ["J", "F"], perCabin: slots({ cabin: "J", row: a }, { cabin: "F", row: b }) });
      expect(label, locale).not.toMatch(/[\uE000-\uE002]/);
    }
    expect(cellAriaLabel(cell({ best: a, all: [a, b] }), "en", en, NOW, { cabins: ["J", "F"], perCabin: slots({ cabin: "J", row: a }, { cabin: "F", row: b }) })).toBe(
      "SEA to NRT, October 15. business, 60,000 miles, seats unknown, Alaska, seen 2 hours ago. first, 80,000 miles, seats unknown, Aeroplan, seen 45 minutes ago.",
    );
  });

  it("an empty slot announces its own cabin, not the cell-level state", () => {
    const c = cell({ best: j, all: [j] });
    expect(cellAriaLabel(c, "en", en, NOW, { cabins: ["J", "F"], perCabin: slots({ cabin: "J", row: j }, { cabin: "F", row: null }) })).toBe(
      "SEA to NRT, October 15. business, 60,000 miles, $5.60 fees, 2 seats, Alaska, seen 2 hours ago. first, no availability.",
    );
    expect(cellAriaLabel(c, "zh", zh, NOW, { cabins: ["J", "F"], perCabin: slots({ cabin: "J", row: j }, { cabin: "F", row: null }) })).toContain("头等舱，无可用。");
  });

  it("stale and unknown freshness land on their own cabin's clause only", () => {
    const stale = makeRow({ origin: "SEA", dest: "NRT", cabin: "J", miles: 60_000, fees_cents: 560, seats_left: 2, computed_last_seen: minus(26 * H) });
    expect(cellAriaLabel(cell({ best: stale, all: [stale, f] }), "en", en, NOW, { cabins: ["J", "F"], perCabin: slots({ cabin: "J", row: stale }, { cabin: "F", row: f }) })).toBe(
      "SEA to NRT, October 15. business, 60,000 miles, $5.60 fees, 2 seats, Alaska, seen 1 day ago, stale. first, 80,000 miles, 56.00 EUR fees, 1 seat, Aeroplan, seen 45 minutes ago.",
    );
    const bad = makeRow({ origin: "SEA", dest: "NRT", cabin: "J", miles: 60_000, fees_cents: 560, seats_left: 2, computed_last_seen: "garbage" });
    expect(cellAriaLabel(cell({ best: bad, all: [bad, f] }), "en", en, NOW, { cabins: ["J", "F"], perCabin: slots({ cabin: "J", row: bad }, { cabin: "F", row: f }) })).toBe(
      "SEA to NRT, October 15. business, 60,000 miles, $5.60 fees, 2 seats, Alaska, freshness unknown. first, 80,000 miles, 56.00 EUR fees, 1 seat, Aeroplan, seen 45 minutes ago.",
    );
  });

  it("a filtered slot says 'dynamic' on that cabin only", () => {
    const dyn = makeRow({ origin: "SEA", dest: "NRT", cabin: "F", miles: 90_000, fees_cents: 560, seats_left: 2, dynamic: true, computed_last_seen: minus(2 * H) });
    expect(cellAriaLabel(cell({ status: "filtered", best: j, all: [j, dyn] }), "en", en, NOW, { cabins: ["J", "F"], perCabin: slots({ cabin: "J", row: j }, { cabin: "F", row: dyn, filtered: true }) })).toBe(
      "SEA to NRT, October 15. business, 60,000 miles, $5.60 fees, 2 seats, Alaska, seen 2 hours ago. first, 90,000 miles, $5.60 fees, 2 seats, Alaska, seen 2 hours ago, dynamic.",
    );
  });

  it("with perCabin omitted every status reads exactly as it did before the mode existed", () => {
    const statuses = ["ok", "filtered", "none", "unmonitored", "not_fetched", "loading"] as const;
    expect(statuses.map((status) => cellAriaLabel(cell({ status, best: status === "none" || status === "loading" ? null : j, all: [j] }), "en", en, NOW, { cabins: ["J", "F"] }))).toMatchInlineSnapshot(`
      [
        "SEA to NRT, October 15, business, 60,000 miles, $5.60 fees, 2 seats, Alaska, seen 2 hours ago.",
        "SEA to NRT, October 15, business, 60,000 miles, $5.60 fees, 2 seats, Alaska, seen 2 hours ago, dynamic.",
        "SEA to NRT, October 15, business and first, No availability.",
        "SEA to NRT, October 15, business and first, Not monitored by seats.aero.",
        "SEA to NRT, October 15, business and first, Not fetched.",
        "SEA to NRT, October 15, business and first, Loading.",
      ]
    `);
  });
});
