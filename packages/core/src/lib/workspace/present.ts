/**
 * How a result is put into words (UI/UX v1 T07; docs/05; spec §09 "数字和币种"): the same sentences on every surface
 * that shows a snapshot, in English and Chinese. Only what the data proves is said: an unknown fee is "not yet
 * confirmed", never free; a seat count of 0 is "not provided", never "sold out"; a provider time is dated as the
 * provider's, a local fetch time as this device's, and neither is invented when absent.
 *
 * Calendar days are formatted in UTC, so a query date never shifts with the device's time zone. Miles use grouped
 * digits in both languages ("75,000"). Sentences with an approved key in the handoff copy (fixtures/copy.zh-en.json)
 * use its text.
 */
import { type Cabin, DEFAULT_MIN_CABIN_PCT, type QueryObject, type SortBy } from "../query/schema";
import { SOURCE_NAMES } from "../seatsaero/types";
import { cabinName } from "./query-editor";
import { FUTURE_SKEW_MS, ageMs, feesState, knownSeats, parseInstant } from "./semantics";
import type { CoverageEvidence, CoverageSlice, ISODate, ISOInstant, ProjectedDay, TimeEvidence, WorkspaceRow } from "./types";

export type Locale = "en" | "zh";

/** Approved copy (fixtures/copy.zh-en.json), by key. */
export const COPY = {
  "data.source": { en: "Data: seats.aero", zh: "数据：seats.aero" },
  "result.none": { en: "No matches in the checked range.", zh: "已查询的范围内没有匹配结果。" },
  "result.partial": { en: "Results are incomplete.", zh: "结果不完整。" },
  "result.unknown": { en: "Coverage completeness is unknown.", zh: "完整性未知。" },
  "result.unmonitored": { en: "These routes are not monitored by the data source.", zh: "数据源未监测这些机场对。" },
  "result.min_partial": { en: "Lowest among the results retrieved", zh: "已取得结果中的最低值" },
  "fees.unknown": { en: "Fees not yet confirmed", zh: "税费待确认" },
  "fees.currency_unknown": { en: "Currency not provided", zh: "币种未提供" },
  "seats.unknown": { en: "Seat count not provided", zh: "席位未提供" },
  "time.provider_unknown": { en: "Source update time unknown", zh: "来源更新时间未知" },
  "time.local": { en: "Fetched on this device at {time}", zh: "本机获取于 {time}" },
  "run.old": { en: "Showing previous results; the new search failed.", zh: "新条件查询失败，当前显示此前结果。" },
  "run.inflight": { en: "Searching; previous results remain available.", zh: "正在查询，此前结果仍可查看。" },
} as const satisfies Record<string, Record<Locale, string>>;

export type CopyKey = keyof typeof COPY;

export function copy(key: CopyKey, locale: Locale, vars: Record<string, string> = {}): string {
  return COPY[key][locale].replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? `{${name}}`);
}

const MILES = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function formatMiles(miles: number): string {
  return MILES.format(miles);
}

function utc(date: ISODate): Date {
  return new Date(`${date}T00:00:00Z`);
}

