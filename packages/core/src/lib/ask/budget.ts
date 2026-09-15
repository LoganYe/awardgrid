/**
 * How many seats.aero calls one Ask tool call may spend, and the fetch guard that holds it to that number.
 *
 * Three ceilings meet in one number, the allowance:
 *
 *   1. QUESTION_SEATS_CALL_CAP, 12 calls per question, searches and flight lookups together.
 *   2. ASK_QUOTA_RESERVE, the last 25 calls of today's quota, which Ask never spends. The caller re-reads the
 *      quota before every tool call, because a grid search or a watch may have spent calls since the last one.
 *   3. What runFind can actually spend. It reserves up to `maxPages` pages for the pull (seatsaero/find.ts:326-327)
 *      and then, separately, up to `maxRoutesCalls` Get Routes calls against plain `quota.remaining`
 *      (find.ts:366-368), which knows nothing of the question's cap or of the reserve. One search can therefore
 *      spend the SUM, so planSearchSpend keeps maxPages + maxRoutesCalls within the allowance, never maxPages
 *      alone. A plan that capped only the pages could overshoot by the Get Routes call.
 *
 * The guard backs that arithmetic at the transport, and the plan is built so that it never trips, save in one race:
 * a search the cache covered, planned with no call left to spend, whose coverage expires before runFind reads it
 * (planSearchSpend, step 1). When it does trip, two things follow from SeatsAeroClient rather than from this file.
 * The refusal reaches runFind wrapped as a SeatsAeroNetworkError (client.ts:326-330), so `refused()` is how a caller
 * tells the two apart. And the client still reports the refused request to its call listener (client.ts:349-352), so
 * runFind charges the local quota for a request that never left (find.ts:314-316, :382-383). That errs toward
 * spending less, which is why the guard is the backstop and not the plan.
 */
import { ASK_QUOTA_RESERVE, QUESTION_SEATS_CALL_CAP, SEARCH_PAGE_CAP, SEARCH_ROUTES_CAP } from "./limits";

export interface SeatsAllowance {
  /** Calls this tool call may spend: the smaller of the two below. */
  allowance: number;
  /** What is left of the question's QUESTION_SEATS_CALL_CAP. */
  questionLeft: number;
  /** Today's remaining calls above ASK_QUOTA_RESERVE. */
  reserveLeft: number;
}

/** allowance = min(question calls left, today's remaining − 25), never below zero. */
export function seatsAllowance(opts: { questionSpent: number; quotaRemaining: number }): SeatsAllowance {
  const questionLeft = Math.max(0, QUESTION_SEATS_CALL_CAP - opts.questionSpent);
  const reserveLeft = Math.max(0, opts.quotaRemaining - ASK_QUOTA_RESERVE);
  return { allowance: Math.min(questionLeft, reserveLeft), questionLeft, reserveLeft };
}

/** Why a tool call may not spend. Each carries the numbers its sentence needs. */
export type SpendRefusal =
  /** Spending would reach into the reserve. `estimate` is set when the estimate, not the count alone, is what reaches it. */
  | { run: false; refuse: "quota_reserve"; quotaRemaining: number; estimate: number | null }
  /** The question has no calls left. */
  | { run: false; refuse: "limit_reached" }
  /** The pull needs more than it may spend. `overPageCap` is true when it needs more than any one search may pull. */
  | { run: false; refuse: "too_wide"; estimate: number; allowance: number; overPageCap: boolean };

export type SearchSpendPlan =
  | {
      run: true;
      /** Passed to runFind; it reserves this many pages at most (find.ts:327). */
      maxPages: number;
      /** Passed to runFind; Get Routes calls after the pull (find.ts:367). */
      maxRoutesCalls: number;
      /** The budget guard's allowance for this run. */
      guard: number;
    }
  | SpendRefusal;

export interface PlanSearchSpendOptions {
  /** coveredByCache for this query: runFind would answer from the cache. */
  covered: boolean;
  /** planFind(query).estimated_calls, with the same routes knowledge runFind will plan with. */
  estimate: number;
  /** seatsAllowance(...).allowance, from a quota read made just now. */
  allowance: number;
  /** quota.remaining, read just now. */
  quotaRemaining: number;
}

