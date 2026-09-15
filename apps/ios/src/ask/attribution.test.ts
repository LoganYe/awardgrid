/**
 * "Data: seats.aero" under every answer whose requests carried seats.aero data (LEGAL.md, design §8.3; docs/PHASE5.md
 * §2.7, E6).
 *
 * A follow-up Claude answered without a tool call still resent the conversation's committed history, and with it the
 * search results and included searches of the questions in it. An entry that was stopped, failed or left unfinished is
 * never committed (core conversation.ts), so its results were not resent. These tests pin that rule on labels.ts
 * showsAttribution with entries shaped as the service stores them. No clock, no network.
 */
import { describe, expect, it } from "vitest";
import type { AskEntry, EntryEnd, EntryStep } from "@awardgrid/core/ask/conversation";
import type { ToolStep } from "@awardgrid/core/ask/tools";
import * as labels from "./labels";

const AT = "2026-10-01T00:00:00.000Z";

type Shown = Pick<AskEntry, "includeSearch" | "steps" | "end">;

function tool(over: Partial<ToolStep> = {}): EntryStep {
  return {
    kind: "tool",
    step: {
      tool: "search_awards",
      outcome: "ok",
      calls: 1,
      fromCache: false,
      fromMemo: false,
      search: { origins: ["SEA"], destinations: ["NRT", "HND"], date_from: "2026-10-01", date_to: "2026-10-31", cabins: ["J"], programs: null, direct_only: false, max_miles: null },
      program: null,
      estimate: null,
      ...over,
    },
  };
}

const ended = (status: EntryEnd["status"], committed: boolean): EntryEnd => ({ status, committed, failure: null, stoppedDuring: null, at: AT });

const entry = (over: Partial<Shown> = {}): Shown => ({ includeSearch: false, steps: [], end: ended("answered", true), ...over });

/** A follow-up Claude answered from the history alone: no tool call, no search included. */
const FOLLOW_UP = entry();

describe("an answer's own seats.aero data", () => {
  it("an included search or a seats.aero read that answered shows the attribution with nothing before it", () => {
    expect(labels.showsAttribution(entry({ includeSearch: true }), [])).toBe(true);
    expect(labels.showsAttribution(entry({ steps: [tool()] }), [])).toBe(true);
    expect(labels.showsAttribution(entry({ steps: [tool({ tool: "get_flights", search: null })] }), [])).toBe(true);
    expect(labels.showsAttribution(entry({ steps: [tool({ outcome: "too_wide", calls: 0 }), { kind: "paused" }] }), [])).toBe(false);
    expect(labels.showsAttribution(FOLLOW_UP, [])).toBe(false);
  });
});

describe("seats.aero data in the history a follow-up resent", () => {
  it("E6: a follow-up answered without a tool call after a committed question that searched shows the attribution", () => {
    const searched = entry({ steps: [tool()] });
    expect(labels.showsAttribution(FOLLOW_UP, [searched])).toBe(true);
  });

  it("a committed question that included the last search counts too", () => {
    expect(labels.showsAttribution(FOLLOW_UP, [entry({ includeSearch: true })])).toBe(true);
  });

  it("any earlier committed question counts, however many questions came between", () => {
    const searched = entry({ steps: [tool()] });
    expect(labels.showsAttribution(FOLLOW_UP, [searched, entry(), entry()])).toBe(true);
  });

  it.each<[string, EntryEnd]>([
    ["stopped", ended("stopped", false)],
    ["failed", ended("failed", false)],
    ["unfinished", ended("unfinished", false)],
    ["truncated with a tool call cut off, and so not committed", ended("truncated", false)],
  ])("an earlier question that ended %s is not in the history, so its data does not count", (_name, end) => {
    expect(labels.showsAttribution(FOLLOW_UP, [entry({ steps: [tool()], end }), entry({ includeSearch: true, end })])).toBe(false);
  });

  it("an earlier committed question that carried no seats.aero data adds none", () => {
    expect(labels.showsAttribution(FOLLOW_UP, [entry(), entry({ steps: [tool({ outcome: "invalid_place", calls: 0, search: null })] })])).toBe(false);
  });

  it("a question still running is in no history", () => {
    expect(labels.showsAttribution(FOLLOW_UP, [entry({ steps: [tool()], end: null })])).toBe(false);
  });
});
