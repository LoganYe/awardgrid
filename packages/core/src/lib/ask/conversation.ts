/**
 * One Ask conversation: the history Claude is sent, what the person sees, and the file that keeps both.
 *
 * Two lists live here and must not be confused:
 *
 *   - `committed` is the history every later request resends. It only ever grows, and only by a whole question
 *     that finished (commitQuestion). A question that was stopped, failed, or ended mid-tool leaves it exactly as it
 *     was, so the next request's history is a byte-identical prefix of what was sent before. That keeps the prompt
 *     cache readable and keeps earlier thinking blocks valid: Claude Opus 5 returns thinking blocks that must be
 *     passed back unchanged and in order (ThinkingBlockParam, SDK resources/messages/messages.d.ts:2408-2422), and a
 *     history that drops trailing turns without editing earlier ones never changes one (design assumption AS9).
 *   - `entries` is what the person sees: every question asked, finished or not, with its steps, texts and how it
 *     ended. Nothing in it is sent to Anthropic.
 *
 * The conversation is also the tools' state (ToolRunState, tools.ts): the ids search_awards returned, the booking
 * links get_flights returned, and the flights already looked up. The runner adds to them; nothing removes them.
 *
 * On disk it is `ask.json` (design §6.7), version 1. A file this code cannot read, from another version or cut
 * short, starts an empty conversation instead of failing: an unreadable history must never keep Ask from opening.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { Cabin, type QueryObject } from "../query/schema";
import type { QueryChangeProposal } from "../workspace/types";
import type { AskFailureCode } from "./errors";
import { CONVERSATION_INPUT_TOKEN_LIMIT, MAX_CONVERSATION_FILE_BYTES, MAX_QUESTIONS_PER_CONVERSATION } from "./limits";
import { flightsMemoKey, type FlightsLookup, type ToolRunState, type ToolStep } from "./tools";

export const CONVERSATION_FILE_VERSION = 1;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * How a question ended (design §3.6, §6.4).
 *
 *   answered, empty, truncated  a response ended the question; only one of these with text can be committed
 *   refused                      stop_reason "refusal"
 *   too_long                     stop_reason "model_context_window_exceeded"
 *   stopped                      the person pressed Stop
 *   deadline                     no new step starts once the question has run ASK_QUESTION_LIMIT_MS
 *   request_limit                all MAX_MODEL_REQUESTS requests were used; not the 450 s bound on one request,
 *                                which is a failure with the code "request_limit" (errors.ts)
 *   failed                       an error, or a stop reason this app does not handle
 */
export type QuestionStatus = "answered" | "empty" | "truncated" | "refused" | "too_long" | "stopped" | "deadline" | "request_limit" | "failed";

/** describeAskError's codes, plus the loop's own for a response that ended in a way no row of §3.6 handles. */
export type QuestionFailureCode = AskFailureCode | "unexpected_stop";

export interface QuestionFailure {
  code: QuestionFailureCode;
  retryable: boolean;
  message: string;
  requestId: string | null;
}

/** What was under way when Stop was pressed: a model request, a tool call, or neither. The Stop copy differs (§6.4). */
export type StopMoment = "request" | "tool" | "between";

/** What one question spent, summed over its requests (design §5). */
export interface QuestionUsage {
  /** Requests sent, a resend by "Try again" included. */
  requests: number;
  /** input_tokens + cache_creation_input_tokens + cache_read_input_tokens, summed: every input token sent, cached or not. */
  inputTokens: number;
  /** cache_read_input_tokens, summed: the part of inputTokens read from the prompt cache. */
  cacheReadTokens: number;
  /** output_tokens, summed. On Claude Opus 5 this includes thinking (design assumption AS6). */
  outputTokens: number;
  /** The input of this question's latest request that returned a response; null until one did. canAsk reads it. */
  lastRequestInputTokens: number | null;
  /** tool_use blocks handled, refused ones included. */
  toolCalls: number;
  /** seats.aero requests this question's tools sent. */
  seatsCalls: number;
}

/** One step in an entry's list: a tool call with the facts its label is built from, or a pause while the app was hidden. */
export type EntryStep = { kind: "tool"; step: ToolStep } | { kind: "paused" };

