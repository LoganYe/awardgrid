/**
 * Ask's copy (design §5, §6.4, §7), pinned sentence by sentence.
 *
 * Failures are built the way the app meets them: core's createAskClient over a fake fetch that answers with a
 * scripted status or stream, then describeAskError, exactly as the loop calls it. Each code's sentence here is
 * therefore the one a person reads after that response, and the table is a Record over every failure code, so a
 * code added in core fails typecheck until it has a case. No network and no clock.
 */
import { describe, expect, it } from "vitest";
import { AskKeyMissingError, type AskModel, createAskClient } from "@awardgrid/core/ask/client";
import type { AskEntry, EntryStep, QuestionFailure, QuestionFailureCode, QuestionUsage } from "@awardgrid/core/ask/conversation";
import { type AskErrorContext, describeAskError } from "@awardgrid/core/ask/errors";
import { ASK_MAX_TOKENS, ASK_MODEL } from "@awardgrid/core/ask/limits";
import type { SearchEcho, ToolStep } from "@awardgrid/core/ask/tools";
import { type StreamEvent, toSse } from "@awardgrid/core/test-fixtures/ask/sse";
import streams from "@awardgrid/core/test-fixtures/ask/streams.json";
import { NativeHttpUnavailableError } from "../native/http";
import * as labels from "./labels";

const ANTHROPIC_KEY = "sk-ant-api03-labels-test-key-DO_NOT_LEAK";
const SEATS_KEY = "pro_seats_key_for_labels_tests_SECRET";

type Params = Parameters<AskModel["send"]>[0];
const PARAMS: Params = { model: ASK_MODEL, max_tokens: ASK_MAX_TOKENS, messages: [{ role: "user", content: "Cheapest business class from SEA to Tokyo?" }] };

function context(over: Partial<AskErrorContext> = {}): AskErrorContext {
  return { elapsedMs: 12_000, hidden: false, secrets: [SEATS_KEY, ANTHROPIC_KEY], ...over };
}

/** send() against a scripted response, then describeAskError on what it rejected with. */
async function failureFrom(respond: () => Response | Promise<Response>, over: Partial<AskErrorContext> = {}): Promise<QuestionFailure> {
  const fetchImpl = (async () => respond()) as typeof fetch;
  let error: unknown = null;
  try {
    await createAskClient({ apiKey: ANTHROPIC_KEY, fetch: fetchImpl }).send(PARAMS, { signal: new AbortController().signal });
  } catch (err) {
    error = err;
  }
  if (error === null) throw new Error("the scripted response should have failed send()");
  return describeAskError(error, context(over));
}

const errorResponse =
  (status: number, error: Record<string, unknown>, headers: Record<string, string> = {}) =>
  () =>
    new Response(JSON.stringify({ type: "error", error }), {
      status,
      headers: { "content-type": "application/json", "request-id": `req_synthetic_${status}`, ...headers },
    });

/** What URLSession's failure looks like in the WebView: an Error carrying localizedDescription (errors.ts). */
const nativeRejection = (text: string) => () => Promise.reject(Object.assign(new Error(text), { code: "NSURLErrorDomain" }));

const BILLED = "The request may still have been processed and billed to your key.";

interface FailureCase {
  build: () => Promise<QuestionFailure>;
  message: string | RegExp;
  retryable: boolean;
  /** Where the failure's sentence points, beside Try again or Ask again. */
  goTo: labels.FailureDestination | null;
}

