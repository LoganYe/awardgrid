/**
 * The Watches screen's words, in English and Chinese (UI/UX v1 T11). The English is the screen's own, moved here
 * unchanged; the Chinese keeps the same rule (docs/PIVOT.md §3): when a watch was last checked, never when it will be,
 * and no background check claimed. `honesty.test.ts` scans both.
 */
import { OAUTH } from "../app/flags";
import type { Locale } from "../app/locale";

export interface WatchesCopy {
  eyebrow: string;
  title: string;
  onOpen: string;
  noBackground: string;
  skipSoon: string;
  empty: { before: string; action: string; after: string };
  justNow: string;
  ago: (value: number, unit: "minute" | "hour" | "day") => string;
  paused: string;
  failed: (ago: string, message: string) => string;
  unknownError: string;
  notChecked: string;
  baseline: (ago: string) => string;
  lastChecked: (ago: string) => string;
  unseen: (counts: { new: number; dropped: number; cheaper: number }) => string;
  skipNoKey: string;
  /** After the approved "Deferred due to low quota" (core COPY watch.quota), joined in the screen's punctuation. */
  skipQuota: (approved: string) => string;
  pause: string;
  resume: string;
  stop: string;
  confirmStop: (name: string) => string;
  confirmStopBody: string;
  keepWatching: string;
  close: string;
  /** T14 */
  watching: string;
  edit: string;
  editName: (name: string) => string;
  reviewDates: string;
  reviewUnparsed: string;
  changesTitle: string;
  changeNew: (what: string, miles: string) => string;
  changeGone: (what: string, miles: string) => string;
  changeCheaper: (what: string, before: string, after: string) => string;
  moreChanges: (n: number) => string;
  comparedOver: (range: string) => string;
  notCompared: string;
  skipCached: (ago: string) => string;
  skipDatesPassed: string;
  refused: string;
  failedWith: (ago: string, message: string) => string;
  /** T14 review: a refused key before any baseline; conditions that cannot be run; Stop's name; leaving an edit. */
  refusedNoBaseline: string;
  unresolved: string;
  stopName: (name: string) => string;
  discardWatch: string;
  /** T14: the watches file is kept, never written over. */
  heldNewer: string;
  heldUnreadable: string;
  keptAside: (file: string) => string;
  carried: (n: number) => string;
  editTitle: string;
  saveWatch: string;
  saveWatchNote: string;
  savedWatch: string;
  byText: (text: string) => string;
}

