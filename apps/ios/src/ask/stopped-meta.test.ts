/**
 * The meta line under a question whose request was interrupted, from what K2 showed on the owner's key.
 *
 * On 2026-09-23 Stop was pressed 7.6 s into a question's first request. The entry ended `stopped`,
 * `stoppedDuring: "request"`, uncommitted, and the copy under it read "Stopped. Nothing more will be
 * sent for this question. The request already sent to Anthropic still finishes and may be billed."
 * The meta line beside it read "Claude Opus 5 · 1 request · 0 input tokens (0 read from cache) ·
 * 0 output tokens · seats.aero calls: 0", which contradicts it: Anthropic reported nothing for that
 * request, so the zeros are unknowns, not measurements.
 *
 * `lastRequestInputTokens` is null exactly when the newest request never reported its usage, which is
 * what separates "interrupted in flight" from an ending that read its last response.
 */
import { describe, expect, it } from "vitest";
import type { AskEntry, QuestionUsage } from "@awardgrid/core/ask/conversation";
import * as labels from "./labels";

const usage = (over: Partial<QuestionUsage> = {}): QuestionUsage => ({
  requests: 0,
  inputTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
  lastRequestInputTokens: null,
  toolCalls: 0,
  seatsCalls: 0,
  ...over,
});

const entry = (end: AskEntry["end"], u: QuestionUsage): Pick<AskEntry, "end" | "usage"> => ({ end, usage: u });
const stopped = { status: "stopped", committed: false, failure: null, stoppedDuring: "request", at: "2026-09-23T23:44:52.542Z" } as unknown as AskEntry["end"];
const answered = { status: "answered", committed: true, failure: null, stoppedDuring: null, at: "2026-09-23T23:02:57.843Z" } as unknown as AskEntry["end"];

describe("a question stopped while its request was in flight (K2)", () => {
  it("states no token count at all, where it used to print zeros beside 'may be billed'", () => {
    const line = labels.entryMetaLine(entry(stopped, usage({ requests: 1 })));
    expect(line).toBe(`${labels.MODEL_NAME} · at least 1 request · ${labels.UNREPORTED_COUNTS}`);
    expect(line).not.toContain("0 input tokens");
    expect(line).not.toContain("0 output tokens");
    expect(line).not.toContain("seats.aero calls: 0");
  });

  it("words the counts it does have as lower bounds, and keeps them", () => {
    const line = labels.entryMetaLine(entry(stopped, usage({ requests: 2, inputTokens: 9_000, cacheReadTokens: 3_956, outputTokens: 240, seatsCalls: 2 })));
    expect(line).toContain("at least 2 requests");
    expect(line).toContain("at least 9,000 input tokens (at least 3,956 read from cache)");
    expect(line).toContain("at least 240 output tokens");
    expect(line).toContain("seats.aero calls: at least 2");
    expect(line.endsWith(labels.UNREPORTED_COUNTS)).toBe(true);
  });

  it("leaves an answered question's exact totals alone", () => {
    const line = labels.entryMetaLine(entry(answered, usage({ requests: 4, inputTokens: 13_989, cacheReadTokens: 9_013, outputTokens: 1_170, lastRequestInputTokens: 4_970, seatsCalls: 3 })));
    expect(line).toBe(`${labels.MODEL_NAME} · 4 requests · 13,989 input tokens (9,013 read from cache) · 1,170 output tokens · seats.aero calls: 3`);
    expect(line).not.toContain("at least");
  });

  it("leaves a question stopped between steps alone, because its last response was read", () => {
    const between = { ...(stopped as object), stoppedDuring: "between" } as unknown as AskEntry["end"];
    const line = labels.entryMetaLine(entry(between, usage({ requests: 1, inputTokens: 5_000, cacheReadTokens: 0, outputTokens: 120, lastRequestInputTokens: 5_000, seatsCalls: 1 })));
    expect(line).toContain("1 request · 5,000 input tokens");
    expect(line).not.toContain("at least");
  });

  it("keeps saying nothing was sent when nothing was", () => {
    const line = labels.entryMetaLine(entry(stopped, usage()));
    expect(line).toContain("No requests");
    expect(line).not.toContain(labels.UNREPORTED_COUNTS);
  });

  it("still says what an unfinished entry cannot vouch for, in its own words", () => {
    const unfinished = { status: "unfinished", committed: false, failure: null, stoppedDuring: null, at: null } as unknown as AskEntry["end"];
    const line = labels.entryMetaLine(entry(unfinished, usage({ requests: 1 })));
    expect(line).toBe(`${labels.MODEL_NAME} · at least 1 request · ${labels.UNFINISHED_COUNTS}`);
  });
});
