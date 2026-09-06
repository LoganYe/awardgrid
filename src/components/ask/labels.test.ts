import { describe, expect, it } from "vitest";
import type { AskCellContext } from "@/app/api/ask/wire";
import { cellPillLabel, formatPillDateRange, gridPillLabel, routeCount, toolLabel, toolLabels, TOOL_LABEL_KEYS } from "./labels";
import { en } from "@/lib/i18n/dictionaries/en";
import { zh } from "@/lib/i18n/dictionaries/zh";
import { translator } from "@/lib/i18n";
import { QueryObject } from "@/lib/query/schema";

const t = translator("en");
const tz = translator("zh");

const query = QueryObject.parse({
  origins: ["HKG", "PVG", "NRT", "ICN"],
  destinations: ["SEA"],
  date_from: "2026-10-01",
  date_to: "2026-10-30",
  cabins: ["J", "F"],
  raw_text: "x",
  language: "en",
});

const cell: AskCellContext = {
  origin: "SEA",
  dest: "NRT",
  date: "2026-10-15",
  cabin: "F",
  program: "alaska",
  miles: 80000,
  fees_cents: 560,
  seats_left: 2,
  source_id: "abc",
};

describe("context pill labels", () => {
  it("renders the plan's grid pill verbatim, with commas and no separator glyph", () => {
    expect(gridPillLabel(query, t, "en")).toBe("Current grid: 4 routes, Oct 1–30, J and F");
    expect(gridPillLabel(query, t, "en")).not.toContain(" · ");
  });

  it("renders the spec's selected-cell pill verbatim", () => {
    expect(cellPillLabel(cell, t, "en")).toBe("Selected: SEA→NRT Oct 15 F 80,000 Alaska");
  });

  it("counts one route pair per origin × destination", () => {
    expect(routeCount(query)).toBe(4);
    expect(gridPillLabel({ ...query, destinations: ["SEA", "LAX"] }, t, "en")).toContain("8 routes");
    expect(gridPillLabel({ ...query, origins: ["HKG"] }, t, "en")).toContain("1 route,");
  });

  it("keeps the month once inside one month and spells both across two", () => {
    expect(formatPillDateRange("2026-10-01", "2026-10-30", "en")).toBe("Oct 1–30");
    expect(formatPillDateRange("2026-10-28", "2026-11-05", "en")).toBe("Oct 28–Nov 5");
    expect(formatPillDateRange("2026-10-15", "2026-10-15", "en")).toBe("Oct 15");
  });

  it("translates the label and its punctuation in Chinese", () => {
    const label = gridPillLabel(query, tz, "zh");
    expect(label.startsWith(`${zh["ask.context.query"]}：`)).toBe(true);
    expect(label).toContain("4 条航线");
    expect(label).toContain("，");
    expect(label).not.toContain(" · ");
    expect(label).toContain("J");
    expect(label).toContain("F");
    expect(cellPillLabel(cell, tz, "zh")).toContain("SEA→NRT");
  });
});

describe("tool labels", () => {
  it("maps the toolkit's tools to the spec's sentences", () => {
    expect(toolLabel("seats-aero-cached-search", t)).toBe("Checked seats.aero cached search");
    expect(toolLabel("travel-hacker:transfer-partners", t)).toBe("Read transfer-partners");
    expect(toolLabel("Bash", t)).toBe(en["ask.tool.bash"]);
    expect(toolLabel("Grep", t)).toBe(en["ask.tool.search"]);
    expect(toolLabel("mcp__kiwi__search", t)).toBe("Searched kiwi");
  });

  it("shows an unknown tool name verbatim rather than a key", () => {
    expect(toolLabel("SomeNewTool", t)).toBe("SomeNewTool");
    expect(toolLabel("   ", t)).toBe("");
  });

  it("keeps first-seen order and drops empties", () => {
    expect(toolLabels(["Bash", "", "SomeNewTool"], t)).toEqual([en["ask.tool.bash"], "SomeNewTool"]);
  });

  it("has every label key in both dictionaries", () => {
    for (const key of TOOL_LABEL_KEYS) {
      expect(en[key], key).toBeTruthy();
      expect((zh as Record<string, string>)[key], key).toBeTruthy();
    }
  });
});
