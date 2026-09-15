/**
 * The Search screen keeps the last search for Ask (design §6.1, §6.2): it opens on the last successful search, as typed
 * and as answered, and offers "Ask Claude about this search" whenever a result is shown.
 *
 * Rendered through react-dom/server under a router outlet, as the shell mounts it. Effects do not run there, so no key
 * is read and nothing is searched; the screen's first render is what is asserted. No DOM, no network, no clock.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Outlet, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { buildGrid } from "@awardgrid/core/grid/pivot";
import { QueryObject } from "@awardgrid/core/query/schema";
import type { AppServices } from "../app/bootstrap";
import { ASK_ABOUT_SEARCH } from "../ask/labels";
import { createLastSearch } from "../search/last-search";
import { SearchScreen } from "./SearchScreen";

const TEXT = "SEA to TYO 2026-10-01 to 2026-10-30 business";

function render(lastSearch = createLastSearch()): string {
  const services = { lastSearch } as unknown as AppServices;
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(Routes, null, createElement(Route, { path: "/", element: createElement(Outlet, { context: services }) }, createElement(Route, { index: true, element: createElement(SearchScreen) }))),
    ),
  );
}

describe("SearchScreen and the last search", () => {
  it("opens on the last successful search, with its grid and a link to Ask about it", () => {
    const query = QueryObject.parse({ origins: ["SEA"], destinations: ["NRT", "HND"], date_from: "2026-10-01", date_to: "2026-10-30", cabins: ["J"], raw_text: TEXT, language: "en" });
    const lastSearch = createLastSearch();
    lastSearch.set({
      text: TEXT,
      value: {
        grid: buildGrid([], query, { now: new Date("2026-10-01T00:00:00.000Z") }),
        query,
        warnings: [],
        notices: [],
        quota: { used: 12, remaining: 988, softLimit: 950, resetAt: "2026-10-02T00:00:00.000Z" },
        served_from_cache: false,
        api_calls_used: 1,
        fetched_at_min: null,
      },
    });
    const html = render(lastSearch);
    expect(html).toContain(`>${TEXT}</textarea>`);
    expect(html).toContain("No availability for that query.");
    expect(html).toContain("Watch this search");
    expect(html).toContain(`<a class="ag-button" href="/ask" data-discover="true">${ASK_ABOUT_SEARCH}</a>`);
    expect(html.indexOf("Watch this search")).toBeLessThan(html.indexOf(ASK_ABOUT_SEARCH));
  });

  it("with no search yet: the first example, no result, and no link to Ask", () => {
    const html = render();
    expect(html).toContain(">HKG, SHA to SEA, next 30 days, business and first</textarea>");
    expect(html).not.toContain(ASK_ABOUT_SEARCH);
    expect(html).not.toContain("Watch this search");
  });
});
