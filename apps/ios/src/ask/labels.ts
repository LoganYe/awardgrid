/**
 * Every sentence and label Ask shows, in one file, so apps/ios/src/honesty.test.ts reads all of them.
 *
 * The copy is design §5, §6.4 and §7. Where one of the design's sentences would be false for a case the design did
 * not separate, that case gets its own sentence instead of the nearest one:
 *
 *   - A search is refused as too wide for three reasons (core tools.ts): more airport pairs than one search may
 *     cover, which comes with no estimate; an estimate above the pages any one search may pull (SEARCH_PAGE_CAP),
 *     however many calls the question has left; and an estimate above what the question has left. Only the last
 *     is "more than this question has left".
 *   - Stop has three moments (core loop.ts StopMoment). "between" means neither a request nor a tool call was
 *     under way. The question was waiting for its next step: for the save of the step before it to land, for
 *     awardgrid to be visible again, or for a watch run to finish.
 *   - A search can be refused with no calls to spend for two reasons the step does not tell apart: the question's
 *     own calls are used up, or today's calls above the reserve are (core budget.ts planSearchSpend, the race in
 *     its step 1). Its sentence names neither.
 *   - A key check is a GET with no prompt. Core's failure sentences are written for a question, and some speak of
 *     billing or of the conversation, so a key check quotes only those that are about the request alone.
 *   - Stop during a tool call that spent no call (a read from this device's cache) does not say a call counted.
 *
 * Failure messages are core's (errors.ts describeAskError, loop.ts), already masked of both keys. This file adds
 * the request ID line and says which action fits the failure.
 */
import type {
  AskEntry,
  EntryStep,
  QuestionFailure,
  QuestionFailureCode,
  QuestionUsage,
  StopMoment,
} from "@awardgrid/core/ask/conversation";
import { askRequestIdLine } from "@awardgrid/core/ask/errors";
import { promisesFollowUp } from "@awardgrid/core/ask/guard";
import {
  ASK_QUESTION_LIMIT_MS,
  ASK_QUOTA_RESERVE,
  MAX_FLIGHTS_PER_QUESTION,
  MAX_MODEL_REQUESTS,
  MAX_PAIRS,
  MAX_SEARCHES_PER_QUESTION,
  MAX_TOOL_CALLS,
  QUESTION_SEATS_CALL_CAP,
  SEARCH_PAGE_CAP,
} from "@awardgrid/core/ask/limits";
import { GET_FLIGHTS, SEARCH_AWARDS, type ToolStep } from "@awardgrid/core/ask/tools";
import { SOURCE_NAMES } from "@awardgrid/core/seatsaero/types";

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

/** "No calls", "1 call", "12 calls". */
export function callsLabel(n: number): string {
  return n === 0 ? "No calls" : count(n, "call", "calls");
}

/** "No requests", "1 request", "6 requests". */
export function requestsLabel(n: number): string {
  return n === 0 ? "No requests" : count(n, "request", "requests");
}

// ---------------------------------------------------------------------------
// The search a step or a context line describes
// ---------------------------------------------------------------------------

/** A search as a tool step echoes it, or as the last grid search's query holds it. */
export interface SummarySearch {
  origins: readonly string[];
  destinations: readonly string[];
  date_from: string;
  date_to: string;
  /** Cabin letters: Y, W, J, F. */
  cabins: readonly string[];
  programs?: readonly string[] | null;
  direct_only?: boolean;
  max_miles?: number | null;
}

const CABIN_NAMES: Readonly<Record<string, string>> = { Y: "economy", W: "premium economy", J: "business", F: "first" };

/**
 * "SEA to NRT, HND, 2026-10-01 to 2026-10-30, business". A narrower search says how: "direct only", the programs by
 * name, "up to 80,000 miles". A step that dropped those would describe a wider search than the one that ran.
 */