const FAILURES: Record<QuestionFailureCode, FailureCase> = {
  stopped: {
    build: async () => describeAskError(new Error("aborted"), context({ reason: "stop" })),
    message: labels.STOPPED_DURING_REQUEST,
    retryable: false,
    goTo: null,
  },
  request_limit: {
    build: async () => describeAskError(new Error("aborted"), context({ reason: "request_limit" })),
    message: `Stopped waiting for Anthropic after 7.5 minutes, the most one request may take. ${BILLED}`,
    retryable: true,
    goTo: null,
  },
  anthropic_key_missing: {
    build: async () => describeAskError(new AskKeyMissingError(), context()),
    message: "Ask has no Anthropic API key to send. Add one in Settings.",
    retryable: false,
    goTo: "settings",
  },
  anthropic_key_rejected: {
    build: () => failureFrom(errorResponse(401, { type: "authentication_error", message: "invalid x-api-key" })),
    message: "Anthropic rejected your API key. Check it in Settings.",
    retryable: false,
    goTo: "settings",
  },
  model_unavailable: {
    build: () => failureFrom(errorResponse(404, { type: "not_found_error", message: "model: claude-opus-5" })),
    message: "Anthropic says this key cannot use Claude Opus 5.",
    retryable: false,
    goTo: "settings",
  },
  anthropic_forbidden: {
    build: () => failureFrom(errorResponse(403, { type: "permission_error", message: "Your API key does not have permission to use the specified resource." })),
    message: "Anthropic refused the request (permission_error): Your API key does not have permission to use the specified resource.",
    retryable: false,
    goTo: null,
  },
  spend_limit: {
    build: () =>
      failureFrom(
        errorResponse(429, {
          type: "rate_limit_error",
          message: "Your organization has reached its monthly spend limit.",
          details: { error_code: "enforced_spend_limit_reached" },
        }),
      ),
    message: "Anthropic refused the request because your organization reached its spend limit: Your organization has reached its monthly spend limit.",
    retryable: false,
    goTo: null,
  },
  rate_limited: {
    build: () => failureFrom(errorResponse(429, { type: "rate_limit_error", message: "Number of requests has exceeded your rate limit." }, { "retry-after": "7" })),
    message: "Anthropic's rate limit for your key was reached: Number of requests has exceeded your rate limit. Anthropic asks to wait 7 seconds before trying again.",
    retryable: true,
    goTo: null,
  },
  bad_request: {
    build: () => failureFrom(errorResponse(400, { type: "invalid_request_error", message: "messages: text content blocks must be non-empty" })),
    message: "Anthropic could not accept the request (400): messages: text content blocks must be non-empty",
    retryable: false,
    goTo: null,
  },
  too_large: {
    build: () => failureFrom(errorResponse(413, { type: "request_too_large", message: "Request exceeds the maximum allowed number of bytes." })),
    message: "This conversation is too large to send. Start a new conversation.",
    retryable: false,
    goTo: "new_conversation",
  },
  overloaded: {
    build: () => failureFrom(errorResponse(529, { type: "overloaded_error", message: "Overloaded" })),
    message: "Anthropic is overloaded and did not answer.",
    retryable: true,
    goTo: null,
  },
  overloaded_mid_answer: {
    build: () =>
      failureFrom(
        () =>
          new Response(toSse(streams.overloaded_mid as unknown as StreamEvent[], { pingEvery: 1 }), {
            status: 200,
            headers: { "content-type": "text/event-stream", "request-id": "req_synthetic_stream" },
          }),
      ),
    message: "Anthropic became overloaded partway through the answer. What Claude had already generated may still be billed.",
    retryable: true,
    goTo: null,
  },
  anthropic_error: {
    build: () => failureFrom(errorResponse(500, { type: "api_error", message: "Internal server error" })),
    message: "Anthropic returned an error (500): Internal server error",
    retryable: true,
    goTo: null,
  },
  unreadable_response: {
    build: () => failureFrom(() => new Response("", { status: 200, headers: { "content-type": "text/event-stream" } })),
    message: new RegExp(`^Anthropic's response could not be read: .+ ${BILLED.replace(/\./g, "\\.")}$`),
    retryable: true,
    goTo: null,
  },
  connection_failed: {
    build: () => failureFrom(nativeRejection("The network connection was lost.")),
    message: `The connection to Anthropic failed after 12 seconds: The network connection was lost. ${BILLED}`,
    retryable: true,
    goTo: null,
  },
  connection_failed_left_app: {
    build: () => failureFrom(nativeRejection("The network connection was lost."), { hidden: true }),
    message: "The request to Anthropic was interrupted after you left awardgrid: The network connection was lost. It may still have been processed and billed to your key.",
    retryable: true,
    goTo: null,
  },
  wiring: {
    build: async () => describeAskError(new NativeHttpUnavailableError("CapacitorHttp is not registered on the native side."), context()),
    message: labels.WIRING,
    retryable: false,
    goTo: null,
  },
  unexpected_stop: {
    // The loop's own failure (loop.ts unexpectedStop), for a stop reason no row of design §3.6 handles.
    build: async () => ({
      code: "unexpected_stop",
      retryable: false,
      message: "Claude's response ended in a way awardgrid does not handle (stop reason: pause_turn). The request was processed and may be billed to your key.",
      requestId: null,
    }),
    message: "Claude's response ended in a way awardgrid does not handle (stop reason: pause_turn). The request was processed and may be billed to your key.",
    retryable: false,
    goTo: null,
  },
};

