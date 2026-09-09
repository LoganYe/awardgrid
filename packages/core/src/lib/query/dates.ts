/**
 * Deterministic date parsing relative to an injected `today` (kickoff §4.2).
 *
 * Pure: never reads the clock. Everything is done on UTC calendar days so the result does not
 * depend on the server's timezone. Returns null whenever the text has no pattern we can turn
 * into both bounds deterministically — holiday words (国庆, 春节, Thanksgiving, …) are
 * deliberately NOT handled so the LLM sees them.
 *
 * Precedence (first hit wins): explicit range → relative window ("next 30 days") → single date
 * → bare month. A holiday word suppresses the bare-month fallback only ("十月国庆" → LLM), never
 * an explicit range ("国庆 10月1日到10月7日" is exact enough).
 */
import { notice, type Notice } from "../notices";
import { MAX_SPAN_DAYS } from "./schema";

export interface DateRange {
  date_from: string;
  date_to: string;
  /** true when date_to was truncated to honour MAX_SPAN_DAYS */
  capped: boolean;
  /** Set when the text was understood but not taken literally (e.g. a reversed explicit range). */
  warning?: Notice;
}

const DAY_MS = 86_400_000;

export function parseISODate(s: string): number {
  const t = Date.parse(`${s}T00:00:00Z`);
  if (Number.isNaN(t)) throw new Error(`invalid ISO date: ${s}`);
  return t;
}

export function formatISODate(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

export function addDays(t: number, days: number): number {
  return t + days * DAY_MS;
}

/** Returns the UTC timestamp for a calendar date or null when it is not a real date (Feb 30). */
function utcDate(y: number, m: number, d: number): number | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = Date.UTC(y, m - 1, d);
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return t;
}

function endOfMonth(y: number, m: number): number {
  return Date.UTC(y, m, 0); // day 0 of next month
}

/** Truncate `to` so the inclusive span is at most MAX_SPAN_DAYS. */
export function capRange(from: number, to: number): DateRange {
  const maxTo = addDays(from, MAX_SPAN_DAYS - 1);
  const capped = to > maxTo;
  return { date_from: formatISODate(from), date_to: formatISODate(capped ? maxTo : to), capped };
}

// ---------------------------------------------------------------------------------------------
// Numbers and month names
// ---------------------------------------------------------------------------------------------

const ZH_DIGITS: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

/** "三" → 3, "十" → 10, "十五" → 15, "二十" → 20, "二十一" → 21, "12" → 12. Null when unparsable. */
export function parseSmallNumber(s: string): number | null {
  if (/^\d+$/.test(s)) return Number(s);
  if (!/^[零〇一二两兩三四五六七八九十]+$/.test(s)) return null;
  const idx = s.indexOf("十");
  if (idx === -1) {
    if (s.length !== 1) return null;
    return ZH_DIGITS[s] ?? null;
  }
  const tens = idx === 0 ? 1 : ZH_DIGITS[s.slice(0, idx)];
  const onesStr = s.slice(idx + 1);
  const ones = onesStr === "" ? 0 : ZH_DIGITS[onesStr];
  if (tens === undefined || ones === undefined || onesStr.length > 1) return null;
  return tens * 10 + ones;
}

const EN_MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5,
  june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9,
  october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};
const EN_MONTH_ALT =
  "january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec";

/**
 * English month token → month number. "may" is only a month when capitalised ("May") because
 * the lower-case word is almost always the verb.
 */
function enMonth(token: string): number | null {
  if (token === "may") return null;
  return EN_MONTHS[token.toLowerCase()] ?? null;
}

/** Small counts and calendar numbers: "12", "十五", "二十一" (months, days of month, counts of months). */
const NUM = "(?:\\d{1,2}|[一二两兩三四五六七八九十]{1,3})";
/** Day counts may run past 99 ("未来100天" is capped, not rejected) — mirrors the English \d{1,3}. */
const DAYS_NUM = "(?:\\d{1,3}|[一二两兩三四五六七八九十]{1,3})";
const HOLIDAY_RE =
  /国庆|國慶|春节|春節|中秋|端午|清明|五一|劳动节|勞動節|元旦|圣诞|聖誕|感恩节|感恩節|复活节|復活節|暑假|寒假|黄金周|黃金週|thanksgiving|christmas|xmas|easter|new year|golden week|spring break|labor day|memorial day|holiday/i;

