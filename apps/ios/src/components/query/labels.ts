/**
 * Every sentence and label the query editor and the text search show (UI/UX v1 T06; English and Chinese since T11),
 * in one place so apps/ios/src/honesty.test.ts reads them all. Strings with an approved key in the handoff copy
 * (fixtures/copy.zh-en.json, core `present.ts` COPY) come from it by that key, in both languages.
 */
import { copy } from "@awardgrid/core/workspace/present";
import { type DraftErrorCode, type DraftField, MAX_SPAN_DAYS } from "@awardgrid/core/workspace/query-editor";
import { STORE } from "../../app/flags";
import type { Locale } from "../../app/locale";

export interface EditorCopy {
  title: string;
  back: string;
  intro: string;
  origins: string;
  destinations: string;
  addAirport: string;
  addAirportHelp: string;
  noPlaceMatch: string;
  typedCode: (code: string) => string;
  allAirports: (codes: readonly string[]) => string;
  removeAirport: (code: string, name: string) => string;
  dates: string;
  datesHelp: string;
  dateMode: string;
  fixed: string;
  relative: string;
  start: string;
  end: string;
  days: string;
  relativeRange: (from: string, to: string) => string;
  dayCount: (days: number, cap: number) => string;
  quickDays: string;
  nextDays: (days: number) => string;
  cabins: string;
  direct: string;
  mixed: string;
  mixedHelp: string;
  mixedOptions: ReadonlyArray<readonly [number, string]>;
  /** A mixed-cabin share that is not one of the options (from a typed search). */
  mixedOther: (pct: number) => string;
  programs: string;
  programsAll: string;
  programsCount: (n: number) => string;
  programsDone: string;
  programsHelp: string;
  more: string;
  dynamic: string;
  miles: string;
  milesHelp: string;
  submit: string;
  submitNote: string;
  discardTitle: string;
  discardBody: string;
  /** A sheet's close button. */
  close: string;
  discard: string;
  keepEditing: string;
  editSearch: string;
  editWhileRunning: string;
  unchosen: string;
  /** The text search (TextSearch.tsx). */
  text: { label: string; run: string; running: string; examplesLabel: string; examples: readonly string[] };
}

const EN: EditorCopy = {
  title: "Edit search",
  back: "Back",
  // The App Store build has no AI at all (app/flags.ts STORE), so it does not say what it does not use.
  intro: STORE ? "Change the conditions directly." : "Change the conditions directly. No AI is used.",
  origins: "Departure airports",
  destinations: "Arrival airports",
  addAirport: "Add airport",
  addAirportHelp: "Type a city, an airport name or a 3-letter code.",
  noPlaceMatch: "No airport or city matches that.",
  typedCode: (code) => `Use the code ${code}`,
  allAirports: (codes) => `All airports: ${codes.join(", ")}`,
  removeAirport: (code, name) => (name === code ? `Remove ${code}` : `Remove ${code} ${name}`),
  dates: "Departure dates",
  datesHelp: "Calendar dates at the departure airport.",
  dateMode: "Date range",
  fixed: "Fixed dates",
  relative: "Next days",
  start: "Start",
  end: "End",
  days: "Days from today",
  relativeRange: (from, to) => `${from} to ${to}, counted from today.`,
  dayCount: (days, cap) => `${days} ${days === 1 ? "day" : "days"} (up to ${cap}).`,
  quickDays: "Quick picks",
  nextDays: (days) => `Next ${days} days`,
  cabins: "Cabins",
  direct: "Nonstop only",
  mixed: "Mixed cabin",
  mixedHelp: copy("help.mixed", "en"),
  mixedOptions: [
    [100, "Every segment in the chosen cabin"],
    [75, "At least 75% of the distance"],
    [50, "At least 50% of the distance"],
    [0, "Any mix of cabins"],
  ],
  mixedOther: (pct) => `At least ${pct}% of the distance`,
  programs: "Programs",
  programsAll: "All programs",
  programsCount: (n) => `${n} selected`,
  programsDone: "Done",
  programsHelp: copy("help.program", "en"),
  more: "More",
  dynamic: "Include dynamic-priced results",
  miles: "Mileage cap",
  milesHelp: "Leave empty for no limit.",
  submit: copy("query.submit", "en"),
  submitNote: STORE ? "Uses your own seats.aero quota" : "Uses your own seats.aero quota · No AI",
  discardTitle: "Discard your changes?",
  discardBody: "Your edits to this search have not been run.",
  close: "Close",
  discard: copy("query.discard", "en"),
  keepEditing: copy("query.keep_editing", "en"),
  editSearch: "Edit search",
  editWhileRunning: "A search is running. Edit it when it has finished.",
  unchosen: "Choose an airport from the list, or clear this text.",
  text: {
    label: "Search by typing",
    run: "Run",
    running: "Searching",
    examplesLabel: "Examples",
    examples: ["HKG, SHA to SEA, next 30 days, business and first", "SFO to NRT next 60 days business", "LHR to JFK, next 2 weeks, first"],
  },
};