export function searchSummary(search: SummarySearch): string {
  const parts = [
    `${search.origins.join(", ")} to ${search.destinations.join(", ")}`,
    `${search.date_from} to ${search.date_to}`,
    joinAnd(search.cabins.map((cabin) => CABIN_NAMES[cabin] ?? cabin)),
  ];
  if (search.direct_only) parts.push("direct only");
  if (search.programs && search.programs.length > 0) parts.push(joinAnd(search.programs.map(programName)));
  if (typeof search.max_miles === "number") parts.push(`up to ${thousands(search.max_miles)} miles`);
  return parts.filter((part) => part.length > 0).join(", ");
}

/** The context checkbox. */
export function includeSearchLabel(summary: string): string {
  return `Include my last search: ${summary}`;
}

// ---------------------------------------------------------------------------
// While a question runs
// ---------------------------------------------------------------------------

/** Shown next to Stop before any tap, so what Stop can do is known before it is pressed. */
export const STOP_NOTE = "Stop sends nothing more. It cannot recall a request already sent.";

/** Counts up from the moment the request went out; it never estimates how long is left. */
export function waitingLabel(elapsedSeconds: number): string {
  return `Waiting for Claude (${Math.max(0, Math.floor(elapsedSeconds))} s)`;
}

/**
 * The tool call under way. Its input is what Claude sent, not yet checked by the runner, so a search is summarised
 * only when its fields have the shapes a summary needs; metro codes are shown as Claude wrote them.
 */
export function toolRunningLabel(name: string, input: unknown): string {
  if (name === SEARCH_AWARDS) {
    const search = searchFromInput(input);
    return search === null ? "Searching seats.aero" : `Searching seats.aero: ${searchSummary(search)}`;
  }
  if (name === GET_FLIGHTS) return "Looking up flights on seats.aero";
  return "Checking a tool request from Claude";
}

/** One visually hidden status region announces transitions only (design §6.5). */
export const ANNOUNCEMENTS = {
  waiting: "Waiting for Claude",
  searching: "Searching seats.aero",
  answered: "Answer ready",
  stopped: "Stopped",
  failed: "Ask failed",
} as const;

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export const PAUSED_STEP = "Paused while you were away from awardgrid.";

export function stepLabel(entryStep: EntryStep): string {
  if (entryStep.kind === "paused") return PAUSED_STEP;
  const { step } = entryStep;
  if (step.tool === SEARCH_AWARDS) return searchStepLabel(step);
  if (step.tool === GET_FLIGHTS) return flightsStepLabel(step);
  return `Claude asked for a tool awardgrid does not have. ${callsLabel(step.calls)}.`;
}

function searchStepLabel(step: ToolStep): string {
  const what = step.search === null ? "" : `: ${searchSummary(step.search)}`;
  const spent = `${callsLabel(step.calls)}.`;
  switch (step.outcome) {
    case "ok":
      return step.fromCache && step.calls === 0 ? `Read from this device's cache${what}. No calls.` : `Searched seats.aero${what}. ${spent}`;
    case "too_wide":
      // The pair-count refusal comes before any estimate is made (tools.ts), so it carries none.
      if (step.estimate === null) return `Search refused: it covers more airport pairs than the ${MAX_PAIRS} one search may cover. No calls.`;
      if (step.estimate > SEARCH_PAGE_CAP) {
        return `Search refused: it needs about ${count(step.estimate, "call", "calls")}, more than the ${SEARCH_PAGE_CAP} one search may spend on results. Claude was asked to narrow it.`;
      }
      return `Search refused: it needs about ${count(step.estimate, "call", "calls")}, more than this question has left. Claude was asked to narrow it.`;
    case "quota_reserve":
      return `Search not run: it would use calls from the last ${ASK_QUOTA_RESERVE} of today's quota, which are kept for your own searches.`;
    case "limit_reached":
      // The budget guard stopped a search that had already sent requests.
      if (step.calls > 0) return `Search stopped after ${count(step.calls, "call", "calls")}, the most it was allowed.`;
      // Refused before its input was read: the question's search or tool-call limit.
      if (step.search === null) return `Search not run: this question reached its limit of ${MAX_SEARCHES_PER_QUESTION} searches or ${MAX_TOOL_CALLS} tool calls. No calls.`;
      // No calls to spend: the question's used up, or a covered search planned at the reserve whose cache coverage
      // expired before it ran (budget.ts). The step does not say which, so neither is named.
      return "Search not run: no seats.aero calls were left for it to spend. No calls.";
    case "invalid_place":
      return "Search not run: Claude used a place code awardgrid does not know. No calls.";
    case "invalid_input":
      return "Search not run: the search Claude asked for was not valid. No calls.";
    case "quota":
      return `Search failed: today's seats.aero quota is used up. ${spent}`;
    case "seatsaero_key_rejected":
      return `Search failed: seats.aero rejected your key. ${spent}`;
    case "network":
      return `Search failed: the request to seats.aero failed. ${spent}`;
    case "seatsaero_error":
      return `Search failed: seats.aero could not complete it. ${spent}`;
    case "tool_failed":
      return `Search failed inside awardgrid. ${spent}`;
    default:
      return `Search ended without a result. ${spent}`;
  }
}