export const WATCHES: Record<Locale, WatchesCopy> = {
  en: {
    eyebrow: "Watches",
    title: "Searches you are watching",
    onOpen: "Each watch is checked when you open the app, and at no other time.",
    noBackground: "There is no background check, so a change is found the next time you open the app, not when it happens.",
    skipSoon:
      "A check sooner than 45 minutes after the previous one is skipped: seats.aero's cached data could not be any newer, and skipping keeps your daily calls for your own searches.",
    empty: { before: "You are not watching any searches yet. Run a search, then choose ", action: "Watch this search", after: "." },
    justNow: "just now",
    ago: (value, unit) => `${value} ${unit === "minute" ? "min" : unit === "hour" ? "h" : "d"} ago`,
    paused: "Paused. It is not checked until you resume it.",
    failed: (ago, message) => `Last attempt failed ${ago}: ${message}`,
    unknownError: "unknown error",
    notChecked: "Not checked yet.",
    baseline: (ago) => `Baseline saved ${ago}. Later checks report what changes.`,
    lastChecked: (ago) => `Last checked ${ago}`,
    unseen: (u) =>
      `${[u.new ? `${u.new} new` : null, u.dropped ? `${u.dropped} gone` : null, u.cheaper ? `${u.cheaper} cheaper` : null].filter(Boolean).join(", ")} since you last looked`,
    skipNoKey: "Not checked: connect your seats.aero account in Settings.",
    skipQuota: (approved) => `${approved}. Not checked: fewer than 25 seats.aero calls are left today, and those are kept for your own searches.`,
    pause: "Pause",
    resume: "Resume",
    stop: "Stop watching",
    confirmStop: (name) => `Stop watching "${name}"?`,
    confirmStopBody: "The watch and what it last found are removed from this device. Your searches and results are not affected.",
    keepWatching: "Keep this watch",
    close: "Close",
    watching: "Watching",
    edit: "Edit",
    editName: (name) => `Edit watch: ${name}`,
    reviewDates: "Its dates are still read from its words each time, and those words can mean a different range on another day. Check the dates to set them.",
    reviewUnparsed: "Its words could not be read into conditions, so it is still checked by its words. Set its conditions.",
    changesTitle: "What changed",
    changeNew: (what, miles) => `New: ${what}, ${miles}`,
    changeGone: (what, miles) => `Gone: ${what}, was ${miles}`,
    changeCheaper: (what, before, after) => `Cheaper: ${what}, ${before} → ${after}`,
    moreChanges: (n) => `and ${n} more`,
    comparedOver: (range) => `Compared over ${range}, the dates both checks covered.`,
    notCompared: "Could not compare with the check before: the dates did not overlap. This check is the new starting point.",
    skipCached: (ago) => `Skipped while cached results are still valid (last checked ${ago}).`,
    skipDatesPassed: "Not checked: these dates have passed. Edit the watch to choose new dates.",
    // The OAuth flavour has no key to check: the connection is what seats.aero refused.
    refused: OAUTH
      ? "Not checked: seats.aero did not accept the connection. Connect your account again in Settings. The previous baseline is kept."
      : "Not checked: seats.aero did not accept the API key. Check it in Settings. The previous baseline is kept.",
    failedWith: (ago, message) => `Check failed; previous baseline kept (${ago}): ${message}`,
    refusedNoBaseline: OAUTH
      ? "Not checked: seats.aero did not accept the connection. Connect your account again in Settings."
      : "Not checked: seats.aero did not accept the API key. Check it in Settings.",
    unresolved: "Not checked: these conditions cannot be run. Edit the watch to set them again.",
    stopName: (name) => `Stop watching: ${name}`,
    discardWatch: "Your changes to this watch have not been saved.",
    heldNewer: "Your watches were saved by a newer version of awardgrid. This version leaves them unchanged, and cannot add or change watches.",
    heldUnreadable: "Your watches could not be read on this device, so nothing is written over them. Watches cannot be added or changed until they can be read.",
    keptAside: (file) => `The watches file on this device could not be read. It was kept unchanged as ${file}, and watches start again from an empty list.`,
    carried: (n) => `${n} saved ${n === 1 ? "watch" : "watches"} could not be read by this version. ${n === 1 ? "It is" : "They are"} kept unchanged.`,
    editTitle: "Edit watch",
    saveWatch: "Save watch",
    saveWatchNote: "Saving sends nothing. The watch starts again from these conditions the next time the app checks it.",
    savedWatch: "Watch saved. It starts again from these conditions.",
    byText: (text) => `Checked by its words: “${text}”`,
  },
  zh: {
    eyebrow: "关注",
    title: "你关注的查询",
    onOpen: "关注只在你打开应用时检查，其他时间不会检查。",
    noBackground: "没有后台检查，所以变化要等你再打开应用时才会发现，而不是在它发生时。",
    skipSoon: "距离上一次检查不到 45 分钟的检查会跳过：seats.aero 的缓存数据不可能更新，跳过能把今天的调用留给你自己的查询。",
    empty: { before: "你还没有关注任何查询。先查询一次，再选择“", action: "关注此查询", after: "”。" },
    justNow: "刚刚",
    ago: (value, unit) => `${value} ${unit === "minute" ? "分钟" : unit === "hour" ? "小时" : "天"}前`,
    paused: "已暂停。恢复之前不会检查。",
    failed: (ago, message) => `上一次尝试失败（${ago}）：${message}`,
    unknownError: "未知错误",
    notChecked: "尚未检查。",
    baseline: (ago) => `基线已建立（${ago}）。之后的检查会报告变化。`,
    lastChecked: (ago) => `上一次检查：${ago}`,
    unseen: (u) =>
      `自你上次查看以来：${[u.new ? `新增 ${u.new} 个` : null, u.dropped ? `消失 ${u.dropped} 个` : null, u.cheaper ? `降价 ${u.cheaper} 个` : null].filter(Boolean).join("，")}`,
    skipNoKey: "未检查：请在设置中连接你的 seats.aero 账户。",
    skipQuota: (approved) => `${approved}。未检查：今天剩余的 seats.aero 调用不足 25 次，这些留给你自己的查询。`,
    pause: "暂停",
    resume: "恢复",
    stop: "停止关注",
    confirmStop: (name) => `停止关注“${name}”？`,
    confirmStopBody: "此关注及其上一次找到的内容会从本机移除。你的查询和结果不受影响。",
    keepWatching: "保留此关注",
    close: "关闭",
    watching: "关注中",
    edit: "编辑",
    editName: (name) => `编辑关注：${name}`,
    reviewDates: "它的日期仍按文字重新读取，而这些文字在另一天可能表示不同的日期范围。请确认日期。",
    reviewUnparsed: "它的文字无法读成查询条件，所以仍按文字检查。请设置条件。",
    changesTitle: "变化",
    changeNew: (what, miles) => `新增：${what}，${miles}`,
    changeGone: (what, miles) => `消失：${what}，原为 ${miles}`,
    changeCheaper: (what, before, after) => `降价：${what}，${before} → ${after}`,
    moreChanges: (n) => `另有 ${n} 项`,
    comparedOver: (range) => `比较范围：${range}（两次检查都覆盖的日期）。`,
    notCompared: "无法与上一次检查比较：两次的日期没有重叠。这次检查是新的起点。",
    skipCached: (ago) => `缓存期内未重查（上一次检查：${ago}）。`,
    skipDatesPassed: "未检查：这些日期已经过去。请编辑关注，选择新的日期。",
    refused: OAUTH ? "未检查：seats.aero 未接受当前连接，请在设置中重新连接账户。已保留旧基线。" : "未检查：seats.aero 未接受此 API 密钥，请在设置中检查。已保留旧基线。",
    failedWith: (ago, message) => `检查失败，已保留旧基线（${ago}）：${message}`,
    refusedNoBaseline: OAUTH ? "未检查：seats.aero 未接受当前连接，请在设置中重新连接账户。" : "未检查：seats.aero 未接受此 API 密钥，请在设置中检查。",
    unresolved: "未检查：这些条件无法运行。请编辑关注，重新设置条件。",
    stopName: (name) => `停止关注：${name}`,
    discardWatch: "你对此关注的修改还没有保存。",
    heldNewer: "你的关注由更新版本的 awardgrid 保存。此版本不会改动它们，也不能添加或修改关注。",
    heldUnreadable: "无法在本机读取你的关注，所以不会覆盖它们。能够读取之前，无法添加或修改关注。",
    keptAside: (file) => `本机上的关注文件无法读取。它已原样保留为 ${file}，关注从空列表重新开始。`,
    carried: (n) => `有 ${n} 个已保存的关注此版本无法读取，已原样保留。`,
    editTitle: "编辑关注",
    saveWatch: "保存关注",
    saveWatchNote: "保存不会发送任何请求。下次应用检查时，会按这些条件重新开始。",
    savedWatch: "关注已保存，将按这些条件重新开始。",
    byText: (text) => `按文字检查：“${text}”`,
  },
};
