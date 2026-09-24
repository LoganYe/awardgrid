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
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

/** An ISO 4217-shaped code, upper-cased, or null. A blank or malformed code is not a currency. */
export function knownCurrency(currency: string | null | undefined): string | null {
  const code = typeof currency === "string" ? currency.trim().toUpperCase() : "";
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function knownCents(cents: number | null | undefined): number | null {
  return typeof cents === "number" && Number.isInteger(cents) && cents >= 0 ? cents : null;
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

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

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
 * Time evidence for a decoded or cached row. Only a row that recorded its basis when it was decoded
 * (seatsaero/normalize.ts `time_basis`) can prove a provider time. A row without it — written before this
 * field existed, or read back from a store that does not keep it — shows its local fetch time only: its
 * computed_last_seen may be that very fetch time in disguise.
 */
export function rowTimeEvidence(row: Pick<AvailabilityRow, "computed_last_seen" | "fetched_at" | "time_basis">, now: ISOInstant): TimeEvidence {
  switch (row.time_basis) {
    case "provider_last_seen":
      return toTimeEvidence({ providerLastSeen: row.computed_last_seen, fetchedAt: row.fetched_at, now });
    case "provider_updated":
      return toTimeEvidence({ providerUpdatedAt: row.computed_last_seen, fetchedAt: row.fetched_at, now });
    default:
      return toTimeEvidence({ fetchedAt: row.fetched_at, now });
  }
}