// ---------------------------------------------------------------------------------------------
// Relative windows
// ---------------------------------------------------------------------------------------------

interface Relative {
  re: RegExp;
  days: (m: RegExpExecArray) => number | null;
}

const RELATIVE: Relative[] = [
  // two weeks
  { re: /未来两周|未來兩週|未來两周|接下来两周|接下來兩週|两周内|兩週內|两周之内|next\s+(?:two|2)\s+weeks|next\s+14\s+days|next\s+fortnight|within\s+(?:two|2)\s+weeks/i, days: () => 14 },
  // one week
  { re: /未来一周|未來一週|接下来一周|接下來一週|一周内|一週內|下周|下週|下星期|next\s+(?:one\s+)?week|next\s+7\s+days|within\s+a\s+week/i, days: () => 7 },
  // N months (N*30, later capped)
  {
    re: new RegExp(`(?:未来|未來|接下来|接下來|今后|今後)\\s*(${NUM})\\s*个?個?月`),
    days: (m) => (m[1] ? mul(parseSmallNumber(m[1]), 30) : null),
  },
  {
    re: /(?:next|in\s+the\s+next|within|over\s+the\s+next|for\s+the\s+next)\s+(\d{1,2}|one|two|three|four|five|six)\s+months?/i,
    days: (m) => mul(enSmallNumber(m[1] ?? ""), 30),
  },
  // one month / next month / next 30 days
  {
    re: /未来一个月|未來一個月|接下来一个月|接下來一個月|下个月|下個月|下月|一个月内|一個月內|一个月之内|next\s+month|next\s+30\s+days|(?:in|within|over)\s+the\s+next\s+month|within\s+a\s+month|coming\s+month|next\s+four\s+weeks|next\s+4\s+weeks/i,
    days: () => 30,
  },
  // N days
  {
    re: new RegExp(`(?:未来|未來|接下来|接下來|今后|今後)\\s*(${DAYS_NUM})\\s*天`),
    days: (m) => (m[1] ? parseSmallNumber(m[1]) : null),
  },
  { re: new RegExp(`(${DAYS_NUM})\\s*天(?:内|內|之内|之內|以内|以內)`), days: (m) => (m[1] ? parseSmallNumber(m[1]) : null) },
  {
    re: /(?:next|in\s+the\s+next|within|over\s+the\s+next|for\s+the\s+next)\s+(\d{1,3})\s+days/i,
    days: (m) => (m[1] ? Number(m[1]) : null),
  },
];

function mul(n: number | null, k: number): number | null {
  return n === null ? null : n * k;
}

function enSmallNumber(s: string): number | null {
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  if (/^\d+$/.test(s)) return Number(s);
  return words[s.toLowerCase()] ?? null;
}

