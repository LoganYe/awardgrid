/**
 * Ask's two tools, search_awards and get_flights, and the runner that turns one tool_use block into its
 * tool_result.
 *
 * Both tools are the grid lane's own code with Ask's limits around it: runFind with the device's cache, Quota
 * and routes catalog for a search (seatsaero/find.ts:249), and runGetTrips for flights (seatsaero/trips.ts:190).
 * Nothing here keeps a second cache or counts calls a second way, so a search Claude runs is the search the
 * Search screen would have run, and it spends the same quota.
 *
 * The runner's rules, in the order they bite:
 *
 *  - IT NEVER THROWS. Every outcome is a tool_result block, and a refusal carries `is_error` with a sentence
 *    Claude can act on, so the loop appends it and carries on.
 *  - IT REFUSES BEFORE SPENDING. Limits, input, places, pairs, dates and budget are checked before any request,
 *    so a refusal spends zero calls. Strict tool schemas cannot carry length or range bounds (claude-api
 *    shared/tool-use-concepts.md:486-503, "JSON Schema Limitations"), so every bound is enforced here with core's
 *    own zod.
 *  - IT COUNTS WHAT WENT OUT. Calls spent are the budget guard's count of requests sent, never an estimate, and
 *    never runFind's own count, which includes a request the guard refused (budget.ts).
 *  - IT CAPS EVERY PULL. runFind's defaults allow 40 pages plus 26 Get Routes calls (find.ts:62, :367), so every
 *    call passes maxPages, maxRoutesCalls and ttlMinutes explicitly. A warning that blames today's quota for route
 *    lists Ask's own cap skipped is rewritten to name the bound that ran out (searchWarnings).
 *  - IT ACCEPTS ONLY IDS IT RETURNED. get_flights takes an id only if search_awards returned it in this
 *    conversation, so an invented id cannot spend a call.
 *  - IT LEAKS NO KEY. Results are built from typed fields, and the finished text is still masked of every secret.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { formatFees } from "../grid/ascii";
import type { AvailabilityRow } from "../grid/types";
import { expandPlace } from "../query/places";
import { Cabin, DEFAULT_MIN_CABIN_PCT, QueryObject, SeatsProgram } from "../query/schema";
import { DEFAULT_CACHE_TTL_MINUTES, type AvailabilityCacheStore, type RowScope } from "../seatsaero/cache";
import { SeatsAeroHttpError, SeatsAeroNetworkError } from "../seatsaero/client";
import { pairsOf, planFind, runFind, type FindResult } from "../seatsaero/find";
import { notFetchedPairsFrom } from "../seatsaero/not-fetched";
import { QuotaExceededError, utcDayKey, type Quota } from "../seatsaero/quota";
import type { RoutesCatalog } from "../seatsaero/routes";
import { runGetTrips, type GetTripsResult, type TripSummary } from "../seatsaero/trips";
import { CABIN_NAME_TO_LETTER, SEATS_SOURCES, type CabinName } from "../seatsaero/types";
import {
  createSeatsBudgetGuard,
  planFlightsSpend,
  planSearchSpend,
  seatsAllowance,
  type SeatsBudgetGuard,
  type SpendRefusal,
} from "./budget";
import { coveredByCache } from "./coverage";
import { scrubSecrets } from "./errors";
import {
  ASK_QUOTA_RESERVE,
  FLIGHT_TRIPS_RETURNED,
  MAX_FLIGHTS_PER_QUESTION,
  MAX_PAIRS,
  MAX_SEARCHES_PER_QUESTION,
  MAX_TOOL_CALLS,
  QUESTION_SEATS_CALL_CAP,
  SEARCH_PAGE_CAP,
  SEARCH_ROUTES_CAP,
  SEARCH_ROWS_RETURNED,
} from "./limits";

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

export const SEARCH_AWARDS = "search_awards";
export const GET_FLIGHTS = "get_flights";

const CABIN_LETTERS: readonly string[] = Cabin.options;

/**
 * The two tool definitions, in a fixed order, built once and frozen. Tools render first in every request, and a
 * change anywhere in that prefix invalidates the cache for everything after it (claude-api
 * shared/prompt-caching.md:7-11, :97), so the bytes never change within a build, and a stray mutation throws
 * instead of quietly breaking the cache.
 *
 * No `minimum`, `maximum`, length, item-count or `pattern` keyword appears: strict schemas do not support the
 * first five (tool-use-concepts.md:486-503), and `pattern` is listed as neither supported nor unsupported
 * (design assumption AS5). The runner enforces those bounds itself.
 */
