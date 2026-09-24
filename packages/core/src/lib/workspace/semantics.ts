/**
 * Truthful field semantics for the UI/UX v1 surfaces (handoff docs/03 §1–2, docs/05).
 *
 *   knownSeats(n)               a seat count only when one was reported; 0 / missing → null ("not provided")
 *   knownFees(cents, currency)  a displayable amount only when both parts are known; an explicit 0 is kept
 *   feesState(cents, currency)  the same, but says WHICH part is missing, so the UI never shows "free"
 *   toTimeEvidence(...)         which clock a time came from; a bad or future time is never "just now"
 *   rowTimeEvidence(row, now)   the same for a decoded/cached AvailabilityRow, by its recorded time_basis
 *   parseInstant / isRealDate   strict ISO parsing, arithmetic, never the lenient Date.parse
 *
 * The older helpers in grid/format.ts and grid/freshness.ts keep their pinned behaviour for the web grid, CLI
 * and Ask tools (they read a null currency as USD and clamp a future time to "now"); the new surfaces read
 * through these instead (docs/uiux-v1/DECISIONS.md U-002).
 */
import type { AvailabilityRow } from "../grid/types";
import type { ISOInstant, TimeEvidence } from "./types";

/** How far ahead of this device's clock a provider time may be and still be believed: ordinary clock skew. */
export const FUTURE_SKEW_MS = 60_000;

// ---- seats and fees ------------------------------------------------------------------------------------------