function flightsStepLabel(step: ToolStep): string {
  const spent = `${callsLabel(step.calls)}.`;
  switch (step.outcome) {
    case "ok":
      if (step.fromMemo) return "Showed flights looked up earlier in this conversation. No calls.";
      return step.program === null ? `Looked up flights for one result. ${spent}` : `Looked up flights for one ${programName(step.program)} result. ${spent}`;
    case "unknown_id":
      return "Flights not looked up: Claude named a result this conversation's searches did not return. No calls.";
    case "quota_reserve":
      return `Flights not looked up: it would use a call from the last ${ASK_QUOTA_RESERVE} of today's quota, which are kept for your own searches.`;
    case "limit_reached":
      if (step.calls > 0) return `Flight lookup stopped after ${count(step.calls, "call", "calls")}, the most it was allowed.`;
      return `Flights not looked up: this question reached one of its limits (${MAX_FLIGHTS_PER_QUESTION} lookups, ${MAX_TOOL_CALLS} tool calls, ${QUESTION_SEATS_CALL_CAP} seats.aero calls). No calls.`;
    case "invalid_input":
      return "Flights not looked up: Claude's request could not be read. No calls.";
    case "quota":
      return `Flight lookup failed: today's seats.aero quota is used up. ${spent}`;
    case "seatsaero_key_rejected":
      return `Flight lookup failed: seats.aero rejected your key. ${spent}`;
    case "network":
      return `Flight lookup failed: the request to seats.aero failed. ${spent}`;
    case "seatsaero_error":
      return `Flight lookup failed: seats.aero could not complete it. ${spent}`;
    case "tool_failed":
      return `Flight lookup failed inside awardgrid. ${spent}`;
    default:
      return `Flight lookup ended without a result. ${spent}`;
  }
}

// ---------------------------------------------------------------------------
// How a question ended
// ---------------------------------------------------------------------------

export const STOPPED_DURING_REQUEST =
  "Stopped. Nothing more will be sent for this question. The request already sent to Anthropic still finishes and may be billed.";
const STOPPED_DURING_SEARCH = "Stopped. The seats.aero search already under way could not be recalled; it finishes and counts toward today's calls.";
const STOPPED_DURING_LOOKUP = "Stopped. The seats.aero lookup already under way could not be recalled; it finishes and counts toward today's calls.";
const STOPPED_DURING_FREE_STEP = "Stopped. The step under way finished without a seats.aero call, and nothing more will be sent for this question.";
const STOPPED_BETWEEN = "Stopped before the next step began. Nothing more will be sent for this question.";

/**
 * The Stop sentence for the moment Stop was pressed. For a tool call, `tool` is the step that was under way: the loop
 * lets it finish and records it before the question ends, so it is the entry's last tool step.
 */