export const ASK_TOOLS: Anthropic.Tool[] = deepFreeze([
  {
    name: SEARCH_AWARDS,
    strict: true,
    description:
      "Reads award availability that seats.aero has cached, for every combination of origins and destinations over a date window. Accepts airport codes and metro codes (TYO means NRT and HND). Returns the cheapest rows by miles, each with an id for get_flights, the program, miles, seats, whether it is direct, the airlines and the age of the data in minutes. Pairs seats.aero does not monitor, and pairs that were not read in full, are listed separately: say so rather than reporting no availability for them. Uses up to 4 seats.aero calls, or none when this device already has the answer cached. A result read from this device's cache (from_cache true) cannot tell whether the pull that filled the cache was cut short, so it lists no pairs as not read in full. A window longer than 92 days, more than 12 airport pairs, or a search too wide for the calls left is refused with a reason.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        origins: { type: "array", items: { type: "string" } },
        destinations: { type: "array", items: { type: "string" } },
        date_from: { type: "string", format: "date" },
        date_to: { type: "string", format: "date", description: "Inclusive." },
        cabins: { type: "array", items: { type: "string", enum: [...CABIN_LETTERS] } },
        programs: { anyOf: [{ type: "array", items: { type: "string", enum: [...SEATS_SOURCES] } }, { type: "null" }] },
        direct_only: { type: "boolean" },
        max_miles: { anyOf: [{ type: "integer" }, { type: "null" }] },
      },
      required: ["origins", "destinations", "date_from", "date_to", "cabins", "programs", "direct_only", "max_miles"],
    },
  },
  {
    name: GET_FLIGHTS,
    strict: true,
    description:
      "Lists the itineraries behind one row that search_awards returned in this conversation: flight numbers, departure and arrival times in each airport's local time, stops, taxes and fees, remaining seats, and the program's booking link. Uses exactly one seats.aero call, or none when the same row and cabin were already looked up in this conversation; either way the result gives how many minutes ago it was looked up. Only ids returned by search_awards in this conversation are accepted.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        availability_id: { type: "string" },
        cabin: { type: "string", enum: [...CABIN_LETTERS] },
      },
      required: ["availability_id", "cabin"],
    },
  },
]);

/** The inputs as the schemas above describe them. Checked again here: a strict schema is a promise about the model, not about this code. */
const SearchInput = z.strictObject({
  origins: z.array(z.string()),
  destinations: z.array(z.string()),
  date_from: z.string(),
  date_to: z.string(),
  cabins: z.array(Cabin),
  programs: z.array(SeatsProgram).nullable(),
  direct_only: z.boolean(),
  // Refused below 1, before any call: the filter runs locally after runFind (searchAwards), so a limit like -1 would
  // still spend the pull's calls to return rows_total 0.
  max_miles: z.number().int().min(1, "must be at least 1, or null for no limit").nullable(),
});

const FlightsInput = z.strictObject({ availability_id: z.string(), cabin: Cabin });

/** client.ts getTrips refuses anything else (client.ts:299); the length bound keeps a refusal short. */
const AVAILABILITY_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The grid lane's scope, which every Ask search runs in (schema.ts:68-86 keeps both flags UI-only). */
const GRID_SCOPE: Required<RowScope> = { include_filtered: false, min_cabin_pct: DEFAULT_MIN_CABIN_PCT };

const SEARCH_NOTES = [
  "Seats 0 means the program does not report a seat count.",
  "Fees are null when seats.aero has not reported them; get_flights returns them. Fees with no currency code are assumed to be USD.",
];

const FLIGHTS_NOTES = ["Times are local to each airport.", "Fees with no currency code are assumed to be USD."];

// ---------------------------------------------------------------------------
// What the shell provides, and what the runner keeps
// ---------------------------------------------------------------------------

/**
 * Everything the tools need from the shell: the grid lane's own stores and transport. The iOS shell builds one
 * from its SearchEngine (engine.cache, engine.routes, engine.quota), the observed transport bootstrap wires
 * (apps/ios/src/app/bootstrap.ts:102-104), the Keychain's seats.aero key and its persist().
 */
export interface SeatsPort {
  /** The cache and quota key the grid lane uses (apps/ios LOCAL_USER), so Ask reads the grid's cache and spends its quota. */
  userId: string;
  /** The person's own seats.aero Pro key. There is no fallback, as there is none in runFind (find.ts:211-217). */
  apiKey: string;
  /**
   * The transport the grid lane's searches use: the rate-limit observer over the native adapter. Each tool call
   * wraps it in its own budget guard, so a request passes guard, observer, adapter. Never the WebView's fetch.
   */
  fetch: typeof fetch;
  /** The grid lane's Quota. Its clock should be `now`. */
  quota: Quota;
  cache: AvailabilityCacheStore;
  routes: RoutesCatalog;
  /** The injected clock: today's date for validation, the cache's freshness, and each row's age. */
  now: () => Date;
  /** Save the cache and the quota counter, as the shell does after a grid search. */
  persist(): Promise<void>;
  /** Other secrets to mask from every result, such as the Anthropic key. The seats.aero key is always masked. */
  secrets?: ReadonlyArray<string | null | undefined>;
}

/** One get_flights answer, kept so asking again for the same row and cabin costs nothing. Plain JSON, so it can be saved with the conversation. */
export interface FlightsLookup {
  id: string;
  cabin: Cabin;
  /** The program of the cached row the id belongs to, or null when this device no longer holds that row. */
  program: string | null;
  /** ISO time the lookup came back, by the injected clock. A string, so a memo saved with the conversation still reports its real age_min in a later question. */
  looked_up_at: string;
  booking_url: string | null;
  trips_total: number;
  trips: FlightTrip[];
}

export interface FlightTrip {
  miles: number;
  fees: string;
  seats: number;
  stops: number;
  carriers: string;
  flights: string;
  departs: string;
  arrives: string;
  segments: FlightSegment[];
}

