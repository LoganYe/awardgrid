/**
 * Every bound Ask works under, named once, with the reason for each number.
 *
 * The loop, the tools, the conversation store and the shell read these names instead of repeating a
 * literal, so a bound changes in one place. None of them is a promise about speed. Each one is a
 * ceiling on spending, on waiting, or on how much a follow-up resends.
 */
import { DEFAULT_MIN_QUOTA } from "../watch/watch";

// ---- The model and one request ----

/**
 * The one model Ask calls. One model means one live verification with the owner's key; offering
 * another is its own change, with its own run.
 */
export const ASK_MODEL = "claude-opus-5";

/**
 * Output tokens per request. On Claude Opus 5 this caps thinking and text together, and a request that
 * omits `thinking` still thinks (claude-api shared/model-migration.md, "Breaking change 1: thinking is
 * on by default"), so the cap has to leave room for both. It also sets how long one request may take;
 * see ASK_REQUEST_LIMIT_MS.
 */
export const ASK_MAX_TOKENS = 16_000;

/**
 * `output_config.effort` (SDK resources/messages/messages.d.ts:2065-2069). On Opus 5, `low` and `medium`
 * are the main latency lever (model-migration.md:926), and latency matters most when an answer arrives
 * whole rather than word by word. It never changes within a conversation, because an effort change
 * invalidates the messages cache (prompt-caching.md:222-226).
 */
export const ASK_EFFORT = "medium";

// ---- One question ----

/**
 * Model requests per question. The last one goes out with `tool_choice: { type: "none" }`
 * (ToolChoiceNone, messages.d.ts:2603), which asks Claude to answer from what the tools already
 * returned instead of calling another.
 */
export const MAX_MODEL_REQUESTS = 6;

/** Tool calls per question, both tools together. A call past any tool limit gets an error result and does not run. */
export const MAX_TOOL_CALLS = 8;

/** `search_awards` runs per question. */
export const MAX_SEARCHES_PER_QUESTION = 4;

/** `get_flights` runs per question. */
export const MAX_FLIGHTS_PER_QUESTION = 3;

/**
 * No new request or tool call starts once a question has run this long, ms. A step already under way is
 * never cut short by it: that step may already be billed, or already counted toward today's calls.
 */
export const ASK_QUESTION_LIMIT_MS = 300_000;

/** A question is trimmed, then refused before any request if it is empty or longer than this. */
export const MAX_QUESTION_CHARS = 1000;

// ---- seats.aero spend ----

/**
 * seats.aero calls one question may spend, searches and flight lookups together: 12 of the 1,000 a Pro
 * key gets each day. Every one of them goes through the grid lane's own Quota and cache.
 */
export const QUESTION_SEATS_CALL_CAP = 12;

/**
 * Availability pages one search may pull. runFind reserves up to `maxPages` for the pull
 * (seatsaero/find.ts:327) and then, separately, up to `maxRoutesCalls` Get Routes calls from what is left
 * (find.ts:366-368). One search can therefore spend the SUM of this and SEARCH_ROUTES_CAP, 4, and the
 * tool keeps that sum within what the question has left, not this number alone.
 */
export const SEARCH_PAGE_CAP = 3;

/** Get Routes calls one search may add after its pull. See SEARCH_PAGE_CAP for why the two are budgeted as a sum. */
export const SEARCH_ROUTES_CAP = 1;

/**
 * The last calls of today's quota, which Ask never spends. It is the floor below which a watch refuses to
 * start (watch/watch.ts:100, :112), so a question leaves the person's own searches no fewer calls than a
 * watch does.
 */
export const ASK_QUOTA_RESERVE = DEFAULT_MIN_QUOTA;

/** Airport pairs one search may cover, counted after metro codes expand (TYO is NRT and HND). */
export const MAX_PAIRS = 12;

/** Rows one search result gives the model, cheapest first; the full count is reported alongside. */
export const SEARCH_ROWS_RETURNED = 20;

/** Itineraries one `get_flights` result gives the model, cheapest first. */
export const FLIGHT_TRIPS_RETURNED = 5;

// ---- One conversation ----

/** Questions one conversation may hold. Every follow-up resends the whole conversation to Anthropic. */
export const MAX_QUESTIONS_PER_CONVERSATION = 8;

/**
 * A new question is refused once the conversation's last request sent more input than this. Input is
 * counted as `input_tokens + cache_creation_input_tokens + cache_read_input_tokens` (the Usage comment,
 * messages.d.ts:1992), because a follow-up resends every token, whether or not it is read from cache.
 */
export const CONVERSATION_INPUT_TOKEN_LIMIT = 120_000;

/** Largest saved conversation (`ask.json`) a new question may start from, in bytes. */
export const MAX_CONVERSATION_FILE_BYTES = 1_500_000;

// ---- Waiting on Anthropic ----

/**
 * The native idle timeout for Anthropic requests, ms. CapacitorHttp sends one URLRequest.timeoutInterval,
 * which Apple defines as idle time that resets whenever bytes arrive (apps/ios/src/native/http.ts cites
 * HttpRequestHandler.swift:203-205 and NSURLRequest.h). A streamed request keeps bytes arriving with pings
 * and deltas. Those bytes still reset the interval while CapacitorHttp buffers the body: on the Simulator,
 * T1's 18 s drip completed under a 5 s timeout (docs/PHASE5.md §1.3). seats.aero requests keep their 20 s.
 */
export const ANTHROPIC_IDLE_TIMEOUT_MS = 90_000;

/**
 * How long the loop waits on one request before it stops waiting, ms. The loop enforces it with its own
 * AbortController, so the failure can say which bound fired. 450 s is the SDK's own estimate for 16,000
 * output tokens, 3,600 s × 16,000 / 128,000 (SDK client.js:404-411); a shorter bound would walk away from
 * answers still arriving and already billed. Aborting ends the wait, not the request (docs/PHASE0.md §3).
 */
export const ASK_REQUEST_LIMIT_MS = 450_000;

/**
 * The SDK's own `timeout`, ms, set above ASK_REQUEST_LIMIT_MS so it never fires first. If it did, the SDK
 * would abort its fetch and report "Request timed out." (client.js:533, :569), which reads exactly like a
 * native timeout. Only the loop's bound knows why it stopped.
 */
export const SDK_BACKSTOP_TIMEOUT_MS = 900_000;
