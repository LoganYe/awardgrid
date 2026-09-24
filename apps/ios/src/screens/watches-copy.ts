/**
 * The Watches screen's words, in English and Chinese (UI/UX v1 T11). The English is the screen's own, moved here
 * unchanged; the Chinese keeps the same rule (docs/PIVOT.md §3): when a watch was last checked, never when it will be,
 * and no background check claimed. `honesty.test.ts` scans both.
 */
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
  skipQuota: string;
  pause: string;
  resume: string;
  stop: string;
  confirmStop: (name: string) => string;
  confirmStopBody: string;
  keepWatching: string;
  close: string;
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
    skipNoKey: "Not checked: add your seats.aero key in Settings.",
    skipQuota: "Not checked: fewer than 25 seats.aero calls are left today, and those are kept for your own searches.",
    pause: "Pause",
    resume: "Resume",
    stop: "Stop watching",
    confirmStop: (name) => `Stop watching "${name}"?`,
    confirmStopBody: "The watch and what it last found are removed from this device. Your searches and results are not affected.",
    keepWatching: "Keep this watch",
    close: "Close",
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
    baseline: (ago) => `已保存基准（${ago}）。之后的检查会报告变化。`,
    lastChecked: (ago) => `上一次检查：${ago}`,
    unseen: (u) =>
      `自你上次查看以来：${[u.new ? `新增 ${u.new} 个` : null, u.dropped ? `消失 ${u.dropped} 个` : null, u.cheaper ? `降价 ${u.cheaper} 个` : null].filter(Boolean).join("，")}`,
    skipNoKey: "未检查：请在设置中添加 seats.aero 密钥。",
    skipQuota: "未检查：今天剩余的 seats.aero 调用不足 25 次，这些留给你自己的查询。",
    pause: "暂停",
    resume: "恢复",
    stop: "停止关注",
    confirmStop: (name) => `停止关注“${name}”？`,
    confirmStopBody: "此关注及其上一次找到的内容会从本机移除。你的查询和结果不受影响。",
    keepWatching: "保留此关注",
    close: "关闭",
  },
};
