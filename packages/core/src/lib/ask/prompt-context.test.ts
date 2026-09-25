/**
 * The question's context lines added in UI/UX v1 T15: the search's other conditions, whether the results on screen
 * are complete, and the results the person attached. A search without them is described in the same bytes as before
 * (prompt.test.ts pins those bytes; this file adds the new lines only).
 */
import { describe, expect, it } from "vitest";
import { type AttachedRow, type LastSearch, buildUserTurn, searchConditionsLine } from "./prompt";

const TODAY = new Date("2026-10-18T12:00:00.000Z");
const SEARCH: LastSearch = { origins: ["HKG"], destinations: ["SEA"], date_from: "2026-10-18", date_to: "2026-10-31", cabins: ["J"], programs: ["aeroplan"], direct_only: false };
const ROW: AttachedRow = { ref: "R1", date: "2026-10-19", origin: "HKG", destination: "SEA", program: "aeroplan", cabin: "J", miles: 68000, taxes: null, seats: null, direct: true, airlines: ["AC"], age_minutes: null };

const contextOf = (turn: ReturnType<typeof buildUserTurn>) => (turn.content as Array<{ type: string; text: string }>)[0]!.text.split("\n");

describe("the T15 context lines", () => {
  it("none of them without a search, whatever else is passed", () => {
    const lines = contextOf(buildUserTurn({ question: "Q?", today: TODAY, lastSearch: null, attached: [ROW], coverage: "partial" }));
    expect(lines).toEqual(["Context from awardgrid, not written by the person:", "Today's date is 2026-10-18 (UTC).", "The person did not include a search."]);
  });

  it("with a search: its conditions, then its coverage, then the attached results, in that order", () => {
    const lines = contextOf(buildUserTurn({ question: "Q?", today: TODAY, lastSearch: { ...SEARCH, max_miles: 80000 }, attached: [ROW], coverage: "unknown" }));
    expect(lines.slice(3)).toEqual([
      "That search also had these conditions: at most 80,000 miles.",
      "Whether the results on the person's screen for that search are complete is unknown.",
      `The person also attached 1 result from that search, copied by awardgrid from the results on their screen (seats.aero's cached data): ${JSON.stringify([ROW])}. They are named R1; use those names when you refer to them. A null taxes, seats or age_minutes is unknown, not zero.`,
    ]);
  });

  it("complete coverage, default conditions and no results add nothing", () => {
    expect(contextOf(buildUserTurn({ question: "Q?", today: TODAY, lastSearch: { ...SEARCH, min_cabin_pct: 100, include_filtered: false, max_miles: null }, attached: [], coverage: "complete" }))).toHaveLength(3);
    expect(searchConditionsLine({ ...SEARCH, min_cabin_pct: 100 })).toBeNull();
  });
});
