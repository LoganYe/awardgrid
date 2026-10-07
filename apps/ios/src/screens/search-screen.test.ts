/**
 * The Search screen (UI/UX v1 T07): with a shown snapshot it is the results stack — query summary, cards, status,
 * the ways to search again, watch and ask; without one, a text search and the way into the editor. The last search is
 * what Ask is offered, and the screen marks itself with its language. Replaces the pre-T07 layout test (DECISIONS
 * U-025).
 *
 * Rendered through react-dom/server under a router outlet, as the shell mounts it. Effects do not run there, so no key
 * is read and nothing is searched; the screen's first render is what is asserted. No DOM, no network.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Outlet, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { fixtureSnapshot } from "@awardgrid/core/test-fixtures/uiux/factory";
import type { ResultSnapshot, WorkspaceState } from "@awardgrid/core/workspace/types";
import type { AppServices } from "../app/bootstrap";
import { ASK_ABOUT_SEARCH } from "../ask/labels";
import type { LastSearchEntry, LastSearchStore } from "../search/last-search";
import { searchViewFromSnapshot } from "../workspace/snapshot-view";
import { DEFAULT_PREFERENCES } from "../workspace/workspace-store";
import { SearchScreen } from "./SearchScreen";

const NOW = new Date("2026-10-18T08:30:00.000Z");

function render(opts: { snapshot?: ResultSnapshot | null; entry?: LastSearchEntry | null; locale?: "en" | "zh" } = {}): string {
  const snapshot = opts.snapshot ?? null;
  const state: WorkspaceState = {
    revision: snapshot ? 1 : 0,
    draft: null,
    run: { kind: "idle" },
    displayedSnapshot: snapshot,
    previousSnapshot: null,
    selected: [],
    preferences: DEFAULT_PREFERENCES,
  };
  const workspace = { subscribe: () => () => {}, getState: () => state };
  const lastSearch: LastSearchStore = { get: () => opts.entry ?? null, set: () => {} };
  const ask = { subscribe: () => () => {}, isRunning: () => false };
  // T22: the screen reads which options are saved on their own (U-057); none here.
  const favorites = { subscribe: () => () => {}, all: () => [] };
  const services = { lastSearch, workspace, ask, favorites, now: () => NOW, locale: opts.locale ?? "en" } as unknown as AppServices;
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(Routes, null, createElement(Route, { path: "/", element: createElement(Outlet, { context: services }) }, createElement(Route, { index: true, element: createElement(SearchScreen) }))),
    ),
  );
}

const shown = () => {
  const snapshot = fixtureSnapshot();
  return { snapshot, entry: { text: snapshot.query.raw_text, value: searchViewFromSnapshot(snapshot) } };
};

describe("SearchScreen with a shown search", () => {
  it("shows the query summary, one card per result, the status line with its attribution, and the actions", () => {
    const html = render(shown());
    expect(html).toContain('data-testid="query-summary"');
    expect(html.match(/data-testid="availability-card"/g)).toHaveLength(fixtureSnapshot().rows.length);
    // "Data: seats.aero", the name linking to seats.aero (Safari), beside the results.
    expect(html).toContain('Data: <a class="ag-attribution-link" href="https://seats.aero" target="_blank" rel="noreferrer noopener">seats.aero');
    expect(html).toContain(`>${ASK_ABOUT_SEARCH}</a>`);
    expect(html).toContain(">Watch this search<");
    expect(html).toContain(">Search again<");
    expect(html).toMatch(/<a\b[^>]*href="\/ask"[^>]*>.*AI assistance/);
    expect(html).not.toContain('id="q"');
  });

  it("dates a restored snapshot as saved, by the app's clock, and never says calls it does not know", () => {
    const { snapshot, entry } = shown();
    const html = render({ snapshot, entry: { ...entry, savedAt: "2026-10-18T06:30:00.000Z" } });
    expect(html).toContain("saved on this device 2 h ago");
    expect(html).not.toMatch(/\d+ seats\.aero calls?/);
  });

  it("a fresh answer says how many calls it cost, or that the count is not known; a cache hit says how old it is", () => {
    const { snapshot, entry } = shown();
    expect(render({ snapshot, entry: { ...entry, value: { ...entry.value, served_from_cache: false, api_calls_used: 3 } } })).toContain("3 seats.aero calls");
    const unknown = render({ snapshot, entry: { ...entry, value: { ...entry.value, served_from_cache: false, api_calls_used: null } } });
    expect(unknown).toContain("seats.aero calls not known");
    expect(unknown).not.toMatch(/\d+ seats\.aero calls?/);
    const cached = render({ snapshot, entry: { ...entry, value: { ...entry.value, served_from_cache: true, fetched_at_min: "2026-10-18T08:00:00.000Z" } } });
    expect(cached).toContain("from this device&#x27;s cache, fetched 30 min ago");
  });

  it("a saved time later than the clock is not shown as an age", () => {
    const { snapshot, entry } = shown();
    expect(render({ snapshot, entry: { ...entry, savedAt: "2026-10-19T00:00:00.000Z" } })).toMatch(/saved on this device<\/span>|saved on this device</);
  });

  it("speaks Chinese when asked, and says so", () => {
    const html = render({ ...shown(), locale: "zh" });
    expect(html).toMatch(/<div class="ag-results" lang="zh-CN"/);
    expect(html).toContain(">查票</h1>");
    expect(html).toContain('数据：<a class="ag-attribution-link" href="https://seats.aero"');
  });
});

describe("SearchScreen with no search yet", () => {
  it("offers a text search with an example and the way into the editor, and no Ask link", () => {
    const html = render();
    expect(html).toContain(">HKG, SHA to SEA, next 30 days, business and first</textarea>");
    expect(html).toMatch(/<a\b[^>]*href="\/edit"[^>]*>Build a search<\/a>/);
    expect(html).not.toContain(ASK_ABOUT_SEARCH);
    expect(html).not.toContain("Watch this search");
  });
});