export function stoppedLabel(during: StopMoment, tool: ToolStep | null = null): string {
  if (during === "request") return STOPPED_DURING_REQUEST;
  if (during === "between") return STOPPED_BETWEEN;
  if (tool !== null && tool.calls === 0) return STOPPED_DURING_FREE_STEP;
  return tool?.tool === GET_FLIGHTS ? STOPPED_DURING_LOOKUP : STOPPED_DURING_SEARCH;
}

export const UNFINISHED = "This question did not finish because awardgrid was closed while it ran. Requests already sent may have been billed.";

/** The sentence under an ended entry; null while it runs and for an answer, which speaks for itself. */
export function endLabel(entry: Pick<AskEntry, "end" | "steps">): string | null {
  const end = entry.end;
  if (end === null) return null;
  switch (end.status) {
    case "answered":
      return null;
    case "empty":
      return "Claude returned no text. Ask again.";
    case "truncated":
      return "The answer reached its length limit and is cut off.";
    case "refused":
      return "Claude declined to answer this question.";
    case "too_long":
      // model_context_window_exceeded: the request was accepted, and Claude's context window filled while it answered.
      return "Claude ran out of room in its context window before finishing this answer. Start a new conversation.";
    case "deadline":
      return `No new step started after ${ASK_QUESTION_LIMIT_MS / 60_000} minutes, the most one question may take, so this question ended without an answer.`;
    case "request_limit":
      return `This question has used its ${MAX_MODEL_REQUESTS} requests.`;
    case "stopped":
      return stoppedLabel(end.stoppedDuring ?? "between", lastToolStep(entry.steps));
    case "failed":
      return end.failure?.message ?? ANNOUNCEMENTS.failed;
    case "unfinished":
      return UNFINISHED;
  }
}

export const TRY_AGAIN = "Try again";
export const TRY_AGAIN_HINT = "Sends the same request again. If the first one reached Anthropic, both may be billed.";
export const ASK_AGAIN = "Ask again";

/** Design §6.4: a failure offers "Try again" when a resend is on offer, and "Ask again" otherwise. */
export type FailureAction = "try_again" | "ask_again";

/** Where a failure's own sentence sends the person: offered beside the action, never in its place. */
export type FailureDestination = "settings" | "new_conversation";

export interface FailureView {
  /** Core's sentence, masked of both keys. */
  message: string;
  /** "Anthropic request ID: …" when Anthropic's response carried one. */
  requestIdLine: string | null;
  /**
   * Try again when the loop offers a resend (canRetry), Ask again otherwise. Ask again is open on every ended entry
   * all the same (design §3.8, AskService.askAgain), so a screen never hides it because of this field.
   */
  action: FailureAction;
  /** The note under Try again. */
  hint: string | null;
  /** Settings for a key Anthropic will not take, a new conversation for one too large to send; null otherwise. */
  goTo: FailureDestination | null;
}

/**
 * The failures whose sentence points somewhere Ask again cannot fix on its own. A Record, so a failure code added in
 * core does not compile until it has a row here.
 */
const FAILURE_DESTINATIONS: Record<QuestionFailureCode, FailureDestination | null> = {
  stopped: null,
  request_limit: null,
  anthropic_key_missing: "settings",
  anthropic_key_rejected: "settings",
  model_unavailable: "settings",
  anthropic_forbidden: null,
  spend_limit: null,
  rate_limited: null,
  bad_request: null,
  too_large: "new_conversation",
  overloaded: null,
  overloaded_mid_answer: null,
  anthropic_error: null,
  unreadable_response: null,
  connection_failed: null,
  connection_failed_left_app: null,
  wiring: null,
  unexpected_stop: null,
};

