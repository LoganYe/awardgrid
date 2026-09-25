/**
 * The comparison's words, in English and Chinese (UI/UX v1 T12; docs/04 S05). The title and the limit are approved
 * rows (core present.ts COPY "compare.title", "compare.limit"); these are the rest. Nothing here ranks, scores or
 * totals options: miles from different programs are not worth the same (spec §13).
 */
import type { CompareField } from "@awardgrid/core/workspace/selection";
import type { Locale } from "../app/locale";

export interface CompareCopy {
  count: (n: number, max: number) => string;
  back: string;
  close: string;
  fields: Record<CompareField, string>;
  /** The picker that chooses what a column shows, on a phone with more options than columns. */
  column: (i: number) => string;
  readOneByOne: string;
  sideBySide: string;
  remove: string;
  removeName: (name: string) => string;
  /** "Option 1": the order chosen, which also tells apart options that otherwise read the same. */
  option: (n: number) => string;
  /** Which search an option came from, when the options come from more than one. */
  searchOf: (when: string) => string;
  notLoaded: string;
  loaded: (n: number, when: string) => string;
  cannotLoad: string;
  removed: (n: number, max: number) => string;
  currencyMissing: (n: number) => string;
  noLink: string;
  openProgram: string;
  keptCopy: string;
  missing: string;
  needTwo: string;
  noRanking: string;
  currencies: (list: string) => string;
  unknownFees: (n: number) => string;
  nothingSent: string;
  tray: { label: string; selected: (n: number, max: number) => string; clear: string };
}

export const COMPARE: Record<Locale, CompareCopy> = {
  en: {
    count: (n, max) => `${n} of ${max}`,
    back: "Back to results",
    close: "Close",
    fields: {
      route_date: "Route and date",
      cabin: "Cabin",
      program: "Program",
      miles: "Miles",
      fees: "Fees",
      itineraries: "Itineraries",
      seats: "Seats",
      source_time: "Source time",
      link: "Program website",
    },
    column: (i) => `Column ${i} shows`,
    readOneByOne: "Read one by one",
    sideBySide: "Side by side",
    remove: "Remove",
    removeName: (name) => `Remove from comparison: ${name}`,
    option: (n) => `Option ${n}`,
    searchOf: (when) => `From the search of ${when}`,
    notLoaded: "Not loaded. Open the option to load its itineraries.",
    loaded: (n, when) => `${n} ${n === 1 ? "itinerary" : "itineraries"} loaded on this device ${when}`,
    cannotLoad: "Its search is no longer on this device, so its itineraries cannot be loaded from here.",
    removed: (n, max) => `Removed. ${n} of ${max} chosen.`,
    currencyMissing: (n) => `${n} ${n === 1 ? "fee has" : "fees have"} an amount but no currency; not comparable.`,
    noLink: "No program link",
    openProgram: "Program website",
    keptCopy: "Its search is no longer kept on this device; shown as it was when chosen.",
    missing: "This option is no longer on this device.",
    needTwo: "Choose at least two options to compare.",
    noRanking: "Miles from different programs are not worth the same, so options are not ranked or scored.",
    currencies: (list) => `Fees are in ${list} and are not converted.`,
    unknownFees: (n) => `Fees are not confirmed for ${n} ${n === 1 ? "option" : "options"}.`,
    nothingSent: "Comparing sends nothing: every figure is from the searches on this device.",
    tray: { label: "Chosen for comparison", selected: (n, max) => `${n} of ${max} chosen`, clear: "Clear" },
  },
  zh: {
    count: (n, max) => `${n}/${max} 项`,
    back: "返回结果",
    close: "关闭",
    fields: {
      route_date: "航线与日期",
      cabin: "舱位",
      program: "兑换计划",
      miles: "里程",
      fees: "税费",
      itineraries: "具体行程",
      seats: "席位",
      source_time: "来源时间",
      link: "兑换网站",
    },
    column: (i) => `第 ${i} 列显示`,
    readOneByOne: "逐项阅读",
    sideBySide: "并排比较",
    remove: "移除",
    removeName: (name) => `从比较中移除：${name}`,
    option: (n) => `选项 ${n}`,
    searchOf: (when) => `来自 ${when} 的查询`,
    notLoaded: "未载入。打开该选项可载入具体行程。",
    loaded: (n, when) => `本机已载入 ${n} 个行程（${when}）`,
    cannotLoad: "其查询已不在本机，无法从这里载入具体行程。",
    removed: (n, max) => `已移除。已选 ${n}/${max}。`,
    currencyMissing: (n) => `有 ${n} 个税费只有金额、没有币种，无法比较。`,
    noLink: "没有兑换网站链接",
    openProgram: "前往兑换网站",
    keptCopy: "其查询已不在本机保留，按选择时的内容显示。",
    missing: "此选项已不在本机。",
    needTwo: "至少选择两个选项才能比较。",
    noRanking: "不同计划的里程价值不同，因此不对选项排序或评分。",
    currencies: (list) => `税费币种为 ${list}，不做换算。`,
    unknownFees: (n) => `有 ${n} 个选项的税费待确认。`,
    nothingSent: "比较不会发送任何请求：所有数字都来自本机的查询结果。",
    tray: { label: "已选择比较", selected: (n, max) => `已选 ${n}/${max}`, clear: "清除" },
  },
};