const failureCases = Object.entries(FAILURES).map(([code, c]) => ({ code: code as QuestionFailureCode, ...c }));

describe("failure copy, for every failure code", () => {
  it.each(failureCases)("$code: the sentence a person reads, its request ID line and what to do next", async ({ code, build, message, retryable, goTo }) => {
    const failure = await build();
    expect(failure.code).toBe(code);
    expect(failure.retryable).toBe(retryable);
    if (typeof message === "string") expect(failure.message).toBe(message);
    else expect(failure.message).toMatch(message);

    const view = labels.failureView(failure, false);
    expect(view.message).toBe(failure.message);
    // Design §6.4: with no resend on offer, every failure offers Ask again, whatever its sentence also points to.
    expect(view.action).toBe("ask_again");
    expect(view.goTo).toBe(goTo);
    expect(view.hint).toBeNull();
    expect(view.requestIdLine).toBe(failure.requestId === null ? null : `Anthropic request ID: ${failure.requestId}`);
    for (const secret of [ANTHROPIC_KEY, SEATS_KEY]) expect(JSON.stringify(view)).not.toContain(secret);
  });

  it.each(failureCases.filter((c) => c.retryable))("$code: Try again, with its hint, when the loop offers a resend", async ({ build, goTo }) => {
    const view = labels.failureView(await build(), true);
    expect(view.action).toBe("try_again");
    expect(view.hint).toBe("Sends the same request again. If the first one reached Anthropic, both may be billed.");
    expect(view.goTo).toBe(goTo);
  });

  it("shows Anthropic's request ID when a response carried one, and none for a failure no response reached", async () => {
    expect(labels.failureView(await FAILURES.anthropic_key_rejected.build(), false).requestIdLine).toBe("Anthropic request ID: req_synthetic_401");
    expect(labels.failureView(await FAILURES.connection_failed.build(), false).requestIdLine).toBeNull();
  });

  it("gives a failure code from a newer ask.json a way on, rather than none", () => {
    const view = labels.failureView({ code: "a_code_from_a_later_build" as QuestionFailureCode, retryable: false, message: "Something new.", requestId: null }, false);
    expect(view.action).toBe("ask_again");
    expect(view.goTo).toBeNull();
  });

  it("pins the Try again and Ask again labels", () => {
    expect(labels.TRY_AGAIN).toBe("Try again");
    expect(labels.ASK_AGAIN).toBe("Ask again");
  });
});