const ZH: EditorCopy = {
  title: "编辑查询",
  back: "返回",
  intro: STORE ? "直接修改查询条件。" : "直接修改查询条件，不使用 AI。",
  origins: "出发机场",
  destinations: "到达机场",
  addAirport: "添加机场",
  addAirportHelp: "输入城市、机场名称或三字代码。",
  noPlaceMatch: "没有匹配的机场或城市。",
  typedCode: (code) => `使用代码 ${code}`,
  allAirports: (codes) => `全部机场：${codes.join("、")}`,
  removeAirport: (code, name) => (name === code ? `移除 ${code}` : `移除 ${code} ${name}`),
  dates: "出发日期",
  datesHelp: "出发机场当地的日历日期。",
  dateMode: "日期范围",
  fixed: "固定日期",
  relative: "未来天数",
  start: "开始",
  end: "结束",
  days: "从今天起的天数",
  relativeRange: (from, to) => `${from} 至 ${to}，从今天起算。`,
  dayCount: (days, cap) => `共 ${days} 天（最多 ${cap} 天）。`,
  quickDays: "快速选择",
  nextDays: (days) => `未来 ${days} 天`,
  cabins: "舱位",
  direct: "仅直飞",
  mixed: "混合舱位",
  mixedHelp: copy("help.mixed", "zh"),
  mixedOptions: [
    [100, "每一段都是所选舱位"],
    [75, "至少 75% 航程为所选舱位"],
    [50, "至少 50% 航程为所选舱位"],
    [0, "任意舱位组合"],
  ],
  mixedOther: (pct) => `至少 ${pct}% 航程为所选舱位`,
  programs: "兑换计划",
  programsAll: "全部计划",
  programsCount: (n) => `已选 ${n} 个`,
  programsDone: "完成",
  programsHelp: copy("help.program", "zh"),
  more: "更多",
  dynamic: "包含动态定价结果",
  miles: "里程上限",
  milesHelp: "留空表示不限。",
  submit: copy("query.submit", "zh"),
  submitNote: STORE ? "使用你自己的 seats.aero 额度" : "使用你自己的 seats.aero 额度 · 不使用 AI",
  discardTitle: "放弃修改？",
  discardBody: "你对这次查询的修改还没有执行。",
  close: "关闭",
  discard: copy("query.discard", "zh"),
  keepEditing: copy("query.keep_editing", "zh"),
  editSearch: "编辑查询",
  editWhileRunning: "查询进行中，完成后再编辑。",
  unchosen: "请从列表中选择机场，或清除这段文字。",
  text: {
    label: "输入文字查询",
    run: "查询",
    running: "查询中",
    examplesLabel: "示例",
    examples: ["香港、上海到西雅图 未来30天 商务舱", "旧金山到东京 未来60天 商务舱", "伦敦到纽约，未来两周，头等舱"],
  },
};

export const EDITOR_COPY: Record<Locale, EditorCopy> = { en: EN, zh: ZH };

/** The English copy, by the name the editor's tests and honesty.test.ts have always read. */
export const EDITOR = EN;

const FIELD_ERRORS: Record<Locale, { fields: Record<DraftField, Partial<Record<DraftErrorCode, string>>>; fallback: string }> = {
  en: {
    fields: {
      origins: { required: "Add at least one departure airport.", unchosen_text: EN.unchosen },
      destinations: {
        required: "Add at least one arrival airport.",
        unchosen_text: EN.unchosen,
        same_as_origin: "An airport cannot be both a departure and an arrival.",
      },
      dates: {
        invalid_calendar_date: "Enter a real calendar date.",
        end_before_start: "The end date is before the start date.",
        span_exceeds_core_limit: `The range is longer than ${MAX_SPAN_DAYS} days. Shorten it or split the search.`,
        invalid_relative_days: `Enter a number of days from 1 to ${MAX_SPAN_DAYS}.`,
        ends_in_past: "These dates have already passed.",
      },
      cabins: { required: "Choose at least one cabin." },
      max_miles: { invalid_miles: "Enter a whole number of miles above 0, or leave it empty." },
    },
    fallback: "Check this field.",
  },
  zh: {
    fields: {
      origins: { required: "请至少添加一个出发机场。", unchosen_text: ZH.unchosen },
      destinations: {
        required: "请至少添加一个到达机场。",
        unchosen_text: ZH.unchosen,
        same_as_origin: "同一机场不能既是出发机场又是到达机场。",
      },
      dates: {
        invalid_calendar_date: "请输入真实存在的日期。",
        end_before_start: "结束日期早于开始日期。",
        span_exceeds_core_limit: `日期范围超过 ${MAX_SPAN_DAYS} 天，请缩短或拆分查询。`,
        invalid_relative_days: `请输入 1 到 ${MAX_SPAN_DAYS} 之间的天数。`,
        ends_in_past: "这些日期已经过去。",
      },
      cabins: { required: "请至少选择一个舱位。" },
      max_miles: { invalid_miles: "请输入大于 0 的整数里程，或留空。" },
    },
    fallback: "请检查此项。",
  },
};

export function fieldErrorText(field: DraftField, code: DraftErrorCode, locale: Locale = "en"): string {
  const table = FIELD_ERRORS[locale];
  return table.fields[field][code] ?? table.fallback;
}

/** Every error sentence, for the locale parity test. */
export function allFieldErrors(locale: Locale): Array<{ field: string; code: string; text: string }> {
  return Object.entries(FIELD_ERRORS[locale].fields).flatMap(([field, codes]) => Object.entries(codes).map(([code, text]) => ({ field, code, text: String(text) })));
}
