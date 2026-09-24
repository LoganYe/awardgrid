/**
 * The List and Calendar views' first render (UI/UX v1 T08), through react-dom/server: no DOM, no effects, no
 * network. What the browser spec cannot reach with the one-month fixture range — month arrows over a two-month
 * range, week alignment in both column orders — and the fee groups of the list.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fixturePrefs, fixtureQuery, fixtureSnapshot } from "@awardgrid/core/test-fixtures/uiux/factory";
import { projectResults } from "@awardgrid/core/workspace/projection";
import type { ResultSnapshot } from "@awardgrid/core/workspace/types";
import { AvailabilityCalendar } from "./AvailabilityCalendar";
import { AvailabilityList } from "./AvailabilityList";
import { AvailabilityMatrix } from "./AvailabilityMatrix";

const NOW = "2026-10-18T08:30:00.000Z";

function calendar(snapshot: ResultSnapshot, locale: "en" | "zh" = "en", prefs = fixturePrefs()): string {
  const p = projectResults(snapshot, prefs);
  return renderToStaticMarkup(
    createElement(AvailabilityCalendar, {
      query: snapshot.query,
      days: p.days,
      rows: p.rows,
      sort: "miles_asc",
      onCabin: () => {},
      snapshotId: snapshot.id,
      selected: new Set<string>(),
      onToggle: () => {},
      now: NOW,
      locale,
    }),
  );
}

describe("AvailabilityCalendar", () => {
  /** The whole opening tag of the arrow with this name. */
  const arrow = (html: string, name: string) => html.match(new RegExp(`<button[^>]*aria-label="${name}"[^>]*>`))![0];

  it("over two months: arrows that stay focusable, the one at the range's end marked disabled, opening on the month with the first result", () => {
    const html = calendar(fixtureSnapshot({ query: { ...fixtureQuery(), date_to: "2026-11-20" } }));
    expect(arrow(html, "Previous month")).toContain('aria-disabled="true"');
    expect(arrow(html, "Next month")).not.toContain("aria-disabled");
    // Never the native attribute: a disabled button drops keyboard focus to the page when it is the one just pressed.
    expect(arrow(html, "Previous month")).not.toMatch(/\sdisabled=/);
    expect(html).toContain(">October 2026</h2>");
  });

  it("opening on the range's last month, Next is the one marked disabled", () => {
    const query = { ...fixtureQuery(), date_from: "2026-09-20", date_to: "2026-10-30" };
    const html = calendar(fixtureSnapshot({ query }));
    expect(html).toContain(">October 2026</h2>");
    expect(arrow(html, "Next month")).toContain('aria-disabled="true"');
    expect(arrow(html, "Previous month")).not.toContain("aria-disabled");
  });

  it("each kind of empty day has its own mark and legend: hidden by the filter, no matches, not monitored", () => {
    const filtered = calendar(fixtureSnapshot(), "en", fixturePrefs({ localFilter: { maxMiles: 80000 } }));
    expect(filtered).toMatch(/data-date="2026-10-20"[^>]*data-empty="hidden"/);
    expect(filtered).toContain('<span class="sr-only">Tue, Oct 20: hidden by your view filter</span>');
    expect(filtered).toContain("<span>∗ hidden by your view filter</span>");
    expect(filtered).toContain("<span>– no matches</span>");
    const base = fixtureSnapshot({ rows: [] });
    const unmonitored = { ...base, coverage: { ...base.coverage, slices: base.coverage.slices.map((s) => ({ ...s, state: "unmonitored" as const, reason: "not_monitored" as const })) } };
    const html = calendar(unmonitored);
    expect(html).toContain("<span>⊘ not monitored</span>");
    expect(html).not.toContain("no matches");
    // No day to choose: no "choose a day" hint.
    expect(html).not.toContain("Choose a day");
  });

  it("one month: no arrows", () => {
    const html = calendar(fixtureSnapshot());
    expect(html).not.toContain("Previous month");
    expect(html).not.toContain("Next month");
  });

  it("1 October 2026 is a Thursday: column 5 with Sunday first, column 4 with Monday first", () => {
    const firstWeek = (html: string) => html.match(/<tbody><tr>(.*?)<\/tr>/)![1]!.split("<td").slice(1);
    const en = firstWeek(calendar(fixtureSnapshot()));
    expect(en.findIndex((cell) => cell.includes('data-date="2026-10-01"'))).toBe(4);
    const zh = firstWeek(calendar(fixtureSnapshot(), "zh"));
    expect(zh.findIndex((cell) => cell.includes('data-date="2026-10-01"'))).toBe(3);
  });

  it("a day with options is a named button with its compact minimum; an empty day is not a button", () => {
    const html = calendar(fixtureSnapshot());
    expect(html).toMatch(/<button[^>]*data-date="2026-10-18"[^>]*aria-pressed="false"[^>]*aria-label="Sun, Oct 18: lowest 75,000 miles, 1 option"/);
    expect(html).toContain('<span class="ag-cal-min">75K</span>');
    expect(html).not.toContain("ag-cal-approx");
    expect(html).not.toMatch(/<button[^>]*data-date="2026-10-01"/);
    expect(html).toContain('<span class="sr-only">Thu, Oct 1: no matches</span>');
  });
});

