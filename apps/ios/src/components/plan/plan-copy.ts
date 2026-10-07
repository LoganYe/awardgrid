/**
 * The trip planner's words, in English and Chinese (release plan step 18): the Search screen's planner while no data
 * source is connected, the plan it shows, and the plans kept in Saved. locale-parity.test.ts holds both languages to the
 * same keys; store-copy.test.ts reads every sentence here, since the App Store build shows them.
 *
 * In Chinese a plan is 规划 (行程规划): 计划 already names a mileage program on these screens (会员计划, "1 个计划").
 *
 * The parser's own notices are said here too (`planNoticeText`): the deterministic parser's, in the words core's
 * dictionaries give them (packages/core/src/lib/i18n/dictionaries, `notice.parse.*`), so a Chinese screen does not show
 * an English sentence about the text it just read. plan-copy.test.ts holds the Chinese to core's.
 */
import { type Notice, noticeText } from "@awardgrid/core/notices";
import type { Locale } from "../../app/locale";

export interface PlanCopy {
  /** The planner's heading on the Search screen. */
  section: string;
  intro: string;
  /** The text box's label, its button, and what the button says while it reads. */
  label: string;
  run: string;
  running: string;
  /** The plan the text was read as, before it is saved. */
  title: string;
  /** What was typed, before the text itself. */
  typed: string;
  readNote: string;
  from: string;
  to: string;
  dates: string;
  cabins: string;
  /** The conditions beyond airports, dates and cabins: nonstop, programs, a mileage cap. */
  also: string;
  dayCount: (days: number) => string;
  nonstop: string;
  programs: (names: string) => string;
  maxMiles: (miles: string) => string;
  pastAll: string;
  pastSome: string;
  /** Why a plan whose dates have all passed cannot be searched or tried. */
  pastBlocked: string;
  save: string;
  saving: string;
  saved: string;
  alreadySaved: string;
  full: (max: number) => string;
  readOnly: string;
  writeFailed: (message: string) => string;
  /** The accessible names of a plan's actions, with the plan's route and dates after them. */
  tryName: (plan: string) => string;
  search: string;
  searchName: (plan: string) => string;
  removeName: (plan: string) => string;
  /** An undo that can no longer bring the plan back (it was saved again since). */
  gone: string;
  /** What a plan's action does, said once above the plans: through the account, on sample data, or by trying it. */
  searchNote: string;
  tryNote: string;
  /** Saved › Trip plans. */
  plansTitle: string;
  plansIntro: string;
  usage: (count: number, max: number) => string;
  unreadable: (n: number) => string;
}