function parseRelative(text: string, today: number): DateRange | null {
  for (const { re, days } of RELATIVE) {
    const m = re.exec(text);
    if (!m) continue;
    const n = days(m);
    if (n === null || n <= 0) continue;
    // Inclusive: "next 30 days" is today plus 29 more, so the Dates chip reads "(30 days)" and
    // matches the editor's own "Next 30 days" preset (date-model.presetRange).
    return capRange(today, addDays(today, n - 1));
  }
  if (/本月|这个月|這個月|this\s+month|rest\s+of\s+(?:the|this)\s+month/i.test(text)) {
    const d = new Date(today);
    return capRange(today, endOfMonth(d.getUTCFullYear(), d.getUTCMonth() + 1));
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Explicit dates
// ---------------------------------------------------------------------------------------------

/** Next occurrence of (m, d) on or after today when no year is given. */
function nextOccurrence(m: number, d: number, today: number, year: number | null): number | null {
  if (year !== null) return utcDate(year, m, d);
  const y = new Date(today).getUTCFullYear();
  const thisYear = utcDate(y, m, d);
  if (thisYear !== null && thisYear >= today) return thisYear;
  return utcDate(y + 1, m, d) ?? thisYear;
}

/** For the end of a range without a year: same year as `from`, rolling over when it would precede it. */
function rangeEnd(m: number, d: number, from: number, year: number | null): number | null {
  if (year !== null) return utcDate(year, m, d);
  const y = new Date(from).getUTCFullYear();
  const sameYear = utcDate(y, m, d);
  if (sameYear !== null && sameYear >= from) return sameYear;
  return utcDate(y + 1, m, d);
}

const RANGE_SEP = "\\s*(?:到|至|~|～|-|–|—|to|through|until|thru)\\s*";
const ISO = "(\\d{4})-(\\d{2})-(\\d{2})";
/** Month and day may be digits or Chinese numerals ("10月1日", "十月十五日"); see zhNum. */
const ZH_DATE = `(?:(\\d{4})\\s*年)?\\s*(${NUM})\\s*月\\s*(${NUM})\\s*[日号號]?`;
const ZH_DAY_ONLY = `(${NUM})\\s*[日号號]`;
const EN_DATE = `(${EN_MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?`;
const SLASH = "(\\d{1,2})/(\\d{1,2})(?:/(\\d{4}))?";

function num(s: string | undefined): number | null {
  return s === undefined ? null : Number(s);
}

/** A ZH_DATE month/day capture ("10" or "十五") as a number; NaN when absent or unparsable. */
function zhNum(s: string | undefined): number {
  if (s === undefined) return Number.NaN;
  return parseSmallNumber(s) ?? Number.NaN;
}

/** Shared ending for explicit ranges: reject impossible dates, swap a reversed range and say so. */
function finishRange(from: number | null, to: number | null): DateRange | null {
  if (from === null || to === null) return null;
  if (to >= from) return capRange(from, to);
  const swapped = capRange(to, from);
  return {
    ...swapped,
    warning: notice("parse.range_end_first", {
      from: formatISODate(from),
      to: formatISODate(to),
      date_from: swapped.date_from,
      date_to: swapped.date_to,
    }),
  };
}

function parseExplicitRange(text: string, today: number): DateRange | null {
  // 2026-10-01 to 2026-10-15
  let m = new RegExp(`${ISO}${RANGE_SEP}${ISO}`).exec(text);
  if (m) {
    const from = utcDate(Number(m[1]), Number(m[2]), Number(m[3]));
    const to = utcDate(Number(m[4]), Number(m[5]), Number(m[6]));
    return finishRange(from, to);
  }
  // 10月1日到10月15日 / 10月1日到15日 / 2026年10月1日至10月15日
  m = new RegExp(`${ZH_DATE}${RANGE_SEP}(?:${ZH_DATE}|${ZH_DAY_ONLY})`).exec(text);
  if (m) {
    const from = nextOccurrence(zhNum(m[2]), zhNum(m[3]), today, num(m[1]));
    if (from === null) return null;
    const to =
      m[5] !== undefined
        ? rangeEnd(zhNum(m[5]), zhNum(m[6]), from, num(m[4]))
        : rangeEnd(zhNum(m[2]), zhNum(m[7]), from, null);
    return finishRange(from, to);
  }
  // Oct 1 - Oct 15 / October 1st to 15th / Oct 1 - Nov 5, 2026
  m = new RegExp(`${EN_DATE}${RANGE_SEP}(?:(${EN_MONTH_ALT})\\.?\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?(?![\\d/])`, "i").exec(
    text,
  );
  if (m) {
    const m1 = enMonth(m[1] ?? "");
    if (m1 === null) return null;
    const from = nextOccurrence(m1, Number(m[2]), today, num(m[3]));
    if (from === null) return null;
    const m2 = m[4] !== undefined ? enMonth(m[4]) : m1;
    if (m2 === null) return null;
    const to = rangeEnd(m2, Number(m[5]), from, num(m[6]));
    return finishRange(from, to);
  }
  // 10/1-10/15 (month/day, US order — documented)
  m = new RegExp(`(?<![\\d/])${SLASH}${RANGE_SEP}${SLASH}(?![\\d/])`).exec(text);
  if (m) {
    const from = nextOccurrence(Number(m[1]), Number(m[2]), today, num(m[3]));
    if (from === null) return null;
    const to = rangeEnd(Number(m[4]), Number(m[5]), from, num(m[6]));
    return finishRange(from, to);
  }
  return null;
}

function parseSingleDate(text: string, today: number): DateRange | null {
  let m = new RegExp(`(?<![\\d-])${ISO}(?![\\d-])`).exec(text);
  if (m) {
    const t = utcDate(Number(m[1]), Number(m[2]), Number(m[3]));
    return t === null ? null : capRange(t, t);
  }
  m = new RegExp(`${ZH_DATE}`).exec(text);
  if (m && /[日号號]\s*$/.test(m[0])) {
    const t = nextOccurrence(zhNum(m[2]), zhNum(m[3]), today, num(m[1]));
    return t === null ? null : capRange(t, t);
  }
  m = new RegExp(`(?<![A-Za-z])${EN_DATE}(?![\\d/])`, "i").exec(text);
  if (m) {
    const mo = enMonth(m[1] ?? "");
    if (mo === null) return null;
    const t = nextOccurrence(mo, Number(m[2]), today, num(m[3]));
    return t === null ? null : capRange(t, t);
  }
  m = new RegExp(`(?<![\\d/])${SLASH}(?![\\d/])`).exec(text);
  if (m) {
    const t = nextOccurrence(Number(m[1]), Number(m[2]), today, num(m[3]));
    return t === null ? null : capRange(t, t);
  }
  return null;
}

/** Whole month: current month → today..end of month; otherwise the next occurrence of that month. */
function monthRange(month: number, year: number | null, today: number): DateRange | null {
  if (month < 1 || month > 12) return null;
  const d = new Date(today);
  const cy = d.getUTCFullYear();
  const cm = d.getUTCMonth() + 1;
  let y = year ?? (month >= cm ? cy : cy + 1);
  if (year === null && month === cm) y = cy;
  const start = Date.UTC(y, month - 1, 1);
  const from = start < today ? today : start;
  const to = endOfMonth(y, month);
  if (to < from) return null;
  return capRange(from, to);
}

function parseBareMonth(text: string, today: number): DateRange | null {
  // 十月 / 10月 / 2026年11月 — but not "一个月", "10月1日" (already consumed by earlier passes)
  // The lookahead uses NUM so a Chinese-numeral day ("十月十五日") also suppresses the whole-month fallback.
  let m = new RegExp(`(?:(\\d{4})\\s*年)?\\s*(十一|十二|十|[一二三四五六七八九]|\\d{1,2})\\s*月(?!\\s*${NUM}\\s*[日号號])(?!份?\\s*[初中末底])`).exec(
    text,
  );
  if (m && m[2] !== undefined) {
    const month = parseSmallNumber(m[2]);
    if (month !== null) return monthRange(month, num(m[1]), today);
  }
  m = new RegExp(`(?<![A-Za-z])(${EN_MONTH_ALT})\\.?(?:\\s+(\\d{4}))?(?![A-Za-z])`, "i").exec(text);
  if (m) {
    const month = m[1] === "May" ? 5 : enMonth(m[1] ?? "");
    if (month !== null) return monthRange(month, num(m[2]), today);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------

/**
 * Parse the date window mentioned in `text`. `today` is an ISO date (YYYY-MM-DD).
 * Returns null when nothing deterministic was found (caller decides whether to use the LLM).
 */
export function parseDates(text: string, today: string): DateRange | null {
  const t = parseISODate(today);
  return (
    parseExplicitRange(text, t) ??
    parseRelative(text, t) ??
    parseSingleDate(text, t) ??
    (HOLIDAY_RE.test(text) ? null : parseBareMonth(text, t))
  );
}