export interface EntryEnd {
  /** "unfinished": the app was closed while the question ran (a `pending` marker found on relaunch). */
  status: QuestionStatus | "unfinished";
  /** Whether the question joined `committed`. */
  committed: boolean;
  failure: QuestionFailure | null;
  stoppedDuring: StopMoment | null;
  /** ISO time the question ended. */
  at: string;
}

/**
 * What went with a question besides its history (UI/UX v1 T15), recorded from the payload itself, never from a
 * checkbox. Absent on entries from before T15.
 */
export interface EntryContext {
  /** Of the person's search: nothing, its conditions, or its conditions and the results they attached. */
  sent: "none" | "query_only" | "query_and_selected_rows";
  /** The trusted snapshot the search and results came from; null when nothing of it was sent. */
  snapshotId: string | null;
  revision: number | null;
  /** The results sent, in order (R1, R2…): references into that snapshot, never copies of a model's numbers. */
  refs: Array<{ snapshotId: string; rowKey: string }>;
  /** Earlier questions and answers in this conversation that were resent with it. */
  earlier: number;
}

/**
 * A change to the search Claude proposed during a question (T16), as the tool layer validated it: the query it was
 * made against (`base`, null when no search was included), and its status. Applied at most once, by the person.
 */
export interface EntryProposal extends QueryChangeProposal {
  base: QueryObject | null;
}

/** One question as the person sees it. Entries are kept oldest first, and shown that way (T15, docs/04 S09). */
export interface AskEntry {
  id: string;
  /** The trimmed question. */
  question: string;
  /** Whether the person included their last search, so "Ask again" can repeat the choice. */
  includeSearch: boolean;
  /** What was sent with it (T15). Read with care: a file from elsewhere may carry anything here. */
  context?: EntryContext;
  /** Changes to the search Claude proposed (T16). Read with care, as `context`. */
  proposals?: EntryProposal[];
  /** ISO time the question started. */
  askedAt: string;
  steps: EntryStep[];
  /** The texts Claude wrote for this question, in order. A refusal's partial text is never among them. */
  texts: string[];
  usage: QuestionUsage;
  /** null while the question runs. */
  end: EntryEnd | null;
}

export interface Conversation extends ToolRunState {
  id: string;
  /** ISO time the conversation started. */
  createdAt: string;
  /** The history every request resends: user and assistant turns alternating, starting with user, ending with assistant. */
  committed: Anthropic.MessageParam[];
  entries: AskEntry[];
  /** Set while a question runs and saved with it, so a question the app was closed during is found on relaunch. */
  pending: { entryId: string; startedAt: string } | null;
}

