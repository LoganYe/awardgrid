/**
 * Calendar model for the Dates chip editor (Phase 6 §3.2, docs/UI_PLAN.md §6.2a).
 *
 * Pure and UTC-only: a calendar day is a `YYYY-MM-DD` label, never an instant, so the grid a
 * user in Auckland sees is the grid a user in Los Angeles sees. Nothing here touches React,
 * `Date.now()` or the DOM — `today` is always passed in, so the tests are deterministic.
 *
 * What lives here:
 *   - `monthGrid`     one month as 6 × 7 cells (always six rows, so the popover never reflows)
 *   - `rangeReducer`  click start, click end, click again resets
 *   - `presetRange`   "Next 30 / 60 / 90 days", counted inclusively from today
 *   - `clampTo92`     the seats.aero span cap, reported as a NOTE flag, never an error
 *   - `formatRange`   "Oct 1 – Oct 30" (en dash with spaces; the year appears when the range
 *                     crosses one)
 */
import { intlLocale, type FormatLocale } from "@/lib/grid/format";
import { MAX_SPAN_DAYS } from "@/lib/query/schema";

const DAY_MS = 86_400_000;
const WEEK_LENGTH = 7;
/** Six rows always: February in a common year needs four, December 2026 needs five. */
export const MONTH_ROWS = 6;
export const MONTH_CELLS = MONTH_ROWS * WEEK_LENGTH;