/** `canRetry` is the failed outcome's, which only a running session has; a failure read back from ask.json has none. */
export function failureView(failure: QuestionFailure, canRetry: boolean): FailureView {
  const action: FailureAction = canRetry ? "try_again" : "ask_again";
  return {
    message: failure.message,
    requestIdLine: failure.requestId ? askRequestIdLine(failure.requestId) : null,
    action,
    hint: action === "try_again" ? TRY_AGAIN_HINT : null,
    // A code from a newer file this build does not know points nowhere, and still has Ask again.
    goTo: (FAILURE_DESTINATIONS as Partial<Record<string, FailureDestination | null>>)[failure.code] ?? null,
  };
}

// ---------------------------------------------------------------------------
// Under an answer
// ---------------------------------------------------------------------------

/** The one model Ask calls (core limits.ts ASK_MODEL, "claude-opus-5"), as the meta line names it. */
export const MODEL_NAME = "Claude Opus 5";

/**
 * "Claude Opus 5 · 2 requests · 9,000 input tokens (3,956 read from cache) · 400 output tokens · seats.aero calls: 2".
 * Tokens and calls only: the app cannot know the person's rate, so it never shows a price (design §5).
 */
export function metaLine(usage: QuestionUsage): string {
  return [
    MODEL_NAME,
    requestsLabel(usage.requests),
    `${count(usage.inputTokens, "input token", "input tokens")} (${thousands(usage.cacheReadTokens)} read from cache)`,
    count(usage.outputTokens, "output token", "output tokens"),
    `seats.aero calls: ${thousands(usage.seatsCalls)}`,
  ].join(" · ");
}

export const ATTRIBUTION = "Data: seats.aero";

/** Whenever the answer may rest on seats.aero data: a search was included, or a tool read seats.aero. */
export function showsAttribution(entry: Pick<AskEntry, "includeSearch" | "steps">): boolean {
  return entry.includeSearch || entry.steps.some((s) => s.kind === "tool" && s.step.outcome === "ok");
}

export const FOLLOW_UP_NOTE =
  "awardgrid cannot look again later or send you anything. To follow a route, use Watch this search on the Search screen, which checks when you open the app.";

/** Whether an answer offers a follow-up awardgrid cannot deliver (core guard.ts). The answer itself is never changed. */
export function showsFollowUpNote(entry: Pick<AskEntry, "texts">): boolean {
  return entry.texts.some(promisesFollowUp);
}

// ---------------------------------------------------------------------------
// The conversation, and what refuses a question before it starts
// ---------------------------------------------------------------------------

export const NO_ANTHROPIC_KEY = "Ask needs your own Anthropic API key. Add one in Settings. Search and watches work without it.";
export const NO_SEATS_KEY = "Ask searches seats.aero with your own Pro key. Add it in Settings first.";
/** The same words core gives a wiring failure (errors.ts), for the state found before any request. */
export const WIRING = "Ask cannot reach Anthropic from this build: native HTTP is not available. This is a wiring bug, not an outage.";
export const BUSY = "A question is already running. Stop it or wait for the answer.";
export const CLEARED = "Conversation cleared.";
export const NEW_CONVERSATION = "New conversation";
export const CONVERSATION_NOTE = "Answers in this conversation are saved on this device until you start a new conversation.";
/** Try again resends with the keys the question started on; after either changes in Settings, nothing is resent. */
export const KEYS_CHANGED = "A key in Settings changed after this question failed, so its request was not resent. Ask again to use the keys on file now.";
export const RETRY_UNAVAILABLE = "This request can no longer be resent. Ask again.";

// ---------------------------------------------------------------------------
// Settings: the Anthropic key check (design §7)
// ---------------------------------------------------------------------------

export type KeyCheckOutcome = "accepted" | "rejected" | "cannot_use" | "unreachable" | "not_confirmed" | "no_key" | "keychain" | "wiring";

export const KEY_ACCEPTED = "Anthropic accepted this key for Claude Opus 5. Checking sends no question.";
export const KEY_REJECTED = "Anthropic rejected this key.";
export const KEY_CANNOT_USE = "Anthropic accepted this key, but it cannot use Claude Opus 5.";
export const KEY_UNREACHABLE = "Could not reach Anthropic. The key is saved; check it again when you are online.";
export const NO_KEY_ON_FILE = "No Anthropic key on file.";
export const KEY_REMOVED = "Anthropic key removed from the Keychain.";
export const KEY_NOT_CONFIRMED = "The key is saved, but Anthropic did not confirm it.";
export const KEY_RESPONSE_UNREADABLE = "The key is saved, but Anthropic's response to the check could not be read, so the key is not confirmed.";