/** A seat count only when the program reported one. seats.aero's 0 means "not provided", not "sold out". */
export function knownSeats(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * An ISO 4217-shaped code, upper-cased, or null. A blank or malformed code is not a currency. Checked as three
 * ASCII letters BEFORE case-folding, so look-alikes ("uſd", "ınr") and non-ASCII padding are not folded into one.
 */
export function knownCurrency(currency: string | null | undefined): string | null {
  const code = typeof currency === "string" ? currency.replace(/^[ \t]+|[ \t]+$/g, "") : "";
  return /^[A-Za-z]{3}$/.test(code) ? code.toUpperCase() : null;
}

/** Minor units: a safe, non-negative whole number. `-0` becomes 0 so it can never print as "-$0.00". */
function knownCents(cents: number | null | undefined): number | null {
  return typeof cents === "number" && Number.isSafeInteger(cents) && cents >= 0 ? cents + 0 : null;
}

/** An amount with its currency, or null when either is unknown. An explicit 0 with a currency is a real zero. */
export function knownFees(cents: number | null, currency: string | null): { cents: number; currency: string } | null {
  const amount = knownCents(cents);
  const code = knownCurrency(currency);
  return amount !== null && code !== null ? { cents: amount, currency: code } : null;
}

export type FeesState =
  | { kind: "known"; cents: number; currency: string }
  /** The amount was reported, the currency was not: show the gap, never assume USD. */
  | { kind: "currency_missing"; cents: number }
  /** No usable amount: "fees not yet confirmed", never "free". */
  | { kind: "unknown" };

export function feesState(cents: number | null, currency: string | null): FeesState {
  const amount = knownCents(cents);
  if (amount === null) return { kind: "unknown" };
  const code = knownCurrency(currency);
  return code === null ? { kind: "currency_missing", cents: amount } : { kind: "known", cents: amount, currency: code };
}

// ---- dates and instants --------------------------------------------------------------------------------------

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Days in a proleptic Gregorian month, by arithmetic (Date.UTC reads years 0–99 as 1900–1999). */
function daysInMonth(year: number, month: number): number {
  return month === 2 ? (isLeapYear(year) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * The earliest instant believed as a data timestamp. Nothing in this domain predates it, and a zero-value time
 * from a provider's backend ("0001-01-01T00:00:00Z") must read as "no time", never as a very old real one.
 */
export const EARLIEST_INSTANT_YEAR = 1970;

/** A real Gregorian YYYY-MM-DD (rejects 2026-02-30, which Date.parse silently rolls into March). */
export function isRealDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

const INSTANT = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|([+-])(\d{2}):(\d{2}))$/;

/**
 * Epoch milliseconds of a full ISO 8601 instant with a zone, or null. Computed field by field so an impossible
 * calendar time (Feb 30, hour 25) or a zone-less local time is rejected instead of being reinterpreted.
 */
export function parseInstant(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = INSTANT.exec(value);
  if (!m || !isRealDate(m[1])) return null;
  const [year, month, day] = m[1]!.split("-").map(Number) as [number, number, number];
  if (year < EARLIEST_INSTANT_YEAR) return null;
  const hour = Number(m[2]);
  const minute = Number(m[3]);
  const second = m[4] === undefined ? 0 : Number(m[4]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  const millis = m[5] === undefined ? 0 : Number(m[5].padEnd(3, "0").slice(0, 3));
  let offsetMinutes = 0;
  if (m[6] !== "Z") {
    const oh = Number(m[8]);
    const om = Number(m[9]);
    if (oh > 14 || om > 59) return null;
    offsetMinutes = (m[7] === "-" ? -1 : 1) * (oh * 60 + om);
  }
  return Date.UTC(year, month - 1, day, hour, minute, second, millis) - offsetMinutes * 60_000;
}

/**
 * Age of a believed time at `now`, in ms, or null when either value is not an instant. A time inside the clock-skew
 * window (FUTURE_SKEW_MS ahead) is age 0; toTimeEvidence has already dropped anything further ahead, so a negative
 * age can never be shown.
 */
export function ageMs(at: string | null | undefined, now: ISOInstant): number | null {
  const atMs = parseInstant(at);
  const nowMs = parseInstant(now);
  if (atMs === null || nowMs === null) return null;
  return Math.max(0, nowMs - atMs);
}

// ---- time evidence -------------------------------------------------------------------------------------------

export interface TimeEvidenceInput {
  /** seats.aero ComputedLastSeen, when the payload carried one. */
  providerLastSeen?: string | null;
  /** seats.aero UpdatedAt, when the payload carried one. */
  providerUpdatedAt?: string | null;
  /** When this device fetched the data. */
  fetchedAt?: string | null;
  /** This device's clock, as an ISO instant. */
  now: ISOInstant;
}

/**
 * Which clock a time came from. The first provider time that is a valid instant and not in the future (beyond
 * FUTURE_SKEW_MS) wins; otherwise only the local fetch time is known (`local_fallback`), or nothing (`unknown`).
 * A future or malformed provider time is dropped rather than shown as "just now" (acceptance A03).
 */
export function toTimeEvidence(input: TimeEvidenceInput): TimeEvidence {
  const nowMs = parseInstant(input.now);
  if (nowMs === null) throw new Error(`toTimeEvidence: the clock value is not an ISO instant: ${String(input.now)}`);
  const believable = (value: string | null | undefined): string | null => {
    const ms = parseInstant(value);
    return ms !== null && ms <= nowMs + FUTURE_SKEW_MS ? (value as string) : null;
  };
  const fetchedAt = believable(input.fetchedAt);
  const lastSeen = believable(input.providerLastSeen);
  if (lastSeen !== null) return { basis: "provider_last_seen", providerAt: lastSeen, fetchedAt };
  const updated = believable(input.providerUpdatedAt);
  if (updated !== null) return { basis: "provider_updated", providerAt: updated, fetchedAt };
  return { basis: fetchedAt !== null ? "local_fallback" : "unknown", providerAt: null, fetchedAt };
}

/**
 * Time evidence for a decoded or cached row, by what it recorded when it was decoded (seatsaero/normalize.ts):
 *
 * - time_basis "provider_last_seen": computed_last_seen is the provider's ComputedLastSeen; if that is unusable
 *   (malformed, or ahead of this clock), the provider's UpdatedAt (provider_updated_at) is still tried.
 * - time_basis "provider_updated": computed_last_seen is the provider's UpdatedAt.
 * - time_basis "local_fallback": the provider sent no time; only the fetch time is known.
 * - no time_basis: the row was written before provenance was recorded (or by a store that does not keep it).
 *   Its computed_last_seen may be the fetch time in disguise, and whether the provider sent a time is not known,
 *   so the basis is "unknown" — shown apart from local_fallback — and only the fetch time is carried
 *   (docs/03 §1: "legacy … 按unknown，本机fetchedAt可单独展示").
 */
export function rowTimeEvidence(
  row: Pick<AvailabilityRow, "computed_last_seen" | "fetched_at" | "time_basis" | "provider_updated_at">,
  now: ISOInstant,
): TimeEvidence {
  switch (row.time_basis) {
    case "provider_last_seen":
      return toTimeEvidence({ providerLastSeen: row.computed_last_seen, providerUpdatedAt: row.provider_updated_at, fetchedAt: row.fetched_at, now });
    case "provider_updated":
      return toTimeEvidence({ providerUpdatedAt: row.computed_last_seen, fetchedAt: row.fetched_at, now });
    case "local_fallback":
      return toTimeEvidence({ fetchedAt: row.fetched_at, now });
    default:
      return { basis: "unknown", providerAt: null, fetchedAt: toTimeEvidence({ fetchedAt: row.fetched_at, now }).fetchedAt };
  }
}
