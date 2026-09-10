/**
 * The history rule, the conversation limits, and ask.json.
 *
 * commitQuestion is what keeps a follow-up valid: the history only ever grows by a whole, finished question, so
 * every case that must NOT commit is checked against an unchanged history, not just a false return. The file
 * cases check both directions: what was saved comes back exactly (a thinking block's signature included, since
 * Anthropic rejects an edited one), and anything this version cannot read is an empty conversation, never a throw.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  canAsk,
  commitQuestion,
  conversationBytes,
  newConversation,
  parseConversation,
  serializeConversation,
  shouldCommit,
  type AskEntry,
  type Conversation,
  type QuestionEnd,
} from "./conversation";
import { CONVERSATION_INPUT_TOKEN_LIMIT, MAX_CONVERSATION_FILE_BYTES, MAX_QUESTIONS_PER_CONVERSATION } from "./limits";
import { flightsMemoKey, type FlightsLookup } from "./tools";

const NOW = new Date("2026-09-10T15:00:00Z");
const now = () => NOW;

const USER: Anthropic.MessageParam = { role: "user", content: [{ type: "text", text: "Cheapest business class from SEA to Tokyo?" }] };
const THINKING = { type: "thinking", thinking: "", signature: "synthetic_signature_not_from_anthropic" } as const;
const TOOL_USE = { type: "tool_use", id: "toolu_synthetic_1", name: "search_awards", input: { origins: ["SEA"] }, caller: { type: "direct" } } as const;
const TEXT = { type: "text", text: "Alaska has 2 seats at 75,000 miles.", citations: null } as const;

const assistant = (...content: ReadonlyArray<{ type: string }>): Anthropic.MessageParam => ({
  role: "assistant",
  content: content as unknown as Anthropic.ContentBlockParam[],
});
const response = (stopReason: Anthropic.StopReason | null, ...content: ReadonlyArray<{ type: string }>): QuestionEnd => ({
  ended: "response",
  stopReason,
  content,
});

function entry(over: Partial<AskEntry> = {}): AskEntry {
  return {
    id: "entry-1",
    question: "Cheapest business class from SEA to Tokyo?",
    includeSearch: true,
    askedAt: NOW.toISOString(),
    steps: [
      {
        kind: "tool",
        step: {
          tool: "search_awards",
          outcome: "ok",
          calls: 2,
          fromCache: false,
          fromMemo: false,
          search: { origins: ["SEA"], destinations: ["NRT", "HND"], date_from: "2026-10-01", date_to: "2026-10-31", cabins: ["J"], programs: null, direct_only: false, max_miles: null },
          program: null,
          estimate: null,
        },
      },
      { kind: "paused" },
    ],
    texts: ["Alaska has 2 seats at 75,000 miles."],
    usage: { requests: 2, inputTokens: 9000, cacheReadTokens: 3956, outputTokens: 400, lastRequestInputTokens: 5000, toolCalls: 1, seatsCalls: 2 },
    end: { status: "answered", committed: true, failure: null, stoppedDuring: null, at: NOW.toISOString() },
    ...over,
  };
}

const LOOKUP: FlightsLookup = {
  id: "2PPrELk9WcfJaNREWEPXypvhXAD",
  cabin: "J",
  program: "alaska",
  booking_url: "https://www.alaskaair.com/search?from=SEA&to=NRT",
  trips_total: 1,
  trips: [
    {
      miles: 75000,
      fees: "$56",
      seats: 2,
      stops: 0,
      carriers: "JL",
      flights: "JL67",
      departs: "2026-10-14 13:05",
      arrives: "2026-10-15 15:25",
      segments: [{ flight: "JL67", from: "SEA", to: "NRT", departs: "2026-10-14 13:05", arrives: "2026-10-15 15:25", aircraft: "Boeing 787-9" }],
    },
  ],
};

/** A conversation with one committed question that used a tool, and every kind of state filled in. */
function filled(): Conversation {
  const c = newConversation({ id: "conv-1", now });
  c.committed.push(
    USER,
    assistant(THINKING, TOOL_USE),
    { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_synthetic_1", content: '{"rows_total":1}' }] },
    assistant(THINKING, TEXT),
  );
  c.entries.push(entry());
  c.seenIds.add(LOOKUP.id).add("2QSaUXJ0ZuSVqgrRWqkSlXhnVbS");
  c.bookingUrls.add(LOOKUP.booking_url!);
  c.flightsMemo.set(flightsMemoKey(LOOKUP.id, LOOKUP.cabin), LOOKUP);
  c.pending = { entryId: "entry-2", startedAt: NOW.toISOString() };
  return c;
}

describe("commitQuestion", () => {
  it.each(["end_turn", "stop_sequence", "max_tokens"] as const)("commits a whole question that ended with %s and no tool_use", (stopReason) => {
    const c = newConversation({ id: "c", now });
    const question = [USER, assistant(THINKING, TEXT)];
    expect(commitQuestion(c, question, response(stopReason, THINKING, TEXT))).toBe(true);
    expect(c.committed).toEqual(question);
  });

  it("commits every turn of a question that used tools, in order, after what was already committed", () => {
    const c = filled();
    const before = [...c.committed];
    const question = [USER, assistant(TOOL_USE), { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_synthetic_1", content: "{}" }] } as Anthropic.MessageParam, assistant(TEXT)];
    expect(commitQuestion(c, question, response("end_turn", TEXT))).toBe(true);
    expect(c.committed).toEqual([...before, ...question]);
  });

  it("commits an answer that holds only a thinking block", () => {
    expect(shouldCommit(response("end_turn", THINKING))).toBe(true);
  });

  it.each<[string, QuestionEnd]>([
    ["refusal", response("refusal", TEXT)],
    ["max_tokens with a trailing tool_use", response("max_tokens", TEXT, TOOL_USE)],
    ["tool_use", response("tool_use", TOOL_USE)],
    ["model_context_window_exceeded", response("model_context_window_exceeded", TEXT)],
    ["pause_turn", response("pause_turn", TEXT)],
    ["no stop reason", response(null, TEXT)],
    ["a response with no content at all", response("end_turn")],
    ["stopped", { ended: "stopped" }],
    ["failed", { ended: "failed" }],
    ["deadline", { ended: "deadline" }],
    ["request_limit", { ended: "request_limit" }],
  ])("leaves the history unchanged for %s", (_label, end) => {
    const c = filled();
    const before = JSON.stringify(c.committed);
    expect(commitQuestion(c, [USER, assistant(TEXT)], end)).toBe(false);
    expect(JSON.stringify(c.committed)).toBe(before);
  });

  it("refuses messages that are not one whole question, rather than corrupt the history", () => {
    const c = newConversation({ id: "c", now });
    const done = response("end_turn", TEXT);
    expect(commitQuestion(c, [], done)).toBe(false);
    expect(commitQuestion(c, [USER], done)).toBe(false);
    expect(commitQuestion(c, [assistant(TEXT)], done)).toBe(false);
    expect(commitQuestion(c, [USER, USER, assistant(TEXT)], done)).toBe(false);
    expect(c.committed).toEqual([]);
  });
});

describe("canAsk", () => {
  it("allows a new conversation and one below every limit", () => {
    expect(canAsk(null)).toEqual({ ok: true });
    expect(canAsk(filled())).toEqual({ ok: true });
  });

  it("refuses a ninth question, counting questions that did not finish", () => {
    const c = newConversation({ id: "c", now });
    for (let i = 0; i < MAX_QUESTIONS_PER_CONVERSATION - 1; i++) c.entries.push(entry({ id: `e${i}`, end: { status: "stopped", committed: false, failure: null, stoppedDuring: "request", at: NOW.toISOString() } }));
    expect(canAsk(c)).toEqual({ ok: true });
    c.entries.push(entry({ id: "e8" }));
    expect(canAsk(c)).toEqual({ ok: false, reason: "question_limit", message: "This conversation has reached 8 questions. Start a new conversation." });
  });

  it("refuses once the latest committed question's last request sent more than 120,000 input tokens", () => {
    const c = newConversation({ id: "c", now });
    const usage = entry().usage;
    c.entries.push(entry({ usage: { ...usage, lastRequestInputTokens: CONVERSATION_INPUT_TOKEN_LIMIT } }));
    expect(canAsk(c)).toEqual({ ok: true });
    c.entries.push(entry({ id: "e2", usage: { ...usage, lastRequestInputTokens: CONVERSATION_INPUT_TOKEN_LIMIT + 1 } }));
    expect(canAsk(c)).toEqual({
      ok: false,
      reason: "input_limit",
      message: "This conversation is long enough that each question re-sends a lot of text to Anthropic. Start a new conversation.",
      inputTokens: 120_001,
    });
  });

  it("does not count a large question that was not committed, whose turns are never resent", () => {
    const c = newConversation({ id: "c", now });
    const usage = entry().usage;
    c.entries.push(entry({ usage: { ...usage, lastRequestInputTokens: 6000 } }));
    c.entries.push(
      entry({ id: "e2", usage: { ...usage, lastRequestInputTokens: 150_000 }, end: { status: "stopped", committed: false, failure: null, stoppedDuring: "tool", at: NOW.toISOString() } }),
    );
    expect(canAsk(c)).toEqual({ ok: true });
  });

  it("refuses once the saved file would pass 1.5 MB", () => {
    const c = newConversation({ id: "c", now });
    c.entries.push(entry({ texts: ["x".repeat(MAX_CONVERSATION_FILE_BYTES)] }));
    const refused = canAsk(c);
    expect(refused).toMatchObject({ ok: false, reason: "file_limit", message: "This conversation is too large to send. Start a new conversation." });
    expect((refused as { bytes: number }).bytes).toBe(conversationBytes(c));
    expect(conversationBytes(c)).toBeGreaterThan(MAX_CONVERSATION_FILE_BYTES);
  });
});

describe("ask.json", () => {
  it("round-trips every field, sets and the memo included", () => {
    const c = filled();
    const back = parseConversation(serializeConversation(c));
    expect(back).toEqual(c);
    expect(back!.seenIds).toBeInstanceOf(Set);
    expect(back!.flightsMemo.get(flightsMemoKey(LOOKUP.id, "J"))).toEqual(LOOKUP);
    expect(serializeConversation(back)).toBe(serializeConversation(c));
  });

  it("brings the history back byte for byte, a thinking block's signature and a tool_use's caller included", () => {
    const c = filled();
    const back = parseConversation(serializeConversation(c))!;
    expect(JSON.stringify(back.committed)).toBe(JSON.stringify(c.committed));
    expect(JSON.stringify(back.committed[1])).toBe(JSON.stringify(assistant(THINKING, TOOL_USE)));
  });

  it("keeps a field a later version added, rather than discard the file", () => {
    const file = JSON.parse(serializeConversation(filled()));
    file.conversation.committed[3].content[1].future_field = { kept: true };
    const back = parseConversation(JSON.stringify(file))!;
    expect((back.committed[3]!.content as unknown as Array<Record<string, unknown>>)[1]!.future_field).toEqual({ kept: true });
  });

  it("an empty file round-trips to no conversation", () => {
    expect(serializeConversation(null)).toBe('{"version":1,"conversation":null}');
    expect(parseConversation(serializeConversation(null))).toBeNull();
  });

  it("starts empty for another version", () => {
    const file = JSON.parse(serializeConversation(filled()));
    expect(parseConversation(JSON.stringify({ ...file, version: 2 }))).toBeNull();
    expect(parseConversation(JSON.stringify({ conversation: file.conversation }))).toBeNull();
  });

  it("starts empty, and never throws, for a corrupt file", () => {
    const good = serializeConversation(filled());
    const file = () => JSON.parse(good);
    const broken: unknown[] = [
      undefined,
      null,
      "",
      "not json",
      good.slice(0, -20),
      "null",
      "[]",
      JSON.stringify({ ...file(), conversation: { ...file().conversation, id: 7 } }),
      JSON.stringify({ ...file(), conversation: { ...file().conversation, seenIds: [1] } }),
      JSON.stringify({ ...file(), conversation: { ...file().conversation, committed: [USER, USER] } }),
      JSON.stringify({ ...file(), conversation: { ...file().conversation, committed: [assistant(TEXT)] } }),
      JSON.stringify({ ...file(), conversation: { ...file().conversation, committed: [USER] } }),
      JSON.stringify({ ...file(), conversation: { ...file().conversation, flightsMemo: [{ ...LOOKUP, cabin: "Z" }] } }),
      JSON.stringify({ ...file(), conversation: { ...file().conversation, entries: [{ ...entry(), end: { ...entry().end, status: "done" } }] } }),
      JSON.stringify({ ...file(), conversation: { ...file().conversation, pending: { entryId: 3 } } }),
    ];
    for (const text of broken) {
      expect(() => parseConversation(text as string)).not.toThrow();
      expect(parseConversation(text as string), String(text).slice(0, 80)).toBeNull();
    }
  });
});