describe("the Settings key check (design §7)", () => {
  it.each([
    ["anthropic_key_rejected", "rejected", "Anthropic rejected this key."],
    ["anthropic_forbidden", "cannot_use", "Anthropic accepted this key, but it cannot use Claude Opus 5."],
    ["model_unavailable", "cannot_use", "Anthropic accepted this key, but it cannot use Claude Opus 5."],
    ["connection_failed", "unreachable", "Could not reach Anthropic. The key is saved; check it again when you are online."],
    ["connection_failed_left_app", "unreachable", "Could not reach Anthropic. The key is saved; check it again when you are online."],
    ["wiring", "wiring", labels.WIRING],
    ["anthropic_key_missing", "no_key", "No Anthropic key on file."],
  ] as const)("%s reads as %s", async (code, outcome, message) => {
    expect(labels.keyCheckFromFailure(await FAILURES[code].build())).toEqual({ outcome, message });
  });

  it.each(["overloaded", "anthropic_error", "rate_limited", "bad_request", "spend_limit"] as const)("%s says the key is saved but was not confirmed, with Anthropic's words", async (code) => {
    const failure = await FAILURES[code].build();
    expect(labels.keyCheckFromFailure(failure)).toEqual({ outcome: "not_confirmed", message: `The key is saved, but Anthropic did not confirm it: ${failure.message}` });
  });

  it("an unreadable response says so, without core's word that a question's request may be billed", async () => {
    expect(labels.keyCheckFromFailure(await FAILURES.unreadable_response.build())).toEqual({
      outcome: "not_confirmed",
      message: "The key is saved, but Anthropic's response to the check could not be read, so the key is not confirmed.",
    });
  });

  it.each(["stopped", "request_limit", "too_large", "overloaded_mid_answer", "unexpected_stop"] as const)("%s, whose sentence is written for a question, is not quoted", async (code) => {
    expect(labels.keyCheckFromFailure(await FAILURES[code].build())).toEqual({ outcome: "not_confirmed", message: "The key is saved, but Anthropic did not confirm it." });
  });

  it("never speaks of billing, a question or a conversation, since a check sends no prompt", async () => {
    for (const { code, build } of failureCases) {
      expect(labels.keyCheckFromFailure(await build()).message, code).not.toMatch(/bill|question|conversation/i);
    }
    // A code from a later build is not quoted until it has been read and listed.
    const later = { code: "a_code_from_a_later_build" as QuestionFailureCode, retryable: false, message: "The question may be billed.", requestId: null };
    expect(labels.keyCheckFromFailure(later)).toEqual({ outcome: "not_confirmed", message: "The key is saved, but Anthropic did not confirm it." });
  });

  it("pins the rest of the section's copy", () => {
    expect(labels.KEY_ACCEPTED).toBe("Anthropic accepted this key for Claude Opus 5. Checking sends no question.");
    expect(labels.KEY_REMOVED).toBe("Anthropic key removed from the Keychain.");
    expect(labels.NO_KEY_ON_FILE).toBe("No Anthropic key on file.");
    expect(labels.keySaveFailedLabel("OSStatus -34018")).toBe("Could not save the key: OSStatus -34018");
    expect(labels.keyReadFailedLabel("OSStatus -25308")).toBe("Could not read the key from the Keychain: OSStatus -25308");
  });
});

describe("counts", () => {
  it.each([
    [0, "No calls"],
    [1, "1 call"],
    [2, "2 calls"],
    [12, "12 calls"],
    [1000, "1,000 calls"],
  ])("callsLabel(%i) is %j", (n, text) => {
    expect(labels.callsLabel(n)).toBe(text);
  });

  it.each([
    [0, "No requests"],
    [1, "1 request"],
    [6, "6 requests"],
  ])("requestsLabel(%i) is %j", (n, text) => {
    expect(labels.requestsLabel(n)).toBe(text);
  });
});

describe("the per-answer meta line (design §5)", () => {
  const usage = (over: Partial<QuestionUsage>): QuestionUsage => ({
    requests: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    lastRequestInputTokens: null,
    toolCalls: 0,
    seatsCalls: 0,
    ...over,
  });

  it("names the model and counts requests, tokens and seats.aero calls, never a price", () => {
    expect(labels.metaLine(usage({ requests: 2, inputTokens: 9000, cacheReadTokens: 3956, outputTokens: 400, seatsCalls: 2 }))).toBe(
      "Claude Opus 5 · 2 requests · 9,000 input tokens (3,956 read from cache) · 400 output tokens · seats.aero calls: 2",
    );
  });

  it("uses singulars where a count is one", () => {
    expect(labels.metaLine(usage({ requests: 1, inputTokens: 1, outputTokens: 1 }))).toBe(
      "Claude Opus 5 · 1 request · 1 input token (0 read from cache) · 1 output token · seats.aero calls: 0",
    );
  });

  it("names the model core actually calls", () => {
    expect(ASK_MODEL).toBe("claude-opus-5");
    expect(labels.MODEL_NAME).toBe("Claude Opus 5");
  });
});