export interface FlightSegment {
  flight: string;
  from: string;
  to: string;
  departs: string;
  arrives: string;
  aircraft: string | null;
}

/** What outlives one question: the conversation's own allowlists. The runner adds to them; it never removes. */
export interface ToolRunState {
  /** Ids search_awards returned in this conversation. get_flights accepts no other. */
  seenIds: Set<string>;
  /** booking_url values get_flights returned in this conversation, the only links an answer may make tappable. */
  bookingUrls: Set<string>;
  /** get_flights answers by row and cabin (see flightsMemoKey). */
  flightsMemo: Map<string, FlightsLookup>;
}

export type ToolErrorCode =
  | "limit_reached"
  | "invalid_input"
  | "invalid_place"
  | "too_wide"
  | "quota_reserve"
  | "quota"
  | "seatsaero_key_rejected"
  | "network"
  | "seatsaero_error"
  | "unknown_id"
  | "unknown_tool"
  | "tool_failed";

/** The search a search_awards call ran, after metro codes expanded: the `query` echoed in its result. */
export interface SearchEcho {
  origins: string[];
  destinations: string[];
  date_from: string;
  date_to: string;
  cabins: Cabin[];
  programs: string[] | null;
  direct_only: boolean;
  max_miles: number | null;
}

/** What the shell needs to label a step, without reading the JSON Claude reads. */
export interface ToolStep {
  /** The tool the model called, as named in its tool_use block. */
  tool: string;
  outcome: "ok" | ToolErrorCode;
  /** seats.aero requests this call sent, by its guard's count. */
  calls: number;
  /** search_awards was answered from this device's cache. */
  fromCache: boolean;
  /** get_flights was answered from an earlier lookup in this conversation. */
  fromMemo: boolean;
  /** The search, once its input was valid. */
  search: SearchEcho | null;
  /** get_flights: the looked-up row's program, when this device holds the row. */
  program: string | null;
  /** The estimate a too_wide or quota_reserve refusal was based on. */
  estimate: number | null;
}

export interface ToolRun {
  result: Anthropic.ToolResultBlockParam;
  step: ToolStep;
}

export interface ToolUsage {
  /** tool_use blocks handled, refused ones included, up to MAX_TOOL_CALLS. */
  toolCalls: number;
  /** search_awards calls whose input passed validation, toward MAX_SEARCHES_PER_QUESTION. */
  searches: number;
  /** get_flights calls whose input and id passed validation, memo hits included, toward MAX_FLIGHTS_PER_QUESTION. */
  flights: number;
  /** seats.aero requests this question's tools sent. */
  seatsCalls: number;
}

export interface ToolRunner {
  /** Run one tool_use block. Never rejects. */
  run(block: Pick<Anthropic.ToolUseBlock, "id" | "name" | "input">): Promise<ToolRun>;
  usage(): ToolUsage;
}

/** The memo key: one lookup per row and cabin, because fees and trips are per cabin. */
export function flightsMemoKey(availabilityId: string, cabin: Cabin): string {
  return `${availabilityId} ${cabin}`;
}

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

/** Payload fields after `error` and `message`; numbers only, so Claude reads what the sentence rests on. */
type Numbers = Record<string, number>;

interface Attempt {
  /** Requests this call sent, set as soon as its guard settles, so even an unexpected failure reports them. */
  calls: number;
}

/**
 * A runner for ONE question. Its counters are the question's: at most MAX_TOOL_CALLS tool calls, of which at most
 * MAX_SEARCHES_PER_QUESTION searches and MAX_FLIGHTS_PER_QUESTION lookups, spending at most
 * QUESTION_SEATS_CALL_CAP seats.aero calls. `state` is the conversation's and outlives it.
 *
 * Every tool_use block counts as a tool call once it is under that limit, whatever happens next, because each is a
 * step Claude spent. The per-tool counts are narrower: only a call whose input passed validation counts toward its
 * tool's limit, so malformed input Claude can fix does not use up the searches or lookups the fix needs. A block past
 * a limit gets limit_reached and does not run.
 */
