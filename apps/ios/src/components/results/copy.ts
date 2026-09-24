/**
 * The results screen's own words, in English and Chinese (UI/UX v1 T07). Sentences about the data itself (fees,
 * seats, source time, coverage, run state) are core's (`@awardgrid/core/workspace/present`, from the approved copy);
 * this file holds the screen's labels. apps/ios/src/honesty.test.ts reads it.
 */
import type { Locale } from "../../app/locale";

export interface ResultsCopy {
  title: string;
  /** copy key ai.entry */
  ai: string;
  aiWorking: string;
  tabs: { search: string; watches: string; settings: string };
  tabsLabel: string;
  unseen: (n: number) => string;
  searching: string;
  selected: string;
  editSearch: string;
  editWhileRunning: string;
  programs: (n: number) => string;
  stopsAny: string;
  stopsNonstop: string;
  moreFilters: (n: number) => string;
  view: string;
  list: string;
  matrix: string;

  milesUnit: string;
  select: (what: string) => string;
  saved: (age: string) => string;
  savedNoAge: string;
  fromCache: (age: string | null) => string;
  calls: (n: number) => string;
  callsUnknown: string;
  emptyIntro: string;
  newSearch: string;
  searchAgain: string;
  watch: string;
  /** The link to Ask with this search as context. English: Ask's own label (ask/labels.ts ASK_ABOUT_SEARCH). */
  askAbout: string | null;
  watchNeedsText: string;
  watching: string;
  alreadyWatching: string;
  watchLimit: string;
  noKey: { before: string; settings: string; after: string };
  runFailed: Record<"no_key" | "quota" | "network" | "seatsaero" | "invalid_query" | "other", string>;
  quota: (used: number, limit: number) => string;
}

export const RESULTS: Record<Locale, ResultsCopy> = {
  en: {
    title: "Search",
    ai: "AI assistance",
    aiWorking: "AI assistance (working)",
    tabs: { search: "Search", watches: "Watches", settings: "Settings" },
    tabsLabel: "Main navigation",
    unseen: (n) => `${n} unseen ${n === 1 ? "change" : "changes"}`,
    searching: "Searching",
    selected: "Selected",
    editSearch: "Edit search",
    editWhileRunning: "A search is running. Edit it when it has finished.",
    programs: (n) => (n === 0 ? "Programs" : `Programs · ${n}`),
    stopsAny: "Any stops",
    stopsNonstop: "Nonstop",
    moreFilters: (n) => (n === 0 ? "More" : `More · ${n}`),
    view: "Result view",
    list: "List",
    matrix: "Matrix",

    milesUnit: "miles",
    select: (what) => `Select ${what}`,
    saved: (age) => `saved on this device ${age}`,
    savedNoAge: "saved on this device",
    fromCache: (age) => (age ? `from this device's cache, fetched ${age}` : "from this device's cache"),
    calls: (n) => `${n} seats.aero ${n === 1 ? "call" : "calls"}`,
    callsUnknown: "seats.aero calls not known",
    emptyIntro: "Type a search, or build it field by field.",
    newSearch: "Build a search",
    searchAgain: "Search again",
    watch: "Watch this search",
    askAbout: null,
    watchNeedsText: "A watch keeps a search as its text, and this search has conditions its text cannot hold, so it cannot be watched yet.",
    watching: "Watching this search. It is checked when you open the app.",
    alreadyWatching: "You are already watching this search.",
    watchLimit: "You have reached the limit of 20 watches.",
    noKey: { before: "No seats.aero key yet. Add your own Pro key in ", settings: "Settings", after: " — awardgrid has no key of its own and never will." },
    runFailed: {
      no_key: "Add your seats.aero Pro API key in Settings.",
      quota: "Not enough seats.aero calls are left today for this search. It was not sent.",
      network: "seats.aero did not answer in time. The request may still have used a call.",
      seatsaero: "seats.aero returned an error for this search.",
      invalid_query: "This search's conditions are not valid, so it was not sent.",
      other: "The search could not be completed.",
    },
    quota: (used, limit) => `seats.aero calls today: ${used} of ${limit}`,
  },
  zh: {
    title: "查票",
    ai: "AI辅助",
    aiWorking: "AI辅助（进行中）",
    tabs: { search: "查票", watches: "关注", settings: "设置" },
    tabsLabel: "主导航",
    unseen: (n) => `${n} 项未看变化`,
    searching: "查询中",
    selected: "已选",
    editSearch: "修改搜索",
    editWhileRunning: "正在查询，完成后再修改。",
    programs: (n) => (n === 0 ? "计划" : `计划 · ${n}`),
    stopsAny: "经停不限",
    stopsNonstop: "仅直飞",
    moreFilters: (n) => (n === 0 ? "更多筛选" : `更多筛选 · ${n}`),
    view: "结果视图",
    list: "列表",
    matrix: "矩阵",

    milesUnit: "里程",
    select: (what) => `选择 ${what}`,
    saved: (age) => `本机保存于 ${age}`,
    savedNoAge: "本机保存",
    fromCache: (age) => (age ? `来自本机缓存，获取于 ${age}` : "来自本机缓存"),
    calls: (n) => `seats.aero 调用 ${n} 次`,
    callsUnknown: "seats.aero 调用次数未知",
    emptyIntro: "输入一句话查票，或逐项设置条件。",
    newSearch: "设置查询条件",
    searchAgain: "重新查询",
    watch: "关注此查询",
    askAbout: "就此查询问 AI",
    watchNeedsText: "关注以文字保存查询，而此查询含有文字无法表达的条件，暂时不能关注。",
    watching: "已关注此查询。打开本应用时检查。",
    alreadyWatching: "你已关注此查询。",
    watchLimit: "关注数量已达上限 20 个。",
    noKey: { before: "尚未添加 seats.aero 密钥。请在", settings: "设置", after: "中添加你自己的 Pro 密钥——awardgrid 没有也不会有自己的密钥。" },
    runFailed: {
      no_key: "请在设置中添加你的 seats.aero Pro API 密钥。",
      quota: "今日剩余的 seats.aero 调用不足以完成此查询，未发送。",
      network: "seats.aero 未在时限内响应，该请求可能已计入调用。",
      seatsaero: "seats.aero 对此查询返回了错误。",
      invalid_query: "此查询条件无效，未发送。",
      other: "查询未能完成。",
    },
    quota: (used, limit) => `今日 seats.aero 调用：${used} / ${limit}`,
  },
};