describe("the search summary", () => {
  it("reads as the design's example", () => {
    expect(
      labels.searchSummary({ origins: ["SEA"], destinations: ["NRT", "HND"], date_from: "2026-10-01", date_to: "2026-10-30", cabins: ["J"], programs: null, direct_only: false, max_miles: null }),
    ).toBe("SEA to NRT, HND, 2026-10-01 to 2026-10-30, business");
  });

  it("joins cabins with and", () => {
    const base = { origins: ["HKG"], destinations: ["SEA"], date_from: "2026-10-01", date_to: "2026-10-30" };
    expect(labels.searchSummary({ ...base, cabins: ["J", "F"] })).toBe("HKG to SEA, 2026-10-01 to 2026-10-30, business and first");
    expect(labels.searchSummary({ ...base, cabins: ["Y", "W", "F"] })).toBe("HKG to SEA, 2026-10-01 to 2026-10-30, economy, premium economy and first");
  });

  it("says how a narrower search was narrowed, so a step never describes a wider search than ran", () => {
    expect(
      labels.searchSummary({
        origins: ["SFO", "LAX"],
        destinations: ["LHR"],
        date_from: "2026-11-01",
        date_to: "2026-11-15",
        cabins: ["F"],
        programs: ["alaska", "american"],
        direct_only: true,
        max_miles: 80000,
      }),
    ).toBe("SFO, LAX to LHR, 2026-11-01 to 2026-11-15, first, direct only, Alaska Mileage Plan and American Airlines AAdvantage, up to 80,000 miles");
  });

  it("reads a last grid search's query, which has no mile limit, and labels the context checkbox with it", () => {
    const summary = labels.searchSummary({ origins: ["SEA"], destinations: ["NRT", "HND"], date_from: "2026-10-01", date_to: "2026-10-30", cabins: ["J"], direct_only: false });
    expect(labels.includeSearchLabel(summary)).toBe("Include my last search: SEA to NRT, HND, 2026-10-01 to 2026-10-30, business");
  });
});

describe("while a question runs", () => {
  it("pins the Stop note, shown before any tap", () => {
    expect(labels.STOP_NOTE).toBe("Stop sends nothing more. It cannot recall a request already sent.");
  });

  it.each([
    [0, "Waiting for Claude (0 s)"],
    [12.9, "Waiting for Claude (12 s)"],
    [-1, "Waiting for Claude (0 s)"],
  ])("counts the wait up: %d s reads %j", (seconds, text) => {
    expect(labels.waitingLabel(seconds)).toBe(text);
  });

  it("summarises the search under way from Claude's input, as Claude wrote it", () => {
    const input = { origins: ["sea"], destinations: ["TYO"], date_from: "2026-10-01", date_to: "2026-10-31", cabins: ["J"], programs: null, direct_only: false, max_miles: null };
    expect(labels.toolRunningLabel("search_awards", input)).toBe("Searching seats.aero: SEA to TYO, 2026-10-01 to 2026-10-31, business");
  });

  it("falls back to a plain label when the input cannot be summarised", () => {
    expect(labels.toolRunningLabel("search_awards", {})).toBe("Searching seats.aero");
    expect(labels.toolRunningLabel("search_awards", { origins: "SEA" })).toBe("Searching seats.aero");
    expect(labels.toolRunningLabel("search_awards", null)).toBe("Searching seats.aero");
    expect(labels.toolRunningLabel("get_flights", { availability_id: "x", cabin: "J" })).toBe("Looking up flights on seats.aero");
    expect(labels.toolRunningLabel("book_flight", {})).toBe("Checking a tool request from Claude");
  });

  it("pins the status announcements", () => {
    expect(labels.ANNOUNCEMENTS).toEqual({
      waiting: "Waiting for Claude",
      searching: "Searching seats.aero",
      answered: "Answer ready",
      stopped: "Stopped",
      failed: "Ask failed",
    });
  });
});

