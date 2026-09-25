/**
 * A saved snapshot shown again (UI/UX v1 T05): an empty cell reads "no availability" only where a complete slice
 * proves it; unknown stays unknown.
 */
import { describe, expect, it } from "vitest";
import { fixtureQuery, fixtureSnapshot } from "@awardgrid/core/test-fixtures/uiux/factory";
import { NOT_FETCHED_REASON } from "@awardgrid/core/seatsaero/not-fetched";
import type { CoverageSlice, ResultSnapshot } from "@awardgrid/core/workspace/types";
import { searchViewFromSnapshot } from "./snapshot-view";

/** The synthetic query widened to a second destination with no rows, so one pair is always empty. */
function withEmptyPair(slices: (base: CoverageSlice) => CoverageSlice[], state: ResultSnapshot["coverage"]["state"] = "complete"): ResultSnapshot {
  const query = { ...fixtureQuery(), destinations: ["SEA", "YVR"] };
  const snapshot = fixtureSnapshot({ query });
  const base = snapshot.coverage.slices[0]!;
  return { ...snapshot, coverage: { ...snapshot.coverage, state, slices: slices(base) } };
}

const cellsFor = (view: ReturnType<typeof searchViewFromSnapshot>, dest: string) =>
  view.grid.cells.flat().filter((c) => c.dest === dest);

describe("searchViewFromSnapshot", () => {
  it("a pair proven complete with no rows reads none; the pair with rows shows them", () => {
    const view = searchViewFromSnapshot(withEmptyPair((b) => [b, { ...b, destination: "YVR" }]));
    expect(cellsFor(view, "YVR").every((c) => c.status === "none")).toBe(true);
    expect(cellsFor(view, "SEA").some((c) => c.status === "ok")).toBe(true);
  });

  it("partial (page cap), quota and missing evidence read not checked, with their reason", () => {
    for (const [reason, key] of [
      ["page_cap", NOT_FETCHED_REASON.truncated],
      ["quota", NOT_FETCHED_REASON.quota],
      ["missing_evidence", NOT_FETCHED_REASON.truncated],
    ] as const) {
      const state = reason === "missing_evidence" ? "unknown" : "partial";
      const view = searchViewFromSnapshot(withEmptyPair((b) => [b, { ...b, destination: "YVR", state, reason }], state === "unknown" ? "unknown" : "partial"));
      expect(view.grid.meta.not_fetched_pairs.map((p) => [p.pair.dest, p.reason]), reason).toEqual([["YVR", key]]);
      expect(cellsFor(view, "YVR").some((c) => c.status === "none"), reason).toBe(false);
    }
  });

  it("not monitored reads not monitored", () => {
    const view = searchViewFromSnapshot(withEmptyPair((b) => [b, { ...b, destination: "YVR", state: "unmonitored", reason: "not_monitored" }], "partial"));
    expect(view.grid.meta.unmonitored_pairs.map((p) => p.dest)).toEqual(["YVR"]);
  });

  it("coverage that restore could not prove (no slices at all) never reads none", () => {
    const view = searchViewFromSnapshot(withEmptyPair(() => [], "unknown"));
    expect(view.grid.meta.not_fetched_pairs.map((p) => p.pair.dest)).toEqual(["YVR"]);
    expect(cellsFor(view, "YVR").some((c) => c.status === "none")).toBe(false);
  });

  it("does not invent what a snapshot does not record: calls unknown, no warnings", () => {
    const view = searchViewFromSnapshot(fixtureSnapshot());
    expect(view.api_calls_used).toBeNull();
    expect(view.warnings).toEqual([]);
    expect(view.fetched_at_min).not.toBeNull();
  });
});
