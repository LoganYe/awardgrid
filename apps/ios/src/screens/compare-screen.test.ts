/**
 * The comparison's markup for what the browser cannot easily reach (T12): an option whose snapshot has been evicted
 * is shown from the copy kept when it was chosen, labelled so, and never offered a load it cannot make; the same row
 * from two searches reads as two numbered options, each saying which search.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Outlet, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { fixtureQuery, fixtureSnapshot, FIXTURE_NOW } from "@awardgrid/core/test-fixtures/uiux/factory";
import type { SearchPort } from "@awardgrid/core/workspace/types";
import type { AppServices } from "../app/bootstrap";
import { WorkspaceStore } from "../workspace/workspace-store";
import { CompareScreen } from "./CompareScreen";

/** A store whose searches answer at once, each with the next id and a creation time an hour after the last. */
function store() {
  let n = 0;
  const search: SearchPort = {
    execute: async (query, run) => {
      n += 1;
      return fixtureSnapshot({ id: `s${n}`, revision: run.revision, query, createdAt: `2026-10-18T${String(n).padStart(2, "0")}:00:00.000Z` });
    },
  };
  return new WorkspaceStore({ search, now: () => FIXTURE_NOW });
}

function render(workspace: WorkspaceStore) {
  const services = { workspace, details: { peek: () => null }, locale: "en", now: () => new Date(FIXTURE_NOW) } as unknown as AppServices;
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: ["/compare"] },
      createElement(Routes, null, createElement(Route, { path: "/", element: createElement(Outlet, { context: services }) }, createElement(Route, { path: "compare", element: createElement(CompareScreen) }))),
    ),
  );
}

describe("CompareScreen markup", () => {
  it("an evicted snapshot's option: shown from its kept copy, labelled, with no offer to load what cannot be loaded", async () => {
    const workspace = store();
    await workspace.run(fixtureQuery());
    const rows = workspace.getState().displayedSnapshot!.rows;
    workspace.setSelected({ snapshotId: "s1", rowKey: rows[0]!.key }, true);
    for (let i = 2; i <= 12; i++) await workspace.run(fixtureQuery());
    expect(workspace.history().map((s) => s.id)).not.toContain("s1");
    workspace.setSelected({ snapshotId: "s12", rowKey: rows[1]!.key }, true);

    const html = render(workspace);
    expect(html).toContain("Its search is no longer kept on this device; shown as it was when chosen.");
    expect(html).toContain("Its search is no longer on this device, so its itineraries cannot be loaded from here.");
    // Only the option whose snapshot is kept may be opened to load its itineraries.
    expect(html.split("Not loaded. Open the option to load its itineraries.").length - 1).toBe(1);
    // Two searches: each option says which.
    expect(html).toContain("From the search of");
    expect(html).toContain("Option 1");
    expect(html).toContain("Option 2");
  });

  it("the same row from two searches: two numbered options, never two identical names", async () => {
    const workspace = store();
    await workspace.run(fixtureQuery());
    const key = workspace.getState().displayedSnapshot!.rows[0]!.key;
    workspace.setSelected({ snapshotId: "s1", rowKey: key }, true);
    await workspace.run(fixtureQuery());
    workspace.setSelected({ snapshotId: "s2", rowKey: key }, true);

    const html = render(workspace);
    const removeNames = [...html.matchAll(/aria-label="(Remove from comparison: [^"]*)"/g)].map((m) => m[1]);
    expect(removeNames).toHaveLength(2);
    expect(new Set(removeNames).size).toBe(2);
    expect(removeNames[0]).toMatch(/^Remove from comparison: Option 1, /);
    expect(removeNames[1]).toMatch(/^Remove from comparison: Option 2, /);
    expect(html.match(/From the search of/g)?.length).toBeGreaterThanOrEqual(2);
    // seats.aero's figures carry "Data: seats.aero", the name linking to seats.aero (Safari), as the details do.
    expect(html).toContain(
      '<p class="ag-compare-note">Data: <a class="ag-attribution-link" href="https://seats.aero" target="_blank" rel="noreferrer noopener">seats.aero<span class="sr-only"> Opens in Safari</span></a></p>',
    );
  });

  it("a chosen option found nowhere is said to be gone, and nothing is invented for it", () => {
    const workspace = store();
    // Not reachable through setSelected (it refuses unknown rows); a stale reference is what a later version might hold.
    (workspace as unknown as { getState(): { selected: unknown[] } }).getState().selected.push({ snapshotId: "gone", rowKey: "gone" }, { snapshotId: "gone", rowKey: "gone-2" });
    const html = render(workspace);
    expect(html.match(/This option is no longer on this device\./g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).not.toMatch(/\d{1,3},\d{3} miles/);
    // No figure of seats.aero's is shown, so nothing is attributed to it.
    expect(html).not.toContain("ag-attribution-link");
  });
});