const SEARCH: SearchEcho = { origins: ["SEA"], destinations: ["NRT", "HND"], date_from: "2026-10-01", date_to: "2026-10-30", cabins: ["J"], programs: null, direct_only: false, max_miles: null };
const SUMMARY = "SEA to NRT, HND, 2026-10-01 to 2026-10-30, business";

function tool(over: Partial<ToolStep> = {}): ToolStep {
  return { tool: "search_awards", outcome: "ok", calls: 0, fromCache: false, fromMemo: false, search: null, program: null, estimate: null, ...over };
}
const step = (over: Partial<ToolStep> = {}): EntryStep => ({ kind: "tool", step: tool(over) });

describe("step labels", () => {
  it.each<[string, EntryStep, string]>([
    ["a search that spent calls", step({ calls: 2, search: SEARCH }), `Searched seats.aero: ${SUMMARY}. 2 calls.`],
    ["a search that spent one call", step({ calls: 1, search: SEARCH }), `Searched seats.aero: ${SUMMARY}. 1 call.`],
    ["a read from this device's cache", step({ fromCache: true, search: SEARCH }), `Read from this device's cache: ${SUMMARY}. No calls.`],
    ["too wide by airport pairs, with no estimate", step({ outcome: "too_wide" }), "Search refused: it covers more airport pairs than the 12 one search may cover. No calls."],
    [
      "too wide for any one search",
      step({ outcome: "too_wide", search: SEARCH, estimate: 5 }),
      "Search refused: it needs about 5 calls, more than the 3 one search may spend on results. Claude was asked to narrow it.",
    ],
    [
      "too wide for what the question has left",
      step({ outcome: "too_wide", search: SEARCH, estimate: 2 }),
      "Search refused: it needs about 2 calls, more than this question has left. Claude was asked to narrow it.",
    ],
    [
      "too wide for what the question has left, at the page cap itself",
      step({ outcome: "too_wide", search: SEARCH, estimate: 3 }),
      "Search refused: it needs about 3 calls, more than this question has left. Claude was asked to narrow it.",
    ],
    [
      "too wide for the one call left",
      step({ outcome: "too_wide", search: SEARCH, estimate: 1 }),
      "Search refused: it needs about 1 call, more than this question has left. Claude was asked to narrow it.",
    ],
    [
      "the quota reserve",
      step({ outcome: "quota_reserve", search: SEARCH, estimate: 2 }),
      "Search not run: it would use calls from the last 25 of today's quota, which are kept for your own searches.",
    ],
    ["stopped by its budget guard", step({ outcome: "limit_reached", search: SEARCH, calls: 2 }), "Search stopped after 2 calls, the most it was allowed."],
    ["past the question's search or tool-call limit", step({ outcome: "limit_reached" }), "Search not run: this question reached its limit of 4 searches or 8 tool calls. No calls."],
    // Either the question's calls or today's calls above the reserve (a covered search whose cache expired); the step cannot tell which.
    ["with no calls left to spend", step({ outcome: "limit_reached", search: SEARCH }), "Search not run: no seats.aero calls were left for it to spend. No calls."],
    ["an unknown place code", step({ outcome: "invalid_place" }), "Search not run: Claude used a place code awardgrid does not know. No calls."],
    ["input that is not a valid search", step({ outcome: "invalid_input" }), "Search not run: the search Claude asked for was not valid. No calls."],
    ["today's quota used up", step({ outcome: "quota", search: SEARCH }), "Search failed: today's seats.aero quota is used up. No calls."],
    ["a rejected seats.aero key", step({ outcome: "seatsaero_key_rejected", search: SEARCH, calls: 1 }), "Search failed: seats.aero rejected your key. 1 call."],
    ["a failed request", step({ outcome: "network", search: SEARCH, calls: 1 }), "Search failed: the request to seats.aero failed. 1 call."],
    ["a seats.aero error", step({ outcome: "seatsaero_error", search: SEARCH, calls: 1 }), "Search failed: seats.aero could not complete it. 1 call."],
    ["a failure inside awardgrid", step({ outcome: "tool_failed" }), "Search failed inside awardgrid. No calls."],
    ["flights looked up earlier", step({ tool: "get_flights", fromMemo: true, program: "alaska" }), "Showed flights looked up earlier in this conversation. No calls."],
    ["flights for a program's result", step({ tool: "get_flights", calls: 1, program: "alaska" }), "Looked up flights for one Alaska Mileage Plan result. 1 call."],
    ["flights for a program this build does not know", step({ tool: "get_flights", calls: 1, program: "newprogram" }), "Looked up flights for one newprogram result. 1 call."],
    ["flights for a row no longer cached", step({ tool: "get_flights", calls: 1 }), "Looked up flights for one result. 1 call."],
    [
      "flights for an id no search returned",
      step({ tool: "get_flights", outcome: "unknown_id" }),
      "Flights not looked up: Claude named a result this conversation's searches did not return. No calls.",
    ],
    [
      "flights at the quota reserve",
      step({ tool: "get_flights", outcome: "quota_reserve" }),
      "Flights not looked up: it would use a call from the last 25 of today's quota, which are kept for your own searches.",
    ],
    [
      "flights past a limit",
      step({ tool: "get_flights", outcome: "limit_reached" }),
      "Flights not looked up: this question reached one of its limits (3 lookups, 8 tool calls, 12 seats.aero calls). No calls.",
    ],
    ["a failed flights request", step({ tool: "get_flights", outcome: "network", calls: 1 }), "Flight lookup failed: the request to seats.aero failed. 1 call."],
    ["flights input that could not be read", step({ tool: "get_flights", outcome: "invalid_input" }), "Flights not looked up: Claude's request could not be read. No calls."],
    ["a tool awardgrid does not have", step({ tool: "book_flight", outcome: "unknown_tool" }), "Claude asked for a tool awardgrid does not have. No calls."],
    ["a pause while awardgrid was hidden", { kind: "paused" }, "Paused while you were away from awardgrid."],
  ])("%s", (_name, entryStep, text) => {
    expect(labels.stepLabel(entryStep)).toBe(text);
  });
});

