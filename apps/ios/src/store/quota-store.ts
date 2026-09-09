/**
 * The device quota counter.
 *
 * `docs/PIVOT.md` §2: "seats.aero returns `X-RateLimit-Remaining`. Read it and trust it over the
 * local counter — on-device counters reset when the app is reinstalled while seats.aero's does
 * not, so a user could hit the real 1,000 limit believing they had headroom."
 *
 * The rule implemented here, stated precisely because "trust it" alone is ambiguous:
 *
 *     used(day) = max(locally counted calls, DAILY_LIMIT - X-RateLimit-Remaining)
 *
 * Three properties follow, and each one is a bug that would otherwise be easy to ship:
 *
 *   - **It is monotonic within a day.** Reconciliation can only ever raise `used`, never lower it.
 *     A response that arrives out of order, or a header read from a retried request, must not
 *     refund calls we actually made.
 *   - **A fresh install is corrected on the FIRST response, not after the first overrun.** Local
 *     count 0 with `X-RateLimit-Remaining: 400` means 600 calls are already gone today; the very
 *     next `remaining()` reflects that instead of cheerfully offering 950.
 *   - **It is keyed by UTC day**, matching `Quota`'s documented assumption that the window resets
 *     at UTC midnight. At rollover the count starts from zero again and the next response's header
 *     re-anchors it, so a wrong guess about seats.aero's reset boundary self-corrects within one
 *     call rather than persisting all day.
 *
 * The direction of the safety margin matters: over-counting costs the user a search they could
 * have run, under-counting costs them a hard 429 from seats.aero mid-grid. `max` chooses the first.
 */
import { SEATS_AERO_DAILY_LIMIT, type QuotaStore, utcDayKey } from "@awardgrid/core/seatsaero/quota";

export interface QuotaSnapshot {
  version: number;
  /** UTC day (YYYY-MM-DD) → calls used. Only today's entry is load-bearing; the rest is history. */
  days: Record<string, number>;
}

export const QUOTA_SNAPSHOT_VERSION = 1;

/** Days of history kept in the snapshot, so the file cannot grow without bound. */
const KEEP_DAYS = 7;

export class DeviceQuotaStore implements QuotaStore {
  readonly #days = new Map<string, number>();
  /**
   * Per-day floor established by seats.aero's own header. `runFind` RESERVES calls up front and
   * refunds the unused ones with a negative `increment`; without a floor, that refund would walk
   * the count back below what the provider told us was already spent, quietly re-introducing the
   * over-optimism the header exists to correct.
   */
  readonly #floors = new Map<string, number>();
  readonly #dailyLimit: number;
  #dirty = false;

  constructor(opts: { dailyLimit?: number } = {}) {
    this.#dailyLimit = opts.dailyLimit ?? SEATS_AERO_DAILY_LIMIT;
  }

  /** True when there is state worth persisting. The caller decides when to actually write. */
  get dirty(): boolean {
    return this.#dirty;
  }

  async get(_userId: string, day: string): Promise<number> {
    return this.#days.get(day) ?? 0;
  }

  async increment(_userId: string, day: string, n: number): Promise<number> {
    // A refund may return unused reservations, but never below seats.aero's own floor.
    const next = Math.max((this.#days.get(day) ?? 0) + n, this.#floors.get(day) ?? 0);
    this.#days.set(day, next);
    this.#dirty = true;
    return next;
  }

  /**
   * Fold seats.aero's own `X-RateLimit-Remaining` into today's count. Returns the resulting
   * `used` so a caller can log or display the correction.
   *
   * Ignores a missing, non-numeric or negative header rather than guessing — an absent header is
   * not evidence of zero remaining, and treating it as such would lock the user out.
   */
  observeRateLimitRemaining(headerValue: string | null | undefined, now: Date): number {
    const day = utcDayKey(now);
    const local = this.#days.get(day) ?? 0;
    if (headerValue == null) return local;
    const remaining = Number.parseInt(String(headerValue).trim(), 10);
    if (!Number.isFinite(remaining) || remaining < 0) return local;

    const impliedUsed = Math.max(0, this.#dailyLimit - remaining);
    // The floor is monotonic in its own right: a later, rosier header must not lower it.
    this.#floors.set(day, Math.max(this.#floors.get(day) ?? 0, impliedUsed));
    if (impliedUsed <= local) return local; // monotonic: never refund
    this.#days.set(day, impliedUsed);
    this.#dirty = true;
    return impliedUsed;
  }

  snapshot(now: Date): QuotaSnapshot {
    const cutoff = new Date(now.getTime() - KEEP_DAYS * 86_400_000);
    const days: Record<string, number> = {};
    for (const [day, n] of this.#days) if (day >= utcDayKey(cutoff)) days[day] = n;
    return { version: QUOTA_SNAPSHOT_VERSION, days };
  }

  /** Replace the counts from a snapshot. A version mismatch is discarded, not migrated. */
  restore(snapshot: QuotaSnapshot | null | undefined): void {
    this.#days.clear();
    this.#dirty = false;
    // `typeof null === "object"`, so the null check has to be explicit or a `days: null`
    // snapshot walks straight into Object.entries and throws on startup.
    if (!snapshot || snapshot.version !== QUOTA_SNAPSHOT_VERSION) return;
    if (snapshot.days === null || typeof snapshot.days !== "object") return;
    for (const [day, n] of Object.entries(snapshot.days)) {
      if (typeof n === "number" && Number.isFinite(n) && n >= 0) this.#days.set(day, n);
    }
  }

  markClean(): void {
    this.#dirty = false;
  }
}
