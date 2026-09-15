/**
 * The meta line under a question awardgrid was closed during (docs/PHASE5.md §2.9, E8).
 *
 * Its counts are what ask.json held when the process died. A request is counted on disk as it is sent, but the request
 * does not wait for that write, and a tool call's seats.aero calls are saved only once the call finishes. So E8's
 * relaunched entry read "No requests" and "seats.aero calls: 0" though the request had gone out. These tests pin the
 * rule that replaced that line: every count of an unfinished entry is a lower bound, a zero is left out, and a closing
 * sentence says the question may have used more. No clock, no network.
 */
import { describe, expect, it } from "vitest";
import type { AskEntry, EntryEnd, QuestionUsage } from "@awardgrid/core/ask/conversation";
import * as labels from "./labels";

const AT = "2026-10-01T00:00:00.000Z";

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

const end = (status: EntryEnd["status"]): EntryEnd => ({ status, committed: status === "answered", failure: null, stoppedDuring: null, at: AT });

const entry = (status: EntryEnd["status"], over: Partial<QuestionUsage> = {}): Pick<AskEntry, "end" | "usage"> => ({ end: end(status), usage: usage(over) });

describe("an unfinished entry's meta line", () => {
  it("pins the closing sentence", () => {
    expect(labels.UNFINISHED_COUNTS).toBe("This question may have used more than awardgrid saved before it was closed");
  });

  it("the race E8 could lose: killed before the first request's count landed, it names no count at all", () => {
    const line = labels.entryMetaLine(entry("unfinished"));
    expect(line).toBe("Claude Opus 5 · This question may have used more than awardgrid saved before it was closed");
    expect(line).not.toMatch(/No requests|\b0 requests|seats\.aero calls: 0|\b0 input tokens|\b0 output tokens/);
  });

  it("E8 once its count landed: at least the one request, and nothing claimed about tokens no response reported", () => {
    expect(labels.entryMetaLine(entry("unfinished", { requests: 1 }))).toBe(
      "Claude Opus 5 · at least 1 request · This question may have used more than awardgrid saved before it was closed",
    );
  });

  it("words every saved count as a lower bound, the cache reads included", () => {
    expect(labels.entryMetaLine(entry("unfinished", { requests: 3, inputTokens: 9000, cacheReadTokens: 3956, outputTokens: 400, seatsCalls: 2 }))).toBe(
      "Claude Opus 5 · at least 3 requests · at least 9,000 input tokens (at least 3,956 read from cache) · at least 400 output tokens · seats.aero calls: at least 2 · This question may have used more than awardgrid saved before it was closed",
    );
  });

  it("leaves out a count saved as zero, and a cache read of zero, rather than stating it", () => {
    // Killed during a search: the request that asked for it is saved, the search's calls are not.
    const line = labels.entryMetaLine(entry("unfinished", { requests: 1, inputTokens: 4392, outputTokens: 96 }));
    expect(line).toBe("Claude Opus 5 · at least 1 request · at least 4,392 input tokens · at least 96 output tokens · This question may have used more than awardgrid saved before it was closed");
    expect(line).not.toContain("seats.aero calls");
    expect(line).not.toContain("read from cache");
  });

  it("uses singulars where a saved count is one", () => {
    expect(labels.unfinishedMetaLine(usage({ requests: 1, inputTokens: 1, cacheReadTokens: 1, outputTokens: 1, seatsCalls: 1 }))).toBe(
      "Claude Opus 5 · at least 1 request · at least 1 input token (at least 1 read from cache) · at least 1 output token · seats.aero calls: at least 1 · This question may have used more than awardgrid saved before it was closed",
    );
  });
});

describe("every other ending", () => {
  it.each<EntryEnd["status"]>(["answered", "empty", "truncated", "refused", "too_long", "stopped", "deadline", "request_limit", "failed"])(
    "%s keeps the exact meta line: the loop's own totals were saved with its ending",
    (status) => {
      const counts = { requests: 2, inputTokens: 9000, cacheReadTokens: 3956, outputTokens: 400, seatsCalls: 2 };
      expect(labels.entryMetaLine(entry(status, counts))).toBe(labels.metaLine(usage(counts)));
      expect(labels.entryMetaLine(entry(status, counts))).not.toContain(labels.UNFINISHED_COUNTS);
    },
  );
});