describe("Stop", () => {
  it("during a model request says the request already sent still finishes and may be billed", () => {
    expect(labels.stoppedLabel("request")).toBe(
      "Stopped. Nothing more will be sent for this question. The request already sent to Anthropic still finishes and may be billed.",
    );
  });

  it("during a seats.aero search says the search counts toward today's calls", () => {
    expect(labels.stoppedLabel("tool", tool({ calls: 2, search: SEARCH }))).toBe(
      "Stopped. The seats.aero search already under way could not be recalled; it finishes and counts toward today's calls.",
    );
  });

  it("during a flights lookup names the lookup", () => {
    expect(labels.stoppedLabel("tool", tool({ tool: "get_flights", calls: 1 }))).toBe(
      "Stopped. The seats.aero lookup already under way could not be recalled; it finishes and counts toward today's calls.",
    );
  });

  it("during a step that spent no call does not claim a call counted", () => {
    expect(labels.stoppedLabel("tool", tool({ fromCache: true, search: SEARCH }))).toBe(
      "Stopped. The step under way finished without a seats.aero call, and nothing more will be sent for this question.",
    );
  });

  it("between steps says nothing more is sent, and claims nothing was under way", () => {
    expect(labels.stoppedLabel("between")).toBe("Stopped before the next step began. Nothing more will be sent for this question.");
  });
});