export function createToolRunner(port: SeatsPort, state: ToolRunState): ToolRunner {
  const used: ToolUsage = { toolCalls: 0, searches: 0, flights: 0, seatsCalls: 0 };
  const secrets = [port.apiKey, ...(port.secrets ?? [])];
  /** Mask first, then cap, as errors.ts:84 does, so the cut can never leave part of a key showing. */
  const quote = (text: string): string => capQuote(scrubSecrets(text, secrets));
  const questionLeft = () => Math.max(0, QUESTION_SEATS_CALL_CAP - used.seatsCalls);

  const step = (tool: string, over: Partial<ToolStep> = {}): ToolStep => ({
    tool,
    outcome: "ok",
    calls: 0,
    fromCache: false,
    fromMemo: false,
    search: null,
    program: null,
    estimate: null,
    ...over,
  });

  /** The one place a result is serialized: compact JSON in the key order it was built, masked of every secret. */
  const finish = (toolUseId: string, s: ToolStep, payload: object, isError: boolean): ToolRun => {
    const content = scrubSecrets(JSON.stringify(payload), secrets);
    const result: Anthropic.ToolResultBlockParam = isError
      ? { type: "tool_result", tool_use_id: toolUseId, content, is_error: true }
      : { type: "tool_result", tool_use_id: toolUseId, content };
    return { result, step: s };
  };

  const refuse = (toolUseId: string, s: ToolStep, code: ToolErrorCode, message: string, numbers: Numbers = {}): ToolRun =>
    finish(toolUseId, { ...s, outcome: code }, { error: code, message, ...numbers }, true);

  const persistQuietly = async (): Promise<void> => {
    try {
      await port.persist();
    } catch (err) {
      // What the call learned is already in memory and the answer stands; a failed save must not cost the person
      // the call they paid for. Logged by name only, as runGetTrips logs a failed fee write (trips.ts:217-219).
      console.error("ask tool persist failed", err instanceof Error ? err.name : typeof err);
    }
  };

  /**
   * Count what the guard let out, then save when anything moved the quota. A refused request moves it too:
   * SeatsAeroClient still reports it, and runFind charges it (budget.ts).
   */
  const settle = async (guard: SeatsBudgetGuard, attempt: Attempt): Promise<void> => {
    attempt.calls = guard.sent();
    used.seatsCalls += guard.sent();
    if (guard.sent() > 0 || guard.refused() > 0) await persistQuietly();
  };

  const spendRefusal = (toolUseId: string, s: ToolStep, refusal: SpendRefusal, noun: "search" | "lookup"): ToolRun => {
    switch (refusal.refuse) {
      case "quota_reserve": {
        const n = refusal.quotaRemaining;
        const needs = refusal.estimate === null ? "" : ` This ${noun} needs about ${refusal.estimate}.`;
        return refuse(
          toolUseId,
          { ...s, estimate: refusal.estimate },
          "quota_reserve",
          `Today's seats.aero quota has ${n} ${n === 1 ? "call" : "calls"} left, and the last ${ASK_QUOTA_RESERVE} are kept for the person's own searches.${needs}`,
          { today_calls_left: n, ...(refusal.estimate === null ? {} : { estimated_calls: refusal.estimate }) },
        );
      }
      case "limit_reached":
        return refuse(toolUseId, s, "limit_reached", `This question has used all ${QUESTION_SEATS_CALL_CAP} of its seats.aero calls.`, {
          question_calls_left: 0,
        });
      case "too_wide": {
        const message = refusal.overPageCap
          ? `This search needs about ${refusal.estimate} seats.aero calls, more than the ${SEARCH_PAGE_CAP} one search may spend on results. Narrow the airports, dates, cabins or programs.`
          : `This search needs about ${refusal.estimate} seats.aero calls and this question has ${refusal.allowance} left. Narrow the airports, dates, cabins or programs.`;
        return refuse(toolUseId, { ...s, estimate: refusal.estimate }, "too_wide", message, {
          estimated_calls: refusal.estimate,
          question_calls_left: questionLeft(),
        });
      }
    }
  };

  /** A run that reached seats.aero, or tried to, and failed. The numbers say what it spent. */
  const seatsFailure = (toolUseId: string, s: ToolStep, err: unknown, guard: SeatsBudgetGuard, noun: "search" | "lookup"): ToolRun => {
    const failed = { ...s, calls: guard.sent() };
    const numbers = { seats_aero_calls: guard.sent(), question_calls_left: questionLeft() };
    // Checked first: the client wraps the guard's refusal as a network error (client.ts:326-330).
    if (guard.refused() > 0) {
      const n = guard.sent();
      return refuse(toolUseId, failed, "limit_reached", `This ${noun} stopped after the ${n} seats.aero ${n === 1 ? "call" : "calls"} it was allowed.`, numbers);
    }
    if (err instanceof QuotaExceededError) {
      return refuse(toolUseId, failed, "quota", `Today's seats.aero quota is used up: ${quote(err.message)}`, numbers);
    }
    if (err instanceof SeatsAeroHttpError && (err.status === 401 || err.status === 403)) {
      return refuse(toolUseId, failed, "seatsaero_key_rejected", "seats.aero rejected the person's key.", numbers);
    }
    if (err instanceof SeatsAeroNetworkError) {
      return refuse(
        toolUseId,
        failed,
        "network",
        `The seats.aero request failed: ${sentence(quote(err.message))} The call may still have counted toward today's quota.`,
        numbers,
      );
    }
    return refuse(toolUseId, failed, "seatsaero_error", `seats.aero could not complete the ${noun}: ${sentence(quote(errorText(err)))}`, numbers);
  };

  async function searchAwards(toolUseId: string, input: unknown, attempt: Attempt): Promise<ToolRun> {
    const base = step(SEARCH_AWARDS);
    if (used.searches >= MAX_SEARCHES_PER_QUESTION) {
      return refuse(toolUseId, base, "limit_reached", `search_awards may run at most ${MAX_SEARCHES_PER_QUESTION} times in one question.`, {
        question_calls_left: questionLeft(),
      });
    }
    const parsed = SearchInput.safeParse(input);
    if (!parsed.success) return refuse(toolUseId, base, "invalid_input", `The search could not be read: ${quote(issuesText(parsed.error))}.`);
    const inp = parsed.data;

    // Metro codes expand before anything else, so a pair count and a cache scope are always about airports.
    const origins = expandCodes(inp.origins);
    const destinations = expandCodes(inp.destinations);
    const unknown = [...origins.unknown, ...destinations.unknown];
    if (unknown.length > 0) {
      return refuse(toolUseId, base, "invalid_place", `Unknown place code: ${unknown.join(", ")}. Use 3-letter airport or metro codes.`);
    }
    if (origins.airports.length === 0 || destinations.airports.length === 0) {
      return refuse(toolUseId, base, "invalid_input", "origins and destinations each need at least one airport or metro code.");
    }
    const pairCount = origins.airports.length * destinations.airports.length;
    if (pairCount > MAX_PAIRS) {
      return refuse(toolUseId, base, "too_wide", `Too many airport pairs: ${pairCount}. One search may cover at most ${MAX_PAIRS}.`, { pairs: pairCount });
    }

    // The grid lane's defaults, so the cache scope is the one a grid search shares (schema.ts:68-86).
    const programs = unique(inp.programs ?? []);
    const checked = QueryObject.safeParse({
      origins: origins.airports,
      destinations: destinations.airports,
      date_from: inp.date_from,
      date_to: inp.date_to,
      cabins: unique(inp.cabins),
      ...(programs.length > 0 ? { programs } : {}),
      direct_only: inp.direct_only,
      include_filtered: GRID_SCOPE.include_filtered,
      min_cabin_pct: GRID_SCOPE.min_cabin_pct,
      ...(inp.max_miles === null ? {} : { max_miles: inp.max_miles }),
      sort_by: "miles_asc",
      raw_text: "",
      language: "en",
    });
    if (!checked.success) return refuse(toolUseId, base, "invalid_input", `The search could not be read: ${quote(issuesText(checked.error))}.`);
    const query = checked.data;
    const s = { ...base, search: echo(query) };

    const now = port.now();
    const today = utcDayKey(now);
    if (query.date_to < today) return refuse(toolUseId, s, "invalid_input", `The dates are before today (${today}).`);
    // Counted only here, once the input is a search that could run; every check after this one is about budget.
    used.searches += 1;

    // Re-read now: a grid search or a watch may have spent calls since the last tool.
    const quotaRemaining = await port.quota.remaining(port.userId);
    const { allowance } = seatsAllowance({ questionSpent: used.seatsCalls, quotaRemaining });
    const covered = await coveredByCache({ query, userId: port.userId, cache: port.cache, ttlMinutes: DEFAULT_CACHE_TTL_MINUTES, now: port.now });
    // The same routes knowledge runFind plans with (find.ts:306), so the estimate is the one it will act on.
    const estimate = planFind(query, { routesKnown: port.routes.knowledgeFor(port.userId) }).estimated_calls;
    const plan = planSearchSpend({ covered, estimate, allowance, quotaRemaining });
    if (!plan.run) return spendRefusal(toolUseId, s, plan, "search");

    const guard = createSeatsBudgetGuard(port.fetch, plan.guard);
    const quota = observedQuota(port.quota);
    let result: FindResult | undefined;
    let failure: unknown;
    try {
      result = await runFind({
        query,
        userId: port.userId,
        apiKey: port.apiKey,
        fetch: guard.fetch,
        quota: quota.quota,
        cache: port.cache,
        routes: port.routes,
        now: port.now,
        ttlMinutes: DEFAULT_CACHE_TTL_MINUTES,
        maxPages: plan.maxPages,
        maxRoutesCalls: plan.maxRoutesCalls,
      });
    } catch (err) {
      failure = err;
    } finally {
      await settle(guard, attempt);
    }
    if (result === undefined) return seatsFailure(toolUseId, s, failure, guard, "search");

    const matching = query.max_miles === undefined ? result.rows : result.rows.filter((r) => r.miles <= query.max_miles!);
    const sorted = [...matching].sort(byMilesDateProgram);
    const shown = sorted.slice(0, SEARCH_ROWS_RETURNED);
    for (const r of shown) state.seenIds.add(r.source_id);

    const payload = {
      query: s.search,
      spent: {
        seats_aero_calls: guard.sent(),
        from_cache: result.served_from_cache,
        question_calls_left: questionLeft(),
        today_calls_left: await port.quota.remaining(port.userId),
      },
      rows_total: matching.length,
      cols: ["id", "pair", "date", "cabin", "program", "miles", "seats", "direct", "airlines", "age_min", "fees"],
      rows: shown.map((r) => [
        r.source_id,
        `${r.origin}-${r.dest}`,
        r.date,
        r.cabin,
        r.program,
        r.miles,
        r.seats_left,
        r.direct,
        r.airlines.join(","),
        ageMinutes(r.computed_last_seen, now),
        r.fees_cents === null ? null : formatFees(r.fees_cents, r.currency),
      ]),
      by_pair: byPair(query, matching),
      unmonitored: result.unmonitored_pairs.map((p) => p.key),
      not_read_in_full: notFetchedPairsFrom(result, pairsOf(query)).map((p) => `${p.pair.origin}-${p.pair.dest}`),
      warnings: searchWarnings(result, { allowed: plan.maxRoutesCalls, quotaLeft: quota.lastRemaining() }),
      notes: SEARCH_NOTES,
    };
    return finish(toolUseId, { ...s, calls: guard.sent(), fromCache: result.served_from_cache }, payload, false);
  }

  async function getFlights(toolUseId: string, input: unknown, attempt: Attempt): Promise<ToolRun> {
    const base = step(GET_FLIGHTS);
    if (used.flights >= MAX_FLIGHTS_PER_QUESTION) {
      return refuse(toolUseId, base, "limit_reached", `get_flights may run at most ${MAX_FLIGHTS_PER_QUESTION} times in one question.`, {
        question_calls_left: questionLeft(),
      });
    }
    const parsed = FlightsInput.safeParse(input);
    if (!parsed.success) return refuse(toolUseId, base, "invalid_input", `The lookup could not be read: ${quote(issuesText(parsed.error))}.`);
    const { availability_id: id, cabin } = parsed.data;
    if (!AVAILABILITY_ID.test(id) || !state.seenIds.has(id)) {
      return refuse(toolUseId, base, "unknown_id", "get_flights accepts only ids that search_awards returned in this conversation.");
    }
    // Counted once the id is one this conversation returned, as a search counts once its input is valid; a memo hit counts too.
    used.flights += 1;

    const key = flightsMemoKey(id, cabin);
    const earlier = state.flightsMemo.get(key);
    if (earlier) {
      // Aged by the clock now: the memo outlives the question, and ask.json outlives the session.
      const payload = flightsPayload(earlier, { calls: 0, questionLeft: questionLeft(), todayLeft: await port.quota.remaining(port.userId) }, port.now(), true);
      return finish(toolUseId, { ...base, fromMemo: true, program: earlier.program }, payload, false);
    }

    const quotaRemaining = await port.quota.remaining(port.userId);
    const { allowance } = seatsAllowance({ questionSpent: used.seatsCalls, quotaRemaining });
    const plan = planFlightsSpend({ allowance, quotaRemaining });
    // Read before the call and free: the program names the step, and the cached rows are where the fee is written.
    const rows = await port.cache.getRowsBySourceId(port.userId, id, GRID_SCOPE);
    const program = (rows.find((r) => r.cabin === cabin) ?? rows[0])?.program ?? null;
    const s = { ...base, program };
    if (!plan.run) return spendRefusal(toolUseId, s, plan, "lookup");

    const guard = createSeatsBudgetGuard(port.fetch, plan.guard);
    let res: GetTripsResult | undefined;
    let failure: unknown;
    try {
      // The grid lane's scope, left absent (trips.ts:174-177), so the fee lands on the row search_awards returned.
      res = await runGetTrips({ availabilityId: id, cabin, userId: port.userId, apiKey: port.apiKey, fetch: guard.fetch, quota: port.quota, cache: port.cache });
    } catch (err) {
      failure = err;
    } finally {
      await settle(guard, attempt);
    }
    if (res === undefined) return seatsFailure(toolUseId, s, failure, guard, "lookup");

    const inCabin = res.trips.filter((t) => cabinLetter(t.cabin) === cabin).sort((a, b) => a.miles - b.miles || a.fees_cents - b.fees_cents);
    const lookedUpAt = port.now();
    const lookup: FlightsLookup = {
      id,
      cabin,
      program,
      looked_up_at: lookedUpAt.toISOString(),
      booking_url: res.booking_url,
      trips_total: inCabin.length,
      trips: inCabin.slice(0, FLIGHT_TRIPS_RETURNED).map(flightTrip),
    };
    state.flightsMemo.set(key, lookup);
    if (lookup.booking_url !== null) state.bookingUrls.add(lookup.booking_url);
    const payload = flightsPayload(lookup, { calls: guard.sent(), questionLeft: questionLeft(), todayLeft: await port.quota.remaining(port.userId) }, lookedUpAt, false);
    return finish(toolUseId, { ...s, calls: guard.sent() }, payload, false);
  }

  return {
    async run(block) {
      const attempt: Attempt = { calls: 0 };
      // Assigned inside the try, so even a name String() cannot convert resolves to tool_failed instead of rejecting.
      let tool = "a tool";
      try {
        tool = String(block.name);
        if (used.toolCalls >= MAX_TOOL_CALLS) {
          return refuse(block.id, step(tool), "limit_reached", `One question may make at most ${MAX_TOOL_CALLS} tool calls.`, {
            question_calls_left: questionLeft(),
          });
        }
        used.toolCalls += 1;
        if (tool === SEARCH_AWARDS) return await searchAwards(block.id, block.input, attempt);
        if (tool === GET_FLIGHTS) return await getFlights(block.id, block.input, attempt);
        return refuse(block.id, step(tool), "unknown_tool", `awardgrid has no tool named ${JSON.stringify(tool)}. Its tools are ${SEARCH_AWARDS} and ${GET_FLIGHTS}.`);
      } catch (err) {
        // A bug or a failing store, not seats.aero: say so, and still report any calls that went out.
        return refuse(block.id, step(tool, { calls: attempt.calls }), "tool_failed", `awardgrid could not run ${tool}: ${sentence(quote(errorText(err)))}`, {
          seats_aero_calls: attempt.calls,
        });
      }
    },
    usage: () => ({ ...used }),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * `quota`, with the last count its `remaining` answered kept. Methods run on `quota` itself, whose fields are private.
 *
 * searchWarnings needs the count runFind sized its Get Routes budget with. runFind reads `remaining` twice: before the
 * pull, and right after the pull settles, to size that budget (seatsaero/find.ts:326, :366-367). The second read is
 * made only when some pair came back empty, which is also the only time a route list can be skipped, and nothing after
 * it reads `remaining` again. So whenever runFind reports skipped route lists, the last count kept here is that one.
 */
function observedQuota(quota: Quota): { quota: Quota; lastRemaining(): number | null } {
  let last: number | null = null;
  const observed = new Proxy(quota, {
    get(target, property) {
      if (property === "remaining") {
        return async (userId: string) => {
          const n = await target.remaining(userId);
          last = n;
          return n;
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { quota: observed, lastRemaining: () => last };
}

/**
 * runFind's warnings, in its order and words, except the one whose reason is the web app's and not Ask's.
 *
 * runFind words skipped route lists as skipped "to stay within today's quota" (notice find.routes_skipped, the web's
 * i18n dictionary), the only bound the web app puts on them. Its budget for Get Routes calls is the smallest of today's
 * remaining calls, the lists not yet loaded and `maxRoutesCalls` (find.ts:366-368), and Ask passes its own per-search
 * limit as `maxRoutesCalls` (budget.ts planSearchSpend, SEARCH_ROUTES_CAP). With 759 calls left today, that limit is what
 * skipped them (docs/PHASE5.md §2.4), and Claude repeats the reason it reads. So that one warning is written here.
 */
function searchWarnings(result: FindResult, routes: { allowed: number; quotaLeft: number | null }): string[] {
  return result.warnings.map((text, i) => {
    const notice = result.notices[i];
    return notice?.code === "find.routes_skipped" ? routesSkippedWarning(notice.vars ?? {}, result.routes_calls_used, routes) : text;
  });
}

/**
 * Why route lists were skipped, by which bound ran out. A list is skipped only once runFind's Get Routes budget is
 * spent (routes.ts ensureLoaded), so the calls it made equal that budget, min(today's remaining calls, lists not loaded,
 * `allowed`), and a skipped list shows the lists not loaded were not the smallest:
 *
 *   - Fewer calls than `allowed`: today's quota was smaller than Ask's limit, or had no room left when runFind reserved.
 *   - As many as `allowed`: Ask's limit ran out. Today's quota did too when it had no more than `allowed` calls left
 *     then. That count is runFind's own read (observedQuota); without it, the quota is not named either way.
 *
 * `allowed` is SEARCH_ROUTES_CAP unless the question's allowance left less once the pages were set aside
 * (planSearchSpend). That allowance is the question's calls or today's calls above the reserve, so a lowered limit
 * never says the quota played no part.
 */
function routesSkippedWarning(vars: Record<string, string | number>, made: number, routes: { allowed: number; quotaLeft: number | null }): string {
  const pairs = Number(vars.pairs ?? 0);
  const skipped = Number(vars.skipped ?? 0);
  const head = `Could not check whether seats.aero monitors ${pairs} empty airport ${pairs === 1 ? "pair" : "pairs"}: ${skipped} program route ${skipped === 1 ? "list was" : "lists were"} skipped`;
  const { allowed, quotaLeft } = routes;
  if (made < allowed) return `${head} because today's seats.aero quota had no calls left for them.`;
  const calls = (n: number) => `route list ${n === 1 ? "call" : "calls"}`;
  const lowered = allowed < SEARCH_ROUTES_CAP;
  const limit = lowered
    ? `Ask allowed this search ${allowed === 0 ? "no" : `only ${allowed}`} ${calls(allowed)} (the calls it could spend were set aside for its results)`
    : `Ask lets one search make at most ${allowed} ${calls(allowed)}`;
  if (quotaLeft !== null && quotaLeft <= allowed) {
    const quota = quotaLeft <= 0 ? "no calls" : `only ${quotaLeft} ${quotaLeft === 1 ? "call" : "calls"}`;
    return `${head} because ${limit}, and today's seats.aero quota had ${quota} left.`;
  }
  if (quotaLeft !== null && !lowered) return `${head} because ${limit}, not because of today's seats.aero quota.`;
  return `${head} because ${limit}.`;
}

/** `now` ages the lookup: 0 for one just made, and its real age for a memo hit, however many questions ago it was made. */
function flightsPayload(lookup: FlightsLookup, spent: { calls: number; questionLeft: number; todayLeft: number }, now: Date, fromMemo: boolean) {
  return {
    id: lookup.id,
    cabin: lookup.cabin,
    program: lookup.program,
    spent: { seats_aero_calls: spent.calls, question_calls_left: spent.questionLeft, today_calls_left: spent.todayLeft },
    ...(fromMemo ? { from_memo: true } : {}),
    age_min: ageMinutes(lookup.looked_up_at, now),
    booking_url: lookup.booking_url,
    trips_total: lookup.trips_total,
    trips: lookup.trips,
    notes: FLIGHTS_NOTES,
  };
}

/** TotalDuration is left out: seats.aero does not document its unit (ARCHITECTURE.md:104). */
function flightTrip(t: TripSummary): FlightTrip {
  return {
    miles: t.miles,
    fees: formatFees(t.fees_cents, t.currency),
    seats: t.seats,
    stops: t.stops,
    carriers: t.carriers,
    flights: t.flight_numbers,
    departs: localTime(t.departs_at),
    arrives: localTime(t.arrives_at),
    segments: t.segments.map((seg) => ({
      flight: seg.flight_number,
      from: seg.origin,
      to: seg.dest,
      departs: localTime(seg.departs_at),
      arrives: localTime(seg.arrives_at),
      aircraft: seg.aircraft,
    })),
  };
}

/**
 * "2024-05-01T13:52:00Z" → "2024-05-01 13:52". Trip times carry a Z but are airport-local (seatsaero/types.ts:212),
 * so the Z is dropped rather than read as UTC, which would move every flight by the airport's offset.
 */
function localTime(raw: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?Z?$/.exec(raw);
  return m ? `${m[1]} ${m[2]}` : raw.replace(/Z$/, "");
}

/** Trip.Cabin uses the API's names ("business"); a letter is accepted too, as tripsToFees accepts both (normalize.ts:102-105). */
function cabinLetter(name: string): Cabin | undefined {
  if (CABIN_LETTERS.includes(name)) return name as Cabin;
  return CABIN_NAME_TO_LETTER[name as CabinName];
}

/** Whole minutes since `iso` (a row's last sighting, or a lookup's time), by the injected clock. A clock behind it reads 0, never negative; an unreadable time reads null. */
function ageMinutes(iso: string, now: Date): number | null {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  return Math.max(0, Math.floor((now.getTime() - then) / 60_000));
}

/** Miles, then date, then program; pair, cabin and id only break the remaining ties, so the order never depends on the cache's. */
function byMilesDateProgram(a: AvailabilityRow, b: AvailabilityRow): number {
  return (
    a.miles - b.miles ||
    compare(a.date, b.date) ||
    compare(a.program, b.program) ||
    compare(`${a.origin}-${a.dest}`, `${b.origin}-${b.dest}`) ||
    CABIN_LETTERS.indexOf(a.cabin) - CABIN_LETTERS.indexOf(b.cabin) ||
    compare(a.source_id, b.source_id)
  );
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** One summary per pair and cabin that has rows, in the query's pair order and cabin order. */
function byPair(query: QueryObject, rows: readonly AvailabilityRow[]) {
  const out: Array<{ pair: string; cabin: Cabin; dates_with_seats: number; min_miles: number; programs: string[] }> = [];
  for (const p of pairsOf(query)) {
    for (const cabin of query.cabins) {
      const group = rows.filter((r) => r.origin === p.origin && r.dest === p.dest && r.cabin === cabin);
      if (group.length === 0) continue;
      out.push({
        pair: p.key,
        cabin,
        dates_with_seats: new Set(group.map((r) => r.date)).size,
        min_miles: Math.min(...group.map((r) => r.miles)),
        programs: unique(group.map((r) => r.program)).sort(compare),
      });
    }
  }
  return out;
}

function echo(query: QueryObject): SearchEcho {
  return {
    origins: [...query.origins],
    destinations: [...query.destinations],
    date_from: query.date_from,
    date_to: query.date_to,
    cabins: [...query.cabins],
    programs: query.programs && query.programs.length > 0 ? [...query.programs] : null,
    direct_only: query.direct_only,
    max_miles: query.max_miles ?? null,
  };
}

/** Upper-case, expand metro codes (query/places.ts:63-69), dedupe in order. A code that expands to nothing is reported, never dropped. */
function expandCodes(codes: readonly string[]): { airports: string[]; unknown: string[] } {
  const airports: string[] = [];
  const unknown: string[] = [];
  for (const raw of codes) {
    const code = raw.trim().toUpperCase();
    const expanded = expandPlace(code);
    if (expanded.length === 0) unknown.push(code === "" ? '""' : code);
    for (const airport of expanded) if (!airports.includes(airport)) airports.push(airport);
  }
  return { airports, unknown };
}

function unique<T>(items: readonly T[]): T[] {
  return items.filter((item, i) => items.indexOf(item) === i);
}

/** zod's issues as one line, not yet quoted: the runner's quote() masks it before it is capped. */
function issuesText(error: z.ZodError): string {
  return error.issues.map((i) => (i.path.length > 0 ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ");
}

/** Said in place of an error's own words when it has none that can be read. */
const UNREADABLE_ERROR = "the error could not be read as text";

/**
 * What an error says. Total, because run() promises never to reject and calls this inside its own catch: a thrown
 * value String() cannot convert (Object.create(null) has no toString), or one that reads as nothing but whitespace,
 * gets a fixed sentence instead of a second throw or an empty quote.
 */
function errorText(err: unknown): string {
  try {
    const text: unknown = err instanceof Error ? err.message || err.name : String(err);
    if (typeof text === "string" && text.trim().length > 0) return text;
  } catch {
    // Reading or converting the thrown value threw; the fixed sentence stands in for it.
  }
  return UNREADABLE_ERROR;
}

/** Longest text quoted from an error into one result, in code points, as errors.ts caps Anthropic's and the OS's words. */
const QUOTE_CAP = 300;

/** Cut by code points, so an astral character is never split. Only the runner's quote() calls it, on masked text. */
function capQuote(text: string): string {
  const chars = Array.from(text.trim());
  return chars.length <= QUOTE_CAP ? chars.join("") : `${chars.slice(0, QUOTE_CAP - 1).join("")}…`;
}

function sentence(text: string): string {
  return /[.!?…。！？]$/.test(text) ? text : `${text}.`;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