export function newConversation(opts: { id: string; now: () => Date }): Conversation {
  return {
    id: opts.id,
    createdAt: opts.now().toISOString(),
    committed: [],
    entries: [],
    seenIds: new Set(),
    bookingUrls: new Set(),
    flightsMemo: new Map(),
    pending: null,
  };
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

/** How a question ended, as far as the history is concerned: with a response, or without one that may be kept. */
export type QuestionEnd =
  | { ended: "response"; stopReason: Anthropic.StopReason | null; content: ReadonlyArray<{ type: string; text?: unknown }> }
  | { ended: "stopped" | "failed" | "deadline" | "request_limit" };

/**
 * The commit rule (design §3.5): only a response that ended with end_turn, stop_sequence or max_tokens, and carries
 * no tool_use block. A tool_use with no tool_result after it would make the next request invalid, and a refusal's
 * partial output is to be discarded (claude-api shared/model-migration.md, "refusal").
 *
 * One narrowing of the design's table: the response must also carry at least one text block with more than
 * whitespace in it, the test loop.ts uses to tell an answer from an empty one. A response with no content, only
 * blank text or only a thinking block adds nothing Claude could read back as an answer, and the Messages API
 * documentation says nothing about accepting such an assistant turn in the middle of a history, so committing one
 * would risk every later question for no gain. The question still ends as empty or truncated; only the history
 * leaves it out.
 */
export function shouldCommit(end: QuestionEnd): boolean {
  if (end.ended !== "response") return false;
  if (end.content.some((block) => block.type === "tool_use") || !end.content.some(isAnswerText)) return false;
  return end.stopReason === "end_turn" || end.stopReason === "stop_sequence" || end.stopReason === "max_tokens";
}

/** A text block with more than whitespace in it: the blocks loop.ts textsOf shows as an answer. */
function isAnswerText(block: { type: string; text?: unknown }): boolean {
  return block.type === "text" && typeof block.text === "string" && block.text.trim().length > 0;
}

/**
 * Append a finished question's messages to `committed` when shouldCommit allows it. Returns whether it did.
 *
 * `messages` must be one whole question: user first, alternating, assistant last. Anything else is refused rather
 * than appended, because a malformed history would fail every later request in the conversation, and a question
 * left out only loses that question.
 */
export function commitQuestion(conversation: Conversation, messages: readonly Anthropic.MessageParam[], end: QuestionEnd): boolean {
  if (!shouldCommit(end)) return false;
  if (messages.length === 0 || !alternates(messages) || messages[messages.length - 1]!.role !== "assistant") return false;
  conversation.committed.push(...messages);
  return true;
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export type CanAsk =
  | { ok: true }
  | { ok: false; reason: "question_limit"; message: string }
  | { ok: false; reason: "input_limit"; message: string; inputTokens: number }
  | { ok: false; reason: "file_limit"; message: string; bytes: number };

/**
 * Whether a new question may start in `conversation` (design §3.2). A null conversation is a new one.
 *
 *   1. It already holds MAX_QUESTIONS_PER_CONVERSATION questions, finished or not.
 *   2. The input a follow-up would resend is above CONVERSATION_INPUT_TOKEN_LIMIT. That is read from the latest
 *      COMMITTED question's last request, whose input was the history then plus that question's own turns: very
 *      nearly what the next question resends. A question that was not committed is skipped, because its turns are
 *      not resent, and a large tool result it read must not end a conversation whose history is small.
 *   3. The saved file would be above MAX_CONVERSATION_FILE_BYTES.
 */
export function canAsk(conversation: Conversation | null): CanAsk {
  if (conversation === null) return { ok: true };
  if (conversation.entries.length >= MAX_QUESTIONS_PER_CONVERSATION) {
    return {
      ok: false,
      reason: "question_limit",
      message: `This conversation has reached ${MAX_QUESTIONS_PER_CONVERSATION} questions. Start a new conversation.`,
    };
  }
  const lastCommitted = conversation.entries.findLast((entry) => entry.end?.committed === true);
  const inputTokens = lastCommitted?.usage.lastRequestInputTokens ?? 0;
  if (inputTokens > CONVERSATION_INPUT_TOKEN_LIMIT) {
    return {
      ok: false,
      reason: "input_limit",
      message: "This conversation is long enough that each question re-sends a lot of text to Anthropic. Start a new conversation.",
      inputTokens,
    };
  }
  const bytes = conversationBytes(conversation);
  if (bytes > MAX_CONVERSATION_FILE_BYTES) {
    return { ok: false, reason: "file_limit", message: "This conversation is too large to send. Start a new conversation.", bytes };
  }
  return { ok: true };
}

/** The size of `ask.json` for this conversation, in UTF-8 bytes. */
export function conversationBytes(conversation: Conversation | null): number {
  return new TextEncoder().encode(serializeConversation(conversation)).byteLength;
}

// ---------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------

/** `ask.json`: sets and the memo map become arrays, in the order they were added. */
export function serializeConversation(conversation: Conversation | null): string {
  if (conversation === null) return JSON.stringify({ version: CONVERSATION_FILE_VERSION, conversation: null });
  return JSON.stringify({
    version: CONVERSATION_FILE_VERSION,
    conversation: {
      id: conversation.id,
      createdAt: conversation.createdAt,
      committed: conversation.committed,
      entries: conversation.entries,
      seenIds: [...conversation.seenIds],
      bookingUrls: [...conversation.bookingUrls],
      flightsMemo: [...conversation.flightsMemo.values()],
      pending: conversation.pending,
    },
  });
}

/**
 * Read `ask.json`. Anything this version cannot read in full (another version, a cut-short write, a hand edit that
 * breaks a shape, a history that no longer alternates) is an empty conversation, null, and never an exception.
 *
 * The file is checked with zod and then used as parsed, not as zod rebuilt it: history blocks are sent back to
 * Anthropic, and a thinking block's fields must return exactly as they were received (messages.d.ts:2408-2422).
 */
export function parseConversation(text: string | null | undefined): Conversation | null {
  if (typeof text !== "string" || text.length === 0) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const checked = ConversationFile.safeParse(raw);
  if (!checked.success || checked.data.conversation === null) return null;
  const file = (raw as { conversation: RawConversation }).conversation;
  if (!alternates(file.committed) || (file.committed.length > 0 && file.committed[file.committed.length - 1]!.role !== "assistant")) return null;
  return {
    id: file.id,
    createdAt: file.createdAt,
    committed: file.committed,
    entries: file.entries,
    seenIds: new Set(file.seenIds),
    bookingUrls: new Set(file.bookingUrls),
    flightsMemo: new Map(file.flightsMemo.map((lookup) => [flightsMemoKey(lookup.id, lookup.cabin), lookup])),
    pending: file.pending,
  };
}

interface RawConversation {
  id: string;
  createdAt: string;
  committed: Anthropic.MessageParam[];
  entries: AskEntry[];
  seenIds: string[];
  bookingUrls: string[];
  flightsMemo: FlightsLookup[];
  pending: { entryId: string; startedAt: string } | null;
}

/** User first, then strictly alternating. An empty history alternates trivially. */
function alternates(messages: readonly Anthropic.MessageParam[]): boolean {
  return messages.every((message, i) => message.role === (i % 2 === 0 ? "user" : "assistant"));
}

// Shapes of the file. Objects are loose, so a field added later does not make an older reader discard the file.

const Count = z.number().int().nonnegative();

const ContentBlock = z.looseObject({ type: z.string() });

const MessageParamFile = z.looseObject({
  role: z.enum(["user", "assistant"]),
  content: z.union([z.string(), z.array(ContentBlock)]),
});

const ToolStepFile = z.looseObject({
  tool: z.string(),
  outcome: z.string(),
  calls: Count,
  fromCache: z.boolean(),
  fromMemo: z.boolean(),
  search: z.looseObject({}).nullable(),
  program: z.string().nullable(),
  estimate: z.number().nullable(),
});

const EntryStepFile = z.discriminatedUnion("kind", [
  z.looseObject({ kind: z.literal("tool"), step: ToolStepFile }),
  z.looseObject({ kind: z.literal("paused") }),
]);

const QuestionUsageFile = z.looseObject({
  requests: Count,
  inputTokens: Count,
  cacheReadTokens: Count,
  outputTokens: Count,
  lastRequestInputTokens: Count.nullable(),
  toolCalls: Count,
  seatsCalls: Count,
});

const EntryEndFile = z.looseObject({
  status: z.enum(["answered", "empty", "truncated", "refused", "too_long", "stopped", "deadline", "request_limit", "failed", "unfinished"]),
  committed: z.boolean(),
  failure: z
    .looseObject({ code: z.string(), retryable: z.boolean(), message: z.string(), requestId: z.string().nullable() })
    .nullable(),
  stoppedDuring: z.enum(["request", "tool", "between"]).nullable(),
  at: z.string(),
});

const AskEntryFile = z.looseObject({
  id: z.string(),
  question: z.string(),
  includeSearch: z.boolean(),
  askedAt: z.string(),
  steps: z.array(EntryStepFile),
  texts: z.array(z.string()),
  usage: QuestionUsageFile,
  end: EntryEndFile.nullable(),
});

const FlightsLookupFile = z.looseObject({
  id: z.string(),
  cabin: Cabin,
  program: z.string().nullable(),
  looked_up_at: z.string(),
  booking_url: z.string().nullable(),
  trips_total: Count,
  trips: z.array(z.looseObject({})),
});

const ConversationFile = z.looseObject({
  version: z.literal(CONVERSATION_FILE_VERSION),
  conversation: z
    .looseObject({
      id: z.string(),
      createdAt: z.string(),
      committed: z.array(MessageParamFile),
      entries: z.array(AskEntryFile),
      seenIds: z.array(z.string()),
      bookingUrls: z.array(z.string()),
      flightsMemo: z.array(FlightsLookupFile),
      pending: z.looseObject({ entryId: z.string(), startedAt: z.string() }).nullable(),
    })
    .nullable(),
});