/**
 * The spend plan for one search_awards call, in the order the checks bite:
 *
 *   1. Covered → maxPages 1, maxRoutesCalls 0, guarded at the allowance, or at 0 when nothing is left. runFind
 *      answers from the cache and sends nothing (find.ts:280-303), so neither the reserve nor the question's limit
 *      is a reason to refuse a read that costs no call. The one page only matters if the coverage expired between
 *      the check and the run: the guard then lets out at most what is left, and with nothing left it refuses the
 *      request, which the runner reports as limit_reached (tools.ts seatsFailure).
 *   2. Nothing above the reserve is left → quota_reserve.
 *   3. The question has no calls left → limit_reached.
 *   4. The estimate reaches into the reserve → quota_reserve.
 *   5. maxPages = min(SEARCH_PAGE_CAP, allowance). Fewer pages than the estimate → too_wide: a pull cut short is
 *      still recorded as full coverage (find.ts:331-335), so a search is refused rather than truncated by design.
 *   6. maxRoutesCalls = min(SEARCH_ROUTES_CAP, allowance − maxPages), which is 0 whenever allowance ≤ 3, and the
 *      guard is their sum.
 */
export function planSearchSpend(opts: PlanSearchSpendOptions): SearchSpendPlan {
  const reserveLeft = opts.quotaRemaining - ASK_QUOTA_RESERVE;
  // An allowance computed from an older quota read could exceed what is above the reserve now; the reserve wins.
  const allowance = Math.min(opts.allowance, reserveLeft);
  if (opts.covered) return { run: true, maxPages: 1, maxRoutesCalls: 0, guard: Math.max(0, allowance) };
  if (reserveLeft < 1) return { run: false, refuse: "quota_reserve", quotaRemaining: opts.quotaRemaining, estimate: null };
  if (allowance < 1) return { run: false, refuse: "limit_reached" };
  if (reserveLeft < opts.estimate) {
    return { run: false, refuse: "quota_reserve", quotaRemaining: opts.quotaRemaining, estimate: opts.estimate };
  }
  const maxPages = Math.min(SEARCH_PAGE_CAP, allowance);
  if (maxPages < opts.estimate) {
    return { run: false, refuse: "too_wide", estimate: opts.estimate, allowance, overPageCap: opts.estimate > SEARCH_PAGE_CAP };
  }
  const maxRoutesCalls = Math.min(SEARCH_ROUTES_CAP, allowance - maxPages);
  return { run: true, maxPages, maxRoutesCalls, guard: maxPages + maxRoutesCalls };
}

export type FlightsSpendPlan = { run: true; guard: number } | SpendRefusal;

/**
 * The spend plan for one get_flights call: the search rules with an estimate of exactly one call, since Get
 * Trips is a single request with no pagination (seatsaero/trips.ts:180-183), guarded at one.
 */
export function planFlightsSpend(opts: { allowance: number; quotaRemaining: number }): FlightsSpendPlan {
  const plan = planSearchSpend({ covered: false, estimate: 1, ...opts });
  return plan.run ? { run: true, guard: 1 } : plan;
}

/** The guard refused a seats.aero request past its allowance. Nothing was sent for it. */
export class SeatsBudgetExceededError extends Error {
  readonly allowance: number;
  constructor(allowance: number) {
    super(`This tool call was allowed ${allowance} seats.aero ${allowance === 1 ? "request" : "requests"} and has sent them all.`);
    // Set explicitly: a minifier renames classes, and the name is what reaches a log.
    this.name = "SeatsBudgetExceededError";
    this.allowance = allowance;
  }
}

export interface SeatsBudgetGuard {
  /** The guarded transport, for SeatsAeroClient via runFind or runGetTrips. */
  fetch: typeof fetch;
  /** seats.aero requests handed to the inner transport. A request whose transport then failed still counts: it may have reached seats.aero. */
  sent(): number;
  /** seats.aero requests refused, none of which reached the inner transport. */
  refused(): number;
}

/**
 * Wrap `inner` so that at most `allowance` requests to https://seats.aero/ go out through it. Request n+1 is
 * refused with SeatsBudgetExceededError before `inner` is called. Every other URL passes through uncounted: the
 * guard budgets seats.aero calls and nothing else. It sits above the rate-limit observer and the native adapter
 * (guard → observer → adapter), so what it counts is what the grid lane's transport was asked to send.
 */
export function createSeatsBudgetGuard(inner: typeof fetch, allowance: number): SeatsBudgetGuard {
  let sent = 0;
  let refused = 0;
  const guarded = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (isSeatsAero(input)) {
      if (sent >= allowance) {
        refused += 1;
        throw new SeatsBudgetExceededError(allowance);
      }
      sent += 1;
    }
    return inner(input, init);
  }) as typeof fetch;
  return { fetch: guarded, sent: () => sent, refused: () => refused };
}

/** The same host test as the rate-limit observer (apps/ios/src/app/bootstrap.ts:57-60), with the URL parsed so case and a default port cannot hide one. */
function isSeatsAero(input: RequestInfo | URL): boolean {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname === "seats.aero";
  } catch {
    return false;
  }
}
