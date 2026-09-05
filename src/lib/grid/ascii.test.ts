import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NOW, makeQuery, makeRow } from "../../../test/fixtures/grid/rows";
import { displayWidth, formatFees, formatMilesCompact, renderAscii } from "@/lib/grid/ascii";
import { buildGrid } from "@/lib/grid/pivot";

const fixture = (name: string) =>
  readFileSync(new URL(`../../../test/fixtures/grid/${name}`, import.meta.url), "utf8");

const q = makeQuery({ origins: ["HKG", "PVG"], date_to: "2026-10-16" });
const rows = [
  makeRow({ origin: "HKG", program: "alaska", miles: 80_000, fees_cents: 5_600, seats_left: 2 }),
  makeRow({
    origin: "HKG",
    date: "2026-10-16",
    program: "american",
    miles: 112_500,
    fees_cents: null,
    seats_left: 0,
    computed_last_seen: "2026-09-28T12:00:00.000Z",
  }),
];

describe("formatting helpers", () => {
  it("compact miles", () => {
    expect(formatMilesCompact(80_000)).toBe("80k");
    expect(formatMilesCompact(112_500)).toBe("112.5k");
    expect(formatMilesCompact(7_500)).toBe("7.5k");
    expect(formatMilesCompact(500)).toBe("500");
    expect(formatMilesCompact(112_250)).toBe("112.3k");
  });

  it("fees", () => {
    expect(formatFees(5_600, "USD")).toBe("$56");
    expect(formatFees(5_649, null)).toBe("$56");
    expect(formatFees(null, "USD")).toBe("—");
    expect(formatFees(12_000, "EUR")).toBe("120 EUR");
  });

  it("displayWidth counts CJK as two columns", () => {
    expect(displayWidth("abc")).toBe(3);
    expect(displayWidth("日期")).toBe(4);
  });
});

describe("renderAscii", () => {
  it("renders a 2x2 grid exactly (dates orientation, unmonitored + none + stale)", () => {
    const grid = buildGrid(rows, q, {
      now: NOW,
      unmonitored_pairs: [{ origin: "PVG", dest: "SEA" }],
    });
    expect(renderAscii(grid, { now: NOW })).toBe(fixture("ascii-2x2.txt"));
  });

  it("renders the routes orientation with a route label column", () => {
    const grid = buildGrid(rows, q, { now: NOW, orientation: "routes" });
    expect(renderAscii(grid, { now: NOW })).toBe(fixture("ascii-2x2-routes.txt"));
  });

  it("chunks columns into several tables when wider than `width`", () => {
    const grid = buildGrid(rows, q, { now: NOW });
    expect(renderAscii(grid, { now: NOW, width: 40 })).toBe(fixture("ascii-2x2-wrapped.txt"));
  });

  it("zh legend and labels", () => {
    const grid = buildGrid(rows, makeQuery({ date_to: "2026-10-15" }), { now: NOW });
    const out = renderAscii(grid, { now: NOW, lang: "zh" });
    expect(out.startsWith("日期        HKG-SEA\n")).toBe(true);
    expect(out).toContain("80k · $56 · 2 · alaska · 2小时");
    expect(out).toContain("数据来源: seats.aero");
  });
});