/** "10月18日" (with "2026年" when asked), built from the UTC parts: ICU's zh-CN numeric month-day varies by build. */
function zhMonthDay(d: Date, withYear = false): string {
  return `${withYear ? `${d.getUTCFullYear()}年` : ""}${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}

const ZH_WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

/** "Sun, Oct 18" / "10月18日 · 周日": a calendar day with its weekday, never shifted by the device's zone. */
export function dayLabel(date: ISODate, locale: Locale): string {
  const d = utc(date);
  if (locale === "zh") return `${zhMonthDay(d)} · ${ZH_WEEKDAYS[d.getUTCDay()]}`;
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(d);
}

/** "Oct 1 – 30" / "10月1–30日"; across months "Oct 30 – Nov 5" / "10月30日–11月5日"; the year only when it differs. */
export function rangeLabel(from: ISODate, to: ISODate, locale: Locale): string {
  const a = utc(from);
  const b = utc(to);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  const sameMonth = sameYear && from.slice(5, 7) === to.slice(5, 7);
  if (locale === "zh") {
    if (from === to) return zhMonthDay(a);
    if (sameMonth) return `${a.getUTCMonth() + 1}月${a.getUTCDate()}–${b.getUTCDate()}日`;
    return `${zhMonthDay(a, !sameYear)}–${zhMonthDay(b, !sameYear)}`;
  }
  const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(d);
  if (from === to) return fmt(a, { month: "short", day: "numeric" });
  if (sameMonth) return `${fmt(a, { month: "short", day: "numeric" })} – ${b.getUTCDate()}`;
  const opts: Intl.DateTimeFormatOptions = sameYear ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" };
  return `${fmt(a, opts)} – ${fmt(b, opts)}`;
}

/** "USD 86.20"; an amount without a currency says so; an unknown amount is "not yet confirmed". A real 0 is 0.00. */
export function feesLabel(cents: number | null, currency: string | null, locale: Locale): string {
  const fees = feesState(cents, currency);
  if (fees.kind === "known") return `${fees.currency} ${(fees.cents / 100).toFixed(2)}`;
  if (fees.kind === "currency_missing") return `${(fees.cents / 100).toFixed(2)} · ${copy("fees.currency_unknown", locale)}`;
  return copy("fees.unknown", locale);
}

/** "2 seats" / "2 席"; 0 or nothing is "not provided". */
export function seatsLabel(seats: number | null | undefined, locale: Locale): string {
  const n = knownSeats(seats);
  if (n === null) return copy("seats.unknown", locale);
  return locale === "zh" ? `${n} 席` : `${n} ${n === 1 ? "seat" : "seats"}`;
}

/** "38 min" / "38 分钟", in whole units, never rounded up past what is proven. */
export function ageLabel(ms: number, locale: Locale): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return locale === "zh" ? "刚刚" : "just now";
  if (minutes < 60) return locale === "zh" ? `${minutes} 分钟前` : `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return locale === "zh" ? `${hours} 小时前` : `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return locale === "zh" ? `${days} 天前` : `${days} d ago`;
}

/** "Oct 18, 08:00" / "10月18日 08:00": an instant on this device's clock, with its day. */
function localStamp(at: Date, locale: Locale, timeZone?: string): string {
  const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(at);
  if (locale === "zh") {
    const parts = new Intl.DateTimeFormat("en-US", { month: "numeric", day: "numeric", timeZone }).formatToParts(at);
    const m = parts.find((p) => p.type === "month")?.value;
    const d = parts.find((p) => p.type === "day")?.value;
    return `${m}月${d}日 ${clock}`;
  }
  return `${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone }).format(at)}, ${clock}`;
}

/**
 * The source-time line for a row. The provider's time with its age; a provider time later than the display clock
 * (beyond the skew allowance) is not believed and reads as unknown, never "just now". Without a provider time: "source
 * update time unknown", and, when this device's fetch time is known, "fetched on this device at <day, time>" beside
 * it (spec §18) — the fetch time is never passed off as the source's. `timeZone` is the device's, for that clock time.
 */
export function timeLabel(time: TimeEvidence, now: ISOInstant, locale: Locale, timeZone?: string): string {
  if ((time.basis === "provider_last_seen" || time.basis === "provider_updated") && time.providerAt) {
    const at = parseInstant(time.providerAt);
    const nowMs = parseInstant(now);
    const future = at !== null && nowMs !== null && at > nowMs + FUTURE_SKEW_MS;
    const age = future ? null : ageMs(time.providerAt, now);
    if (age !== null) return locale === "zh" ? `来源 ${ageLabel(age, locale)}更新` : `Source updated ${ageLabel(age, locale)}`;
  }
  const unknown = copy("time.provider_unknown", locale);
  const fetched = time.fetchedAt ? new Date(time.fetchedAt) : null;
  if (fetched && !Number.isNaN(fetched.getTime())) return `${unknown} · ${copy("time.local", locale, { time: localStamp(fetched, locale, timeZone) })}`;
  return unknown;
}

export function programLabel(program: string): string {
  return (SOURCE_NAMES as Record<string, string>)[program] ?? program;
}

/** "HKG, PVG → SEA" / "HKG、PVG → SEA". */
export function routeLabel(query: Pick<QueryObject, "origins" | "destinations">, locale: Locale): string {
  const sep = locale === "zh" ? "、" : ", ";
  return `${query.origins.join(sep)} → ${query.destinations.join(sep)}`;
}

/**
 * "Oct 1 – 30 · Business, First · Nonstop · 1 program · mixed cabin ≥ 75% · dynamic pricing included" — the summary's
 * second line: every condition that changes what the search fetches, in words.
 */
export function querySubline(query: QueryObject, locale: Locale): string {
  const sep = locale === "zh" ? "、" : ", ";
  // Business first, as the editor lists them.
  const cabins = (["J", "F", "W", "Y"] as const satisfies readonly Cabin[]).filter((c) => query.cabins.includes(c));
  const parts = [rangeLabel(query.date_from, query.date_to, locale), cabins.map((c) => cabinName(c, locale)).join(sep)];
  if (query.direct_only) parts.push(locale === "zh" ? "直飞" : "Nonstop");
  const programs = query.programs?.length ?? 0;
  if (programs > 0) parts.push(locale === "zh" ? `${programs} 个计划` : `${programs} ${programs === 1 ? "program" : "programs"}`);
  if (query.max_miles !== undefined) parts.push(locale === "zh" ? `≤ ${formatMiles(query.max_miles)} 里程` : `≤ ${formatMiles(query.max_miles)} miles`);
  if (query.min_cabin_pct !== DEFAULT_MIN_CABIN_PCT) parts.push(locale === "zh" ? `混合舱位 ≥ ${query.min_cabin_pct}%` : `mixed cabin ≥ ${query.min_cabin_pct}%`);
  if (query.include_filtered) parts.push(locale === "zh" ? "含动态定价" : "dynamic pricing included");
  return parts.join(" · ");
}

/** How many of the "more" conditions (mileage cap, mixed cabin, dynamic pricing) are set: the chip's count. */
export function moreConditionsCount(query: QueryObject): number {
  return Number(query.max_miles !== undefined) + Number(query.min_cabin_pct !== DEFAULT_MIN_CABIN_PCT) + Number(query.include_filtered);
}

/** The sort as a short control label, direction in words ("Lowest miles"); `sortLabel` is the full phrase. */
export function sortShortLabel(sortBy: SortBy, locale: Locale): string {
  const labels: Record<SortBy, Record<Locale, string>> = {
    miles_asc: { en: "Lowest miles", zh: "里程升序" },
    fees_asc: { en: "Lowest fees", zh: "税费升序" },
    seats_desc: { en: "Most seats", zh: "席位降序" },
    date_asc: { en: "Earliest date", zh: "日期升序" },
  };
  return labels[sortBy][locale];
}

/** The label for the order the rows are shown in. */
export function sortLabel(sortBy: SortBy, locale: Locale): string {
  const labels: Record<SortBy, Record<Locale, string>> = {
    miles_asc: { en: "Miles, lowest first", zh: "里程升序" },
    fees_asc: { en: "Fees, lowest first", zh: "税费升序" },
    seats_desc: { en: "Seats, most first", zh: "席位降序" },
    date_asc: { en: "Date, earliest first", zh: "日期升序" },
  };
  return labels[sortBy][locale];
}

/**
 * A result's full accessible name (spec §19): route, day, cabin, program, miles, fees and seats — enough to tell two
 * options apart.
 */
export function resultName(row: WorkspaceRow["value"], locale: Locale): string {
  const sep = locale === "zh" ? "，" : ", ";
  const miles = locale === "zh" ? `${formatMiles(row.miles)} 里程` : `${formatMiles(row.miles)} miles`;
  return [`${row.origin} → ${row.dest}`, dayLabel(row.date, locale), cabinName(row.cabin, locale), programLabel(row.program), miles, feesLabel(row.fees_cents, row.currency, locale), seatsLabel(row.seats_left, locale)].join(sep);
}

export function optionsCount(n: number, locale: Locale): string {
  return locale === "zh" ? `${n} 个选项` : `${n} ${n === 1 ? "option" : "options"}`;
}

export interface CoverageNotice {
  kind: "unmonitored" | "partial" | "unknown" | "none";
  /** The approved sentence, then the routes it concerns, when the evidence names them (spec §18: say which range). */
  text: string;
}

function pairList(slices: readonly CoverageSlice[], locale: Locale): string {
  const pairs = [...new Set(slices.map((s) => `${s.origin} → ${s.destination}`))];
  return pairs.join(locale === "zh" ? "、" : ", ");
}

/**
 * What the results say about how much of the query they cover, pair by pair: routes the provider does not monitor,
 * routes not checked to the end (page cap, quota, an upstream error), routes whose coverage cannot be proven, each
 * named; "no matches in the checked range" only when every pair was checked to the end and nothing matched. Nothing
 * when every pair is complete and there are rows.
 */
export function coverageNotices(coverage: CoverageEvidence, rowCount: number, locale: Locale): CoverageNotice[] {
  const notices: CoverageNotice[] = [];
  // Chinese sentences run on after "。"; English ones take a space.
  const gap = locale === "zh" ? "" : " ";
  const by = (state: CoverageSlice["state"]) => coverage.slices.filter((s) => s.state === state);
  const named = (sentence: string, slices: CoverageSlice[], label: Record<Locale, string>) =>
    slices.length > 0 ? `${sentence}${gap}${label[locale]}${pairList(slices, locale)}${locale === "zh" ? "。" : "."}` : sentence;
  const unmonitored = by("unmonitored");
  const partial = by("partial");
  const unknownSlices = by("unknown");
  if (unmonitored.length > 0) notices.push({ kind: "unmonitored", text: named(copy("result.unmonitored", locale), unmonitored, { en: "Not monitored: ", zh: "未监测：" }) });
  if (partial.length > 0 || coverage.state === "partial") notices.push({ kind: "partial", text: named(copy("result.partial", locale), partial, { en: "Not checked to the end: ", zh: "未查完：" }) });
  if (unknownSlices.length > 0 || coverage.state === "unknown") notices.push({ kind: "unknown", text: named(copy("result.unknown", locale), unknownSlices, { en: "Not proven: ", zh: "无法证实：" }) });
  const checked = coverage.slices.filter((s) => s.state === "complete");
  if (notices.length === 0 && rowCount === 0) notices.push({ kind: "none", text: copy("result.none", locale) });
  else if (rowCount === 0 && checked.length > 0 && coverage.state !== "unknown") {
    // Some pairs were checked to the end and had nothing; say so for them alone.
    notices.push({ kind: "none", text: `${copy("result.none", locale)}${gap}${locale === "zh" ? "已查完：" : "Checked: "}${pairList(checked, locale)}${locale === "zh" ? "。" : "."}` });
  }
  return notices;
}

/** The first coverage sentence, or null — kept for callers that show one line. */
export function coverageLabel(coverage: CoverageEvidence, rowCount: number, locale: Locale): string | null {
  const [first] = coverageNotices(coverage, rowCount, locale);
  return first ? copy(first.kind === "none" ? "result.none" : `result.${first.kind}`, locale) : null;
}

// ---- the calendar (T08) ------------------------------------------------------------------------------------------

/**
 * Miles short enough for a 47.7 pt day cell, in both languages (U-031): the full number under 1,000; thousands with
 * at most one decimal below 100K ("68.5K"), none from 100K ("111K"); millions with one ("1.3M"). Rounded UP at that
 * precision, so a cell never shows a price lower than the real one, and `exact` says whether it had to round — the
 * cell marks that, and the day's rows and the cell's name carry the exact number.
 */
export function compactMiles(miles: number): { text: string; exact: boolean } {
  if (miles < 1000) return { text: formatMiles(miles), exact: true };
  const [value, digits, unit] = miles < 100_000 ? [miles / 1000, 1, "K"] : miles < 1_000_000 ? [miles / 1000, 0, "K"] : [miles / 1_000_000, 1, "M"];
  const factor = 10 ** digits;
  // Rounded in integer units first, so float noise (68.5 * 10 = 684.9999…) never rounds a whole value up.
  const scaled = Math.round(value * factor * 1e6) / 1e6;
  const up = Math.ceil(scaled) / factor;
  return { text: `${up.toFixed(digits).replace(/\.0$/, "")}${unit}`, exact: up === value };
}

/** "October 2026" / "2026年10月", for a "YYYY-MM" month. */
export function monthLabel(month: string, locale: Locale): string {
  const [year, m] = month.split("-").map(Number) as [number, number];
  if (locale === "zh") return `${year}年${m}月`;
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, m - 1, 1)));
}

const EN_DAYS = [
  ["Sun", "Sunday"],
  ["Mon", "Monday"],
  ["Tue", "Tuesday"],
  ["Wed", "Wednesday"],
  ["Thu", "Thursday"],
  ["Fri", "Friday"],
  ["Sat", "Saturday"],
] as const;
const ZH_DAYS = ["日", "一", "二", "三", "四", "五", "六"] as const;

/** The calendar's columns, as UTC weekday numbers (0 = Sunday) with their heads: Sunday first in English, Monday in Chinese. */
export function weekdayHeads(locale: Locale): Array<{ day: number; short: string; long: string }> {
  const order = locale === "zh" ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
  return order.map((day) => (locale === "zh" ? { day, short: ZH_DAYS[day]!, long: `星期${ZH_DAYS[day]!}` } : { day, short: EN_DAYS[day]![0], long: EN_DAYS[day]![1] }));
}

/** What an empty calendar day is: hidden by the view filter, checked and empty, not monitored, not checked to the end, or unknown. */
export type EmptyDayKind = "hidden" | ProjectedDay["coverage"];

export function emptyDayKind(day: Pick<ProjectedDay, "coverage" | "hidden">): EmptyDayKind {
  return day.hidden > 0 ? "hidden" : day.coverage;
}

export function emptyDayLabel(kind: EmptyDayKind, locale: Locale): string {
  const labels: Record<EmptyDayKind, Record<Locale, string>> = {
    hidden: { en: "hidden by your view filter", zh: "已被视图筛选隐藏" },
    complete: { en: "no matches", zh: "无匹配" },
    unmonitored: { en: "not monitored", zh: "未监测" },
    partial: { en: "not checked to the end", zh: "未查完" },
    unknown: { en: "coverage unknown", zh: "完整性未知" },
  };
  return labels[kind][locale];
}

/**
 * A calendar day's full name: the day, then its minimum and how many options back it — "lowest shown" where the view
 * filter hides some, "lowest retrieved" where the day was not proven complete — or, with no rows, why it is empty.
 */
export function calendarDayName(day: Pick<ProjectedDay, "date" | "rowKeys" | "minMiles" | "coverage" | "hidden">, locale: Locale): string {
  const zh = locale === "zh";
  const head = `${dayLabel(day.date, locale)}${zh ? "：" : ": "}`;
  if (day.minMiles === null) return head + emptyDayLabel(emptyDayKind(day), locale);
  // With rows the view filter hides, the minimum is only the lowest shown; where not proven, the lowest retrieved.
  const lowest =
    day.hidden > 0 ? (zh ? "当前显示最低" : "lowest shown") : day.coverage === "complete" ? (zh ? "最低" : "lowest") : zh ? "已取得最低" : "lowest retrieved";
  const miles = zh ? `${formatMiles(day.minMiles)} 里程` : `${formatMiles(day.minMiles)} miles`;
  return `${head}${lowest} ${miles}${zh ? "，" : ", "}${optionsCount(day.rowKeys.length, locale)}`;
}