export const PLAN: Record<Locale, PlanCopy> = {
  en: {
    section: "Plan a trip",
    intro: "Type a trip to see how AwardGrid reads it: airports, dates and cabins. Nothing is sent, and no account is needed.",
    label: "Describe a trip",
    run: "Show plan",
    running: "Reading",
    title: "Your plan",
    typed: "You typed",
    readNote: "Read on this device. Nothing was sent.",
    from: "From",
    to: "To",
    dates: "Dates",
    cabins: "Cabins",
    also: "Also",
    dayCount: (days) => `${days} ${days === 1 ? "day" : "days"}`,
    nonstop: "Nonstop",
    programs: (names) => `Programs: ${names}`,
    maxMiles: (miles) => `Up to ${miles} miles`,
    pastAll: "These dates have passed.",
    pastSome: "Some of these dates have passed.",
    pastBlocked: "Only a plan with dates still ahead can be searched.",
    save: "Save plan",
    saving: "Saving",
    saved: "Plan saved on this device.",
    alreadySaved: "This plan is already saved.",
    full: (max) => `You can keep up to ${max} plans. Delete one in Saved before saving another.`,
    readOnly: "Saved plans from a newer version of the app, or ones that could not be read, are left as they are. No plan can be saved until the app can read them.",
    writeFailed: (message) => `Could not save the plan on this device; nothing already saved was changed: ${message}`,
    tryName: (plan) => `Try with sample data: ${plan}`,
    search: "Search",
    searchName: (plan) => `Search: ${plan}`,
    removeName: (plan) => `Delete plan: ${plan}`,
    gone: "This plan is no longer on this device.",
    searchNote: "Search sends requests to seats.aero through your seats.aero account, and they count toward today's calls.",
    tryNote: "Try with sample data opens the sample data on this device and searches the plan there. Nothing is sent.",
    plansTitle: "Trip plans",
    plansIntro: "Searches not run yet, as AwardGrid read them. Saved on this device only.",
    usage: (count, max) => `${count} of ${max} plans`,
    unreadable: (n) => `${n} saved ${n === 1 ? "plan" : "plans"} could not be read by this version of the app; ${n === 1 ? "it is" : "they are"} kept as ${n === 1 ? "it is" : "they are"}.`,
  },
  zh: {
    section: "规划行程",
    intro: "输入一段行程，看看 AwardGrid 如何理解：机场、日期和舱位。不会发送任何内容，也不需要账户。",
    label: "描述行程",
    run: "查看规划",
    running: "正在识别",
    title: "你的规划",
    typed: "你输入的",
    readNote: "已在本机识别，未发送任何内容。",
    from: "出发",
    to: "到达",
    dates: "日期",
    cabins: "舱位",
    also: "其他条件",
    dayCount: (days) => `${days} 天`,
    nonstop: "直飞",
    programs: (names) => `会员计划：${names}`,
    maxMiles: (miles) => `最多 ${miles} 里程`,
    pastAll: "这些日期已经过去。",
    pastSome: "其中部分日期已经过去。",
    pastBlocked: "只有日期尚未过去的规划才能查询。",
    save: "保存规划",
    saving: "正在保存",
    saved: "规划已保存在本机。",
    alreadySaved: "这个规划已经保存过了。",
    full: (max) => `最多可保存 ${max} 个规划。请先在收藏中删除一个，再保存新的。`,
    readOnly: "来自新版本或无法读取的已存规划会原样保留。在本应用能读取它们之前，无法保存新的规划。",
    writeFailed: (message) => `无法在本机保存规划，已保存的内容没有改变：${message}`,
    tryName: (plan) => `试用示例数据：${plan}`,
    search: "查询",
    searchName: (plan) => `查询：${plan}`,
    removeName: (plan) => `删除规划：${plan}`,
    gone: "这个规划已不在本机。",
    searchNote: "查询会通过你的 seats.aero 账户向 seats.aero 发送请求，并计入今天的调用次数。",
    tryNote: "试用示例数据会打开本机的示例数据，并在其中查询这个规划。不会发送任何内容。",
    plansTitle: "行程规划",
    plansIntro: "尚未查询的行程，按 AwardGrid 的理解保存。仅保存在本机。",
    usage: (count, max) => `已保存 ${count}/${max} 个规划`,
    unreadable: (n) => `有 ${n} 个已存规划无法被此版本读取，已原样保留。`,
  },
};

/** The fields a text did not name, as the parser lists them, in Chinese (core dictionary `grid.missing.*`). */
const MISSING_ZH: Record<string, string> = {
  origins: "出发机场",
  destinations: "到达机场",
  date_from: "开始日期",
  date_to: "结束日期",
};

/**
 * The deterministic parser's notices in Chinese, as core's dictionary has them (`notice.parse.*`). The parser's other
 * notices come only from a language model, which the planner never calls; they would be said in English.
 */
export const PARSE_NOTICES_ZH: Partial<Record<Notice["code"], string>> = {
  "parse.end_before_start": "结束日期 {date_to} 早于开始日期 {date_from}。按单日搜索。",
  "parse.range_truncated": "日期范围已缩短为 {days} 天（{date_from} 至 {date_to}）。更长的范围请分多次搜索。",
  "parse.start_in_past": "开始日期 {date_from} 早于今天（{today}）。",
  "parse.start_far_out": "开始日期 {date_from} 在一年以后。各里程计划通常还没有开放这么远的日期。",
  "parse.range_end_first": "日期范围写反了（{from} 至 {to}）。按 {date_from} 至 {date_to} 搜索。",
  "parse.empty": "请先输入查询。",
  "parse.missing": "无法从“{text}”中识别{fields}。请写明城市（如 香港到西雅图 或 HKG to SEA）和日期范围（如 未来一个月 或 next month）。",
  "parse.invalid": "解析出的查询不完整或无效（{issues}）。",
};

/**
 * A parser notice in the screen's language, and the language it is in when it is not the screen's (a notice with no
 * Chinese here stays English, marked so). `missing` is the fields a failed parse names, which the Chinese sentence
 * lists in Chinese.
 */
export function planNoticeText(notice: Notice, locale: Locale, missing: readonly string[] = []): { text: string; lang?: "en" } {
  if (locale === "en") return { text: noticeText(notice) };
  const template = PARSE_NOTICES_ZH[notice.code];
  if (!template) return { text: noticeText(notice), lang: "en" };
  const vars: Record<string, string | number> = { ...(notice.vars ?? {}) };
  if (notice.code === "parse.missing") {
    const fields = [...new Set(missing.map((m) => MISSING_ZH[m]).filter((f): f is string => Boolean(f)))];
    if (fields.length > 0) vars.fields = fields.join("、");
    else return { text: noticeText(notice), lang: "en" };
  }
  return { text: template.replace(/\{(\w+)\}/g, (match, name: string) => (vars[name] === undefined ? match : String(vars[name]))) };
}
