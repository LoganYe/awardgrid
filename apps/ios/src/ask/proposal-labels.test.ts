/**
 * T16 step lines (review UX-3, UX-4, REG-3): a refused search is said against what went with the question, and each
 * proposal outcome is said as what happened, never as "could not be read" when it was read.
 */
import { describe, expect, it } from "vitest";
import type { EntryStep } from "@awardgrid/core/ask/conversation";
import type { ToolStep } from "@awardgrid/core/ask/tools";
import { stepLabel } from "./labels";

const tool = (over: Partial<ToolStep>): EntryStep => ({
  kind: "tool",
  step: { tool: "search_awards", outcome: "ok", calls: 0, fromCache: false, fromMemo: false, search: null, program: null, estimate: null, ...over },
});
const search = { origins: ["HKG"], destinations: ["YVR"], date_from: "2026-10-18", date_to: "2026-11-06", cabins: ["J" as const], programs: null, direct_only: false, max_miles: null };

describe("a refused search", () => {
  it("with a search included: names the search Claude asked for as going outside it", () => {
    expect(stepLabel(tool({ outcome: "needs_confirmation", search }), { searchIncluded: true })).toBe(
      "Search not run: HKG to YVR, 2026-10-18 to 2026-11-06, business goes outside the search you included. No calls.",
    );
  });
  it("with none included: says none went, and only an applied proposal can run", () => {
    expect(stepLabel(tool({ outcome: "needs_confirmation", search }), { searchIncluded: false })).toBe(
      "Search not run: no search went with this question, so only a search you apply from a proposal can run. No calls.",
    );
    expect(stepLabel(tool({ tool: "get_flights", outcome: "needs_confirmation" }), { searchIncluded: false })).toBe("Flights not looked up: no search went with this question. No calls.");
  });
});

describe("proposal steps", () => {
  const cases: Array<[ToolStep["outcome"], string]> = [
    ["ok", "Proposed a change to your search for you to review. No calls."],
    ["limit_reached", "No further proposal: this question already made its one proposal, or reached its tool-call limit. No calls."],
    ["inside_scope", "No proposal needed: that search is inside the one you included. No calls."],
    ["invalid_place", "Proposal refused: Claude used a place code awardgrid does not know. No calls."],
    ["invalid_input", "Proposal refused: the change Claude proposed was not a valid search. No calls."],
  ];
  for (const [outcome, text] of cases) {
    it(outcome, () => expect(stepLabel(tool({ tool: "propose_query_change", outcome }))).toBe(text));
  }
});