describe("how a question ended", () => {
  const entry = (end: AskEntry["end"], steps: EntryStep[] = []): Pick<AskEntry, "end" | "steps"> => ({ end, steps });
  const ended = (status: NonNullable<AskEntry["end"]>["status"], over: Partial<NonNullable<AskEntry["end"]>> = {}) =>
    entry({ status, committed: false, failure: null, stoppedDuring: null, at: "2026-10-01T00:00:00.000Z", ...over });

  it.each<[string, Pick<AskEntry, "end" | "steps">, string | null]>([
    ["still running", entry(null), null],
    ["answered", ended("answered", { committed: true }), null],
    ["empty", ended("empty"), "Claude returned no text. Ask again."],
    ["truncated", ended("truncated", { committed: true }), "The answer reached its length limit and is cut off."],
    ["refused", ended("refused"), "Claude declined to answer this question."],
    ["too long", ended("too_long"), "Claude ran out of room in its context window before finishing this answer. Start a new conversation."],
    ["deadline", ended("deadline"), "No new step started after 5 minutes, the most one question may take, so this question ended without an answer."],
    ["request limit", ended("request_limit"), "This question has used its 6 requests."],
    ["stopped during a request", ended("stopped", { stoppedDuring: "request" }), labels.STOPPED_DURING_REQUEST],
    ["stopped between steps", ended("stopped", { stoppedDuring: "between" }), "Stopped before the next step began. Nothing more will be sent for this question."],
    [
      "stopped during a search, read from the entry's last tool step",
      { ...ended("stopped", { stoppedDuring: "tool" }), steps: [step({ calls: 2, search: SEARCH }), { kind: "paused" }] },
      "Stopped. The seats.aero search already under way could not be recalled; it finishes and counts toward today's calls.",
    ],
    [
      "failed",
      ended("failed", { failure: { code: "overloaded", retryable: true, message: "Anthropic is overloaded and did not answer.", requestId: "req_1" } }),
      "Anthropic is overloaded and did not answer.",
    ],
    ["unfinished after a relaunch", ended("unfinished"), "This question did not finish because awardgrid was closed while it ran. Requests already sent may have been billed."],
  ])("%s", (_name, e, text) => {
    expect(labels.endLabel(e)).toBe(text);
  });
});

describe("under an answer", () => {
  it("adds the follow-up note only when an answer offers what awardgrid cannot do", () => {
    expect(labels.showsFollowUpNote({ texts: ["Alaska has 2 seats at 75,000 miles.", "I'll keep an eye on this route for you."] })).toBe(true);
    expect(labels.showsFollowUpNote({ texts: ["Alaska has 2 seats at 75,000 miles. Confirm on alaskaair.com before transferring points."] })).toBe(false);
    expect(labels.FOLLOW_UP_NOTE).toBe(
      "awardgrid cannot look again later or send you anything. To follow a route, use Watch this search on the Search screen, which checks when you open the app.",
    );
  });

  it("shows the attribution whenever the answer may rest on seats.aero data", () => {
    expect(labels.ATTRIBUTION).toBe("Data: seats.aero");
    expect(labels.showsAttribution({ includeSearch: true, steps: [] })).toBe(true);
    expect(labels.showsAttribution({ includeSearch: false, steps: [step({ calls: 1, search: SEARCH })] })).toBe(true);
    expect(labels.showsAttribution({ includeSearch: false, steps: [step({ fromCache: true, search: SEARCH })] })).toBe(true);
    expect(labels.showsAttribution({ includeSearch: false, steps: [step({ outcome: "too_wide" }), { kind: "paused" }] })).toBe(false);
  });
});

describe("the conversation, and refusals before a question starts", () => {
  it("pins the copy", () => {
    expect(labels.NO_ANTHROPIC_KEY).toBe("Ask needs your own Anthropic API key. Add one in Settings. Search and watches work without it.");
    expect(labels.NO_SEATS_KEY).toBe("Ask searches seats.aero with your own Pro key. Add it in Settings first.");
    expect(labels.BUSY).toBe("A question is already running. Stop it or wait for the answer.");
    expect(labels.CLEARED).toBe("Conversation cleared.");
    expect(labels.NEW_CONVERSATION).toBe("New conversation");
    expect(labels.CONVERSATION_NOTE).toBe("Answers in this conversation are saved on this device until you start a new conversation.");
  });

  it("uses the same wiring words core gives a native HTTP failure", () => {
    const failure = describeAskError(new NativeHttpUnavailableError("Not a native platform."), context());
    expect(labels.WIRING).toBe(failure.message);
  });
});