/**
 * The failures whose core sentence is about the request alone (a status, a limit, Anthropic's own words), and so is
 * as true of a key check as of a question. The rest speak of billing, the answer or the conversation, which a GET
 * with no prompt has none of, and a code added in core is left out until it is read and listed here.
 */
const CHECK_QUOTES: ReadonlySet<QuestionFailureCode> = new Set(["spend_limit", "rate_limited", "bad_request", "overloaded", "anthropic_error"]);

/** A Keychain write that failed, shown as a failure (as SettingsScreen shows the seats.aero key's). */
export function keySaveFailedLabel(message: string): string {
  return `Could not save the key: ${message}`;
}

export function keyReadFailedLabel(message: string): string {
  return `Could not read the key from the Keychain: ${message}`;
}

/** A failed key check, by what Anthropic or the transport said. Only called for a key that is on file. */
export function keyCheckFromFailure(failure: QuestionFailure): { outcome: KeyCheckOutcome; message: string } {
  switch (failure.code) {
    case "anthropic_key_rejected":
      return { outcome: "rejected", message: KEY_REJECTED };
    case "anthropic_forbidden":
    case "model_unavailable":
      return { outcome: "cannot_use", message: KEY_CANNOT_USE };
    case "connection_failed":
    case "connection_failed_left_app":
      return { outcome: "unreachable", message: KEY_UNREACHABLE };
    case "wiring":
      return { outcome: "wiring", message: WIRING };
    case "anthropic_key_missing":
      return { outcome: "no_key", message: NO_KEY_ON_FILE };
    case "unreadable_response":
      return { outcome: "not_confirmed", message: KEY_RESPONSE_UNREADABLE };
    default:
      if (CHECK_QUOTES.has(failure.code)) return { outcome: "not_confirmed", message: `The key is saved, but Anthropic did not confirm it: ${failure.message}` };
      return { outcome: "not_confirmed", message: KEY_NOT_CONFIRMED };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function count(n: number, one: string, many: string): string {
  return `${thousands(n)} ${n === 1 ? one : many}`;
}

function thousands(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** "business", "business and first", "economy, business and first". */
function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** seats.aero's program name ("Alaska Mileage Plan"), or the source code itself for one this build does not know. */
function programName(source: string): string {
  return (SOURCE_NAMES as Partial<Record<string, string>>)[source] ?? source;
}

function lastToolStep(steps: readonly EntryStep[]): ToolStep | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i]!;
    if (step.kind === "tool") return step.step;
  }
  return null;
}

/** A summary from Claude's raw search_awards input, or null when a field a summary needs has the wrong shape. */
function searchFromInput(input: unknown): SummarySearch | null {
  if (input === null || typeof input !== "object") return null;
  const fields = input as Record<string, unknown>;
  const codes = (value: unknown): string[] | null =>
    Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string") ? value.map((v: string) => v.trim().toUpperCase()) : null;
  const origins = codes(fields.origins);
  const destinations = codes(fields.destinations);
  const cabins = codes(fields.cabins);
  if (origins === null || destinations === null || cabins === null) return null;
  if (typeof fields.date_from !== "string" || typeof fields.date_to !== "string") return null;
  const programs = Array.isArray(fields.programs) && fields.programs.every((p) => typeof p === "string") ? (fields.programs as string[]) : null;
  return {
    origins,
    destinations,
    date_from: fields.date_from,
    date_to: fields.date_to,
    cabins,
    programs,
    direct_only: fields.direct_only === true,
    max_miles: typeof fields.max_miles === "number" ? fields.max_miles : null,
  };
}