/** 0 = Sunday … 6 = Saturday, matching `Date.prototype.getUTCDay`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
/** The plan's calendar starts on Monday (`Mo Tu We Th Fr Sa Su`). */
export const DEFAULT_WEEK_START: Weekday = 1;

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a well-formed, real calendar day (`2026-02-30` is not one). */
export function isISODate(value: string): boolean {
  if (!ISO_RE.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

/** `YYYY-MM-DD` → epoch ms at UTC midnight; null when the string is not a real day. */
export function toDayMs(iso: string): number | null {
  return isISODate(iso) ? Date.parse(`${iso}T00:00:00Z`) : null;
}

export function toISO(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** `addDays("2026-02-28", 1)` → "2026-03-01"; an unparseable input comes back unchanged. */
export function addDays(iso: string, days: number): string {
  const ms = toDayMs(iso);
  return ms === null ? iso : toISO(ms + days * DAY_MS);
}

/** Inclusive day count: the same day twice is 1 day. 0 when either end is unparseable. */
export function daysInclusive(from: string, to: string): number {
  const a = toDayMs(from);
  const b = toDayMs(to);
  if (a === null || b === null) return 0;
  return Math.round((b - a) / DAY_MS) + 1;
}

// ---------------------------------------------------------------------------
// Month grid
// ---------------------------------------------------------------------------

export interface DayCell {
  /** `YYYY-MM-DD` */
  iso: string;
  year: number;
  /** 1–12 */
  month: number;
  /** 1–31 */
  day: number;
  /** False for the leading/trailing days borrowed from the neighbouring months. */
  inMonth: boolean;
  weekday: Weekday;
}

/** `{ year: 2026, month: 12 }` + 1 → `{ year: 2027, month: 1 }`. `month` is 1-based. */
export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const zero = year * 12 + (month - 1) + delta;
  return { year: Math.floor(zero / 12), month: (((zero % 12) + 12) % 12) + 1 };
}

/**
 * One month as six rows of seven cells, starting on `weekStartsOn`. Cells outside the month are
 * real days from the neighbouring months with `inMonth: false` (the editor greys them; clicking
 * one is still a valid pick).
 */
export function monthGrid(year: number, month: number, weekStartsOn: Weekday = DEFAULT_WEEK_START): DayCell[][] {
  const first = Date.UTC(year, month - 1, 1);
  const firstWeekday = new Date(first).getUTCDay() as Weekday;
  const lead = (firstWeekday - weekStartsOn + WEEK_LENGTH) % WEEK_LENGTH;
  const start = first - lead * DAY_MS;
  const rows: DayCell[][] = [];
  for (let r = 0; r < MONTH_ROWS; r++) {
    const row: DayCell[] = [];
    for (let c = 0; c < WEEK_LENGTH; c++) {
      const d = new Date(start + (r * WEEK_LENGTH + c) * DAY_MS);
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth() + 1;
      row.push({
        iso: toISO(d.getTime()),
        year: y,
        month: m,
        day: d.getUTCDate(),
        inMonth: y === year && m === month,
        weekday: d.getUTCDay() as Weekday,
      });
    }
    rows.push(row);
  }
  return rows;
}

/** Weekday column order for a header row, e.g. `[1,2,3,4,5,6,0]` for a Monday start. */
export function weekdayOrder(weekStartsOn: Weekday = DEFAULT_WEEK_START): Weekday[] {
  return Array.from({ length: WEEK_LENGTH }, (_, i) => ((weekStartsOn + i) % WEEK_LENGTH) as Weekday);
}

// ---------------------------------------------------------------------------
// Range selection
// ---------------------------------------------------------------------------

export interface RangeSelection {
  start: string | null;
  /** null while the user has picked a start but not yet an end. */
  end: string | null;
}

export const EMPTY_RANGE: RangeSelection = { start: null, end: null };

export type RangeAction =
  | { type: "pick"; date: string }
  | { type: "preset"; days: number; today: string }
  | { type: "set"; start: string; end: string }
  | { type: "clear" };

/**
 * Click start, click end, click again resets (spec §3.2). A second click before the first
 * orders itself: picking Oct 3 then Oct 1 yields Oct 1 – Oct 3. A malformed date is ignored.
 */
export function rangeReducer(state: RangeSelection, action: RangeAction): RangeSelection {
  switch (action.type) {
    case "clear":
      return EMPTY_RANGE;
    case "preset":
      return presetRange(action.days, action.today);
    case "set":
      return isISODate(action.start) && isISODate(action.end) ? orderRange({ start: action.start, end: action.end }) : state;
    case "pick": {
      if (!isISODate(action.date)) return state;
      // A complete range starts over; a half-open one closes.
      if (state.start === null || state.end !== null) return { start: action.date, end: null };
      return orderRange({ start: state.start, end: action.date });
    }
  }
}

function orderRange(range: RangeSelection): RangeSelection {
  const a = range.start === null ? null : toDayMs(range.start);
  const b = range.end === null ? null : toDayMs(range.end);
  if (a === null || b === null) return range;
  return b < a ? { start: range.end, end: range.start } : range;
}

/** True once both ends are picked. */
export function isCompleteRange(range: RangeSelection): range is { start: string; end: string } {
  return range.start !== null && range.end !== null;
}

/** Where a day sits in the current selection — enough to paint the calendar. */
export function dayState(iso: string, range: RangeSelection): "start" | "end" | "in" | "none" {
  if (range.start === null) return "none";
  if (iso === range.start) return "start";
  if (range.end === null) return "none";
  if (iso === range.end) return "end";
  const d = toDayMs(iso);
  const a = toDayMs(range.start);
  const b = toDayMs(range.end);
  if (d === null || a === null || b === null) return "none";
  return d > a && d < b ? "in" : "none";
}

/** The three presets the editor offers, in order. */
export const RANGE_PRESETS = [30, 60, 90] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

/**
 * "Next 30 days" starting today, counted inclusively: Oct 1 + 30 days ends Oct 30, so the chip
 * reads "Oct 1 – Oct 30 (30 days)". `days` is clamped to the 92-day cap.
 */
export function presetRange(days: number, today: string): RangeSelection {
  if (!isISODate(today)) return EMPTY_RANGE;
  const span = Math.max(1, Math.min(Math.floor(days), MAX_SPAN_DAYS));
  return { start: today, end: addDays(today, span - 1) };
}

/** True when the range is exactly one of the presets counted from `today`. */
export function matchedPreset(range: RangeSelection, today: string): RangePreset | null {
  if (!isCompleteRange(range) || range.start !== today) return null;
  const days = daysInclusive(range.start, range.end);
  return (RANGE_PRESETS as readonly number[]).includes(days) ? (days as RangePreset) : null;
}

export interface ClampedRange {
  start: string | null;
  end: string | null;
  /** True when the end date had to move in to satisfy the cap — the editor shows a note. */
  capped: boolean;
  /** Inclusive day count after clamping; 0 for an incomplete range. */
  days: number;
}

/**
 * The seats.aero span cap (`MAX_SPAN_DAYS` = 92). Over-long ranges keep their start and pull the
 * end in; the caller renders `capped` as an inline NOTE, never an error (spec §3.2).
 */
export function clampTo92(range: RangeSelection): ClampedRange {
  const ordered = orderRange(range);
  if (!isCompleteRange(ordered)) return { start: ordered.start, end: ordered.end, capped: false, days: 0 };
  const days = daysInclusive(ordered.start, ordered.end);
  if (days <= MAX_SPAN_DAYS) return { start: ordered.start, end: ordered.end, capped: false, days };
  const end = addDays(ordered.start, MAX_SPAN_DAYS - 1);
  return { start: ordered.start, end, capped: true, days: MAX_SPAN_DAYS };
}

/** A complete, clamped range as the QueryObject's two fields; null while the range is half-open. */
export function toQueryDates(range: RangeSelection): { date_from: string; date_to: string } | null {
  const clamped = clampTo92(range);
  if (clamped.start === null || clamped.end === null) return null;
  return { date_from: clamped.start, date_to: clamped.end };
}

export function fromQueryDates(query: { date_from: string; date_to: string }): RangeSelection {
  return { start: query.date_from, end: query.date_to };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function dayLabel(iso: string, locale: FormatLocale, withYear: boolean): string {
  const ms = toDayMs(iso);
  if (ms === null) return iso;
  return new Intl.DateTimeFormat(intlLocale(locale), {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
    ...(withYear ? { year: "numeric" as const } : {}),
  }).format(new Date(ms));
}

/**
 * "Oct 1 – Oct 30" / "10月1日 – 10月30日". An en dash with a space on each side (the one place
 * the copy rules allow a dash; cells never carry a separator glyph). A range that crosses a year
 * boundary spells the year on both ends: "Dec 20, 2026 – Jan 5, 2027".
 * A half-open range renders its start alone; an empty one renders "".
 */
export function formatRange(range: RangeSelection, locale: FormatLocale = "en"): string {
  if (range.start === null) return "";
  const crossesYear = range.end !== null && range.start.slice(0, 4) !== range.end.slice(0, 4);
  const from = dayLabel(range.start, locale, crossesYear);
  if (range.end === null) return from;
  return `${from} – ${dayLabel(range.end, locale, crossesYear)}`;
}
