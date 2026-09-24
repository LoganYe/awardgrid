/**
 * The Saved screens' words, in English and Chinese (UI/UX v1 T13; docs/04 S06; spec §16 "收藏快照"). The fixed note,
 * the undo and the full-store message are approved rows (core present.ts COPY "favorite.snapshot", "favorite.undo",
 * "favorite.limit"). A saved snapshot is never called live, current or booked.
 */
import type { Locale } from "../app/locale";

export interface FavoritesCopy {
  tab: string;
  title: string;
  intro: string;
  usage: (count: number, max: number, mb: string, maxMb: string) => string;
  /** Saved items this build could not read, kept as they are. */
  unreadable: (n: number) => string;
  /** The deletion, said with the way back. */
  removedUndo: string;
  undoFailed: (message: string) => string;
  undoFull: string;
  /** Dates in the saved conditions that have passed. */
  pastAll: string;
  pastSome: string;
  editDates: string;
  dates: (from: string, to: string) => string;
  goSettings: string;
  saveProblemShort: string;
  saveProblemDetails: string;
  saveRetried: string;
  saveFixed: string;
  emptyTitle: string;
  emptyBody: string;
  goSearch: string;
  savedAt: (when: string) => string;
  options: (n: number) => string;
  open: string;
  openName: (name: string) => string;
  remove: string;
  removeName: (name: string) => string;
  removed: string;
  undone: string;
  back: string;
  save: string;
  saving: string;
  saved: string;
  alreadySaved: string;
  viewSaved: string;
  readOnly: string;
  writeFailed: (message: string) => string;
  removeFailed: (message: string) => string;
  gone: string;
  searchAgain: string;
  confirmTitle: string;
  confirmBody: string;
  confirmSends: string;
  confirmRun: string;
  confirmKeep: string;
  close: string;
  noKey: string;
  saveProblem: (message: string) => string;
  saveProblemRetry: string;
}

export const FAVORITES: Record<Locale, FavoritesCopy> = {
  en: {
    tab: "Saved",
    title: "Saved",
    intro: "Saved on this device only. A saved snapshot shows the results as they were; nothing is fetched until you search again.",
    usage: (count, max, mb, maxMb) => `${count} of ${max} saved · ${mb} of ${maxMb} MB`,
    unreadable: (n) => `${n} saved ${n === 1 ? "item" : "items"} could not be read by this version of the app; ${n === 1 ? "it is" : "they are"} kept as ${n === 1 ? "it is" : "they are"}.`,
    removedUndo: "Deleted. Undo is available for 5 seconds.",
    undoFailed: (message) => `Could not restore it on this device; it is still deleted. Try Undo again: ${message}`,
    undoFull: "Could not restore it: saved storage is full. It is still deleted.",
    pastAll: "These dates have passed. Change the dates to search again.",
    pastSome: "Some of these dates have passed; results can only be found for the dates still ahead.",
    editDates: "Change the dates",
    dates: (from, to) => `${from} to ${to}`,
    goSettings: "Add a key in Settings",
    emptyTitle: "Nothing saved yet",
    emptyBody: "Save the results of a search to read them again later, as they were.",
    goSearch: "Go to Search",
    savedAt: (when) => `Saved ${when}`,
    options: (n) => `${n} ${n === 1 ? "option" : "options"} when saved`,
    open: "Open",
    openName: (name) => `Open saved results: ${name}`,
    remove: "Delete",
    removeName: (name) => `Delete saved results: ${name}`,
    removed: "Deleted.",
    undone: "Restored.",
    back: "Back to Saved",
    save: "Save results",
    saving: "Saving",
    saved: "Saved on this device.",
    alreadySaved: "These results are already saved.",
    viewSaved: "View in Saved",
    readOnly: "Saved results from a newer version of the app, or ones that could not be read, are left as they are. Nothing can be saved until the app can read them.",
    writeFailed: (message) => `Could not save on this device; nothing already saved was changed: ${message}`,
    removeFailed: (message) => `Could not delete on this device; it is still saved: ${message}`,
    gone: "These saved results are no longer on this device.",
    searchAgain: "Search again",
    confirmTitle: "Search again with these conditions?",
    confirmBody: "This runs a new search. The saved results stay as they are.",
    confirmSends: "It sends requests to seats.aero with your key and counts toward today's calls, unless recent results are on this device.",
    confirmRun: "Search",
    confirmKeep: "Not now",
    close: "Close",
    noKey: "Add your seats.aero key in Settings to search again.",
    saveProblem: (message) => `Some changes could not be saved on this device; what you see is kept until the app closes: ${message}`,
    saveProblemRetry: "Try saving again",
    saveProblemShort: "Some changes could not be saved on this device.",
    saveProblemDetails: "Details",
    saveRetried: "Still could not save.",
    saveFixed: "Saved.",
  },
  zh: {
    tab: "收藏",
    title: "收藏",
    intro: "仅保存在本机。收藏快照按保存时的样子显示结果；重新查询之前不会获取任何内容。",
    usage: (count, max, mb, maxMb) => `已收藏 ${count}/${max} · ${mb}/${maxMb} MB`,
    unreadable: (n) => `有 ${n} 个收藏无法被此版本应用读取，已原样保留。`,
    removedUndo: "已删除。5 秒内可以撤销。",
    undoFailed: (message) => `无法在本机恢复，它仍处于删除状态。请再次点“撤销”：${message}`,
    undoFull: "无法恢复：收藏空间已满。它仍处于删除状态。",
    pastAll: "这些日期已经过去。请修改日期后再查询。",
    pastSome: "部分日期已经过去，只能找到之后日期的结果。",
    editDates: "修改日期",
    dates: (from, to) => `${from} 至 ${to}`,
    goSettings: "在设置中添加密钥",
    emptyTitle: "还没有收藏",
    emptyBody: "收藏一次查询的结果，之后可以按当时的样子再次查看。",
    goSearch: "去查票",
    savedAt: (when) => `收藏于 ${when}`,
    options: (n) => `收藏时 ${n} 个选项`,
    open: "打开",
    openName: (name) => `打开收藏的结果：${name}`,
    remove: "删除",
    removeName: (name) => `删除收藏的结果：${name}`,
    removed: "已删除。",
    undone: "已恢复。",
    back: "返回收藏",
    save: "收藏结果",
    saving: "正在收藏",
    saved: "已收藏到本机。",
    alreadySaved: "这些结果已经收藏。",
    viewSaved: "在收藏中查看",
    readOnly: "来自较新版本应用或无法读取的收藏会保持原样。在应用能读取它们之前，无法再收藏。",
    writeFailed: (message) => `无法在本机收藏，已有收藏未受影响：${message}`,
    removeFailed: (message) => `无法在本机删除，它仍在收藏中：${message}`,
    gone: "这些收藏的结果已不在本机。",
    searchAgain: "重新查询",
    confirmTitle: "按这些条件重新查询？",
    confirmBody: "这会进行一次新的查询，收藏的结果保持不变。",
    confirmSends: "会使用你的密钥向 seats.aero 发送请求，并计入今日调用次数（本机有近期结果时除外）。",
    confirmRun: "查询",
    confirmKeep: "暂不",
    close: "关闭",
    noKey: "请在设置中添加 seats.aero 密钥后再重新查询。",
    saveProblem: (message) => `部分更改无法保存在本机，当前显示的内容会保留到应用关闭：${message}`,
    saveProblemRetry: "重新保存",
    saveProblemShort: "部分更改无法保存在本机。",
    saveProblemDetails: "详情",
    saveRetried: "仍然无法保存。",
    saveFixed: "已保存。",
  },
};