describe("AvailabilityList", () => {
  it("under the fee sort, each currency is its own named group; otherwise no groups", () => {
    const base = fixtureSnapshot();
    const cad = { ...base.rows[2]!, key: `${base.rows[2]!.key}-cad`, value: { ...base.rows[2]!.value, source_id: "cad", currency: "CAD" } };
    const snapshot = { ...base, rows: [...base.rows, cad] };
    const render = (sort: "fees_asc" | "miles_asc") =>
      renderToStaticMarkup(
        createElement(AvailabilityList, {
          rows: projectResults(snapshot, fixturePrefs({ sort })).rows,
          sort,
          snapshotId: snapshot.id,
          selected: new Set<string>(),
          onToggle: () => {},
          now: NOW,
          locale: "en",
        }),
      );
    const grouped = render("fees_asc");
    expect([...grouped.matchAll(/data-fee-group="([^"]+)"/g)].map((m) => m[1])).toEqual(["CAD", "USD", "unknown"]);
    expect(grouped).toContain(">Fees in CAD</p>");
    expect(grouped).toContain(">Fees not yet confirmed</p>");
    expect(render("miles_asc")).not.toContain("data-fee-group");
  });
});

describe("AvailabilityCalendar rounding", () => {
  it("a number rounded to fit is marked ≈ and explained; the name keeps the exact miles", () => {
    const base = fixtureSnapshot();
    const odd = { ...base.rows[0]!, value: { ...base.rows[0]!.value, miles: 68450 } };
    const html = calendar({ ...base, rows: [odd, ...base.rows.slice(1)] });
    expect(html).toMatch(/aria-label="Sun, Oct 18: lowest 68,450 miles, 1 option"[^>]*>.*?<span class="ag-cal-min">68\.5K<\/span><span class="ag-cal-approx">≈<\/span>/);
    expect(html).toContain("≈ rounded up; choose the day for exact miles");
  });
});

describe("AvailabilityMatrix selection", () => {
  /** Oct 18 Business: Aeroplan 75,000 (shown, the lowest) and United 90,000, in a search over all programs. */
  function withTwo() {
    const base = fixtureSnapshot({ query: { ...fixtureQuery(), programs: undefined } });
    const aeroplan = base.rows.find((r) => r.value.date === "2026-10-18" && r.value.cabin === "J")!;
    const united = { ...aeroplan, key: `${aeroplan.key}-united`, value: { ...aeroplan.value, program: "united", source_id: "united-1", miles: 90000 } };
    return { snapshot: { ...base, rows: [...base.rows, united] }, aeroplan, united };
  }
  const render = (snapshot: ResultSnapshot, selected: string[]) =>
    renderToStaticMarkup(
      createElement(AvailabilityMatrix, {
        snapshot,
        projected: projectResults(snapshot, fixturePrefs()),
        sort: "miles_asc",
        selected: new Set(selected),
        onToggle: () => {},
        now: NOW,
        locale: "en",
      }),
    );
  const oct18 = (html: string) => html.match(/<td[^>]*data-date="2026-10-18"[^>]*>.*?<\/td>/)![0];

  it("the frame and tick mark the option the slot shows, and its name says selected", () => {
    const { snapshot, aeroplan } = withTwo();
    const cell = oct18(render(snapshot, [aeroplan.key]));
    expect(cell).toMatch(/class="ag-mx-slot" data-state="results" data-selected="true"><span class="ag-mx-line"><span class="ag-mx-miles">75,000<\/span><span class="ag-mx-cabin">J<\/span><span class="ag-mx-tick">✓<\/span>/);
    expect(cell).toMatch(/aria-label="[^"]*seat count not provided, selected; First F/);
  });

  it("another selected option of the slot is said in words, never as a tick beside the shown one", () => {
    const { snapshot, united } = withTwo();
    const cell = oct18(render(snapshot, [united.key]));
    expect(cell).not.toContain("data-selected");
    expect(cell).not.toContain("✓");
    expect(cell).toContain('<span class="ag-mx-others">1 other selected</span>');
    expect(cell).toMatch(/aria-label="[^"]*seat count not provided, 1 other option selected; First F/);
  });
});

