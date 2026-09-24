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
  calendar: string;
  matrix: string;
  /** The sort control's name; the options are core's sortLabel. */
  sort: string;
  /** T08: rows the local view filter hides — said, never "no results". */
  hiddenByFilter: (n: number) => string;
  showAll: string;
  showingAll: (n: number) => string;
  /** What a matrix number is: the lowest miles, and miles are not equal across programs. */
  matrixCaption: string;
  matrixDate: string;
  /** Keyboard hint, shown only with a fine pointer. */
  matrixKeys: string;
  /** The opened cell's heading over its options. */
  cellHeading: (day: string, route: string, n: number) => string;
  /** Other selected options in a matrix slot than the one it shows. */
  othersSelected: (n: number) => string;
  /** Dynamically priced options the query leaves out (T09 review): said, not silently dropped. */
  dynamicNotShown: (n: number) => string;
  /** T10: the card's way into the option's details; named in full. */
  viewOption: string;
  viewOptionName: (name: string) => string;
  detail: {
    title: string;
    back: string;
    notInResults: string;
    via: (program: string) => string;
    loading: string;
    itineraries: string;
    itinerary: (n: number) => string;
    carrierFlight: string;
    seats: string;
    fees: string;
    cabin: string;
    times: string;
    localTimes: string;
    segments: string;
    mixedCabin: (pct: number) => string;
    miles: string;
    notProvided: string;
    noItineraries: string;
    loadedOnDevice: (time: string) => string;
    dataHeading: string;
    openProgram: string;
    copied: string;
    copyFailed: string;
  };
  /** Fee groups under the fee sort: fees never compare across currencies. */
  feeGroup: (currency: string) => string;
  calendarCabin: string;
  /** "Lowest miles by date · Business J": what the numbers are, and for which cabin. */
  calendarCaption: (cabin: string) => string;
  previousMonth: string;
  nextMonth: string;
  /** Legend for a day whose compact number was rounded up. */
  roundedUp: string;
  pickDay: string;
  /** The chosen day's heading over its options. */
  dayHeading: (day: string, cabin: string, n: number) => string;
  /** Days of the range with no options for this cabin, and what the search proved for them. */
  otherDays: (n: number, kind: "hidden" | "complete" | "unmonitored" | "partial" | "unknown") => string;

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
    calendar: "Calendar",
    matrix: "Matrix",
    sort: "Sort",
    hiddenByFilter: (n) => `${n} ${n === 1 ? "option is" : "options are"} hidden by your view filter.`,
    showAll: "Show all",
    showingAll: (n) => `Showing all ${n} ${n === 1 ? "option" : "options"}.`,
    matrixCaption: "Each cell shows its lowest miles; miles in different programs are not equivalent.",
    matrixDate: "Date",
    matrixKeys: "Arrow keys move · Enter opens · Esc returns",
    cellHeading: (day, route, n) => `${day} · ${route} · ${n} ${n === 1 ? "option" : "options"}`,
    othersSelected: (n) => `${n} other selected`,
    viewOption: "View option",
    viewOptionName: (name) => `View option: ${name}`,
    detail: {
      title: "Option details",
      back: "Return to results",
      notInResults: "This option is not in your results.",
      via: (program) => `Redeemed through ${program}`,
      loading: "Loading flight itineraries",
      itineraries: "Flight itineraries",
      itinerary: (n) => `Itinerary ${n}`,
      carrierFlight: "Carrier and flight",
      seats: "Seats",
      fees: "Taxes and fees",
      cabin: "Cabin",
      times: "Times",
      localTimes: "Local time at each airport",
      segments: "Segments",
      // seats.aero's MixedCabinPct: the share of the distance flown BELOW the reported cabin.
      mixedCabin: (pct) => `Mixed cabin: ${pct}% of the distance below this cabin`,
      miles: "Miles",
      notProvided: "Not provided",
      noItineraries: "seats.aero returned no itineraries in this cabin for this option.",
      loadedOnDevice: (time) => `Loaded on this device ${time}`,
      dataHeading: "Data and checks",
      openProgram: "Program website",
      copied: "Copied.",
      copyFailed: "Could not copy. Select the text above instead.",
    },
    dynamicNotShown: (n) => `${n} dynamically priced ${n === 1 ? "option is" : "options are"} not shown: this search leaves dynamic pricing out (More filters).`,
    feeGroup: (currency) => `Fees in ${currency}`,
    calendarCabin: "Calendar cabin",
    calendarCaption: (cabin) => `Lowest miles by date · ${cabin}`,
    previousMonth: "Previous month",
    nextMonth: "Next month",
    roundedUp: "rounded up; choose the day for exact miles",
    pickDay: "Choose a day to see the options behind its number.",
    dayHeading: (day, cabin, n) => `${day} · ${cabin} · ${n} ${n === 1 ? "option" : "options"}`,
    otherDays: (n, kind) =>
      `${n} other ${n === 1 ? "day" : "days"}: ${
        {
          hidden: "options hidden by your view filter",
          complete: "no matches in the checked range",
          unmonitored: "not monitored by the data source",
          partial: "nothing retrieved, and not checked to the end",
          unknown: "nothing retrieved; coverage unknown",
        }[kind]
      }.`,

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
    calendar: "日历",
    matrix: "矩阵",
    sort: "排序",
    hiddenByFilter: (n) => `${n} 个选项被视图筛选隐藏。`,
    showAll: "显示全部",
    showingAll: (n) => `正在显示全部 ${n} 个选项。`,
    matrixCaption: "每格显示最低里程数；不同计划的里程不等值。",
    matrixDate: "出发日期",
    matrixKeys: "方向键移动 · Enter 查看 · Esc 返回",
    cellHeading: (day, route, n) => `${day} · ${route} · ${n} 个选项`,
    othersSelected: (n) => `另有 ${n} 个已选`,
    viewOption: "查看选项",
    viewOptionName: (name) => `查看选项：${name}`,
    detail: {
      title: "兑换详情",
      back: "返回结果",
      notInResults: "该选项不在当前结果中。",
      via: (program) => `通过 ${program} 兑换`,
      loading: "正在载入具体航班",
      itineraries: "具体航班",
      itinerary: (n) => `行程 ${n}`,
      carrierFlight: "承运与航班号",
      seats: "可用席位",
      fees: "税费",
      cabin: "舱位",
      times: "起降时间",
      localTimes: "各机场当地时间",
      segments: "航段",
      mixedCabin: (pct) => `混合舱位：${pct}% 航程低于此舱位`,
      miles: "里程",
      notProvided: "未提供",
      noItineraries: "seats.aero 未返回该选项在此舱位的具体行程。",
      loadedOnDevice: (time) => `本机载入：${time}`,
      dataHeading: "数据与核验",
      openProgram: "前往兑换网站",
      copied: "已复制。",
      copyFailed: "无法复制，请手动选择上方文字。",
    },
    dynamicNotShown: (n) => `有 ${n} 个动态定价选项未显示：本次查询不含动态定价（更多筛选）。`,
    feeGroup: (currency) => `税费（${currency}）`,
    calendarCabin: "日历舱位",
    calendarCaption: (cabin) => `各日期最低里程 · ${cabin}`,
    previousMonth: "上个月",
    nextMonth: "下个月",
    roundedUp: "已向上取整，选择日期查看精确里程",
    pickDay: "选择日期，查看该数字对应的选项。",
    dayHeading: (day, cabin, n) => `${day} · ${cabin} · ${n} 个选项`,
    otherDays: (n, kind) =>
      `其余 ${n} 天：${
        {
          hidden: "选项已被视图筛选隐藏",
          complete: "已查询的范围内没有匹配结果",
          unmonitored: "数据源未监测",
          partial: "未取得结果，且未查完",
          unknown: "未取得结果，完整性未知",
        }[kind]
      }。`,

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
