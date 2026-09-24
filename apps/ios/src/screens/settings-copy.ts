/**
 * Settings' own words, in English and Chinese (UI/UX v1 T11; docs/04 S08). Sentences with an approved key (the key
 * check's cost, the example's label) come from core's COPY; the Anthropic section's English is ask/labels.ts, kept
 * as it is so its tests and meaning do not move, and this file gives its Chinese.
 */
import {
  ANTHROPIC_DATA_SENT,
  ANTHROPIC_KEY_INPUT_LABEL,
  ANTHROPIC_KEY_PLACEHOLDER,
  ANTHROPIC_KEY_USE,
  ANTHROPIC_SECTION_TITLE,
  CACHE_CLEARED,
  CACHE_NOTE,
  CHECK_KEY,
  KEY_CHECKING,
  KEY_NOT_REMOVED,
  KEY_REMOVAL_NOTE,
  KEY_REMOVED,
  KEY_SAVED,
  NO_KEY_ON_FILE,
  PRICING_LINE,
  REMOVE_ANTHROPIC_KEY_NAME,
  REMOVE_KEY,
  SAVE_ANTHROPIC_KEY_NAME,
  SAVE_KEY,
  keyOnFileLabel,
  keyReadFailedLabel,
  keySaveFailedLabel,
} from "../ask/labels";
import type { Locale } from "../app/locale";

export interface SettingsCopy {
  title: string;
  groups: { data: string; ai: string; appearance: string; local: string; about: string };
  seatsRow: string;
  anthropicRow: string;
  anthropicRowNote: string;
  onFile: (last4: string) => string;
  notConnected: string;
  theme: string;
  themes: { system: string; light: string; dark: string };
  language: string;
  clearCache: string;
  cacheNote: string;
  /** What clearing the cache does not touch: the results already on the Search screen. */
  cacheKeeps: string;
  cacheCleared: string;
  aboutData: string;
  aboutSent: string;
  back: string;
  /** A sheet's close button. */
  close: string;
  seats: {
    title: string;
    purpose: string;
    where: string;
    label: string;
    placeholder: string;
    paste: string;
    pasteFailed: string;
    checkAndSave: string;
    checking: string;
    saved: string;
    invalid: string;
    network: string;
    unknown: string;
    malformed: string;
    quota: string;
    saveFailed: (message: string) => string;
    remove: string;
    removed: string;
    notRemoved: string;
    removeUnconfirmed: string;
    startSearching: string;
    confirmTitle: string;
    confirmBody: string[];
    confirmRemove: string;
    confirmKeep: string;
  };
  anthropic: {
    title: string;
    use: string;
    dataSent: string;
    pricing: string;
    label: string;
    placeholder: string;
    save: string;
    saveName: string;
    check: string;
    remove: string;
    removeName: string;
    removalNote: string;
    saved: string;
    checking: string;
    noKey: string;
    removed: string;
    notRemoved: string;
    onFile: (masked: string) => string;
    saveFailed: (message: string) => string;
    readFailed: (message: string) => string;
    confirmTitle: string;
    confirmBody: string[];
  };
}

export const SETTINGS: Record<Locale, SettingsCopy> = {
  en: {
    title: "Settings",
    groups: { data: "Data connection", ai: "AI (optional)", appearance: "Appearance and language", local: "Local data", about: "About" },
    seatsRow: "seats.aero Pro key",
    anthropicRow: "Anthropic API key",
    anthropicRowNote: "Only for AI assistance. Search works without it.",
    onFile: (last4) => `Key on file ending in ${last4}`,
    notConnected: "Not connected",
    theme: "Theme",
    themes: { system: "System", light: "Light", dark: "Dark" },
    language: "Language",
    clearCache: "Clear cached results",
    cacheNote: CACHE_NOTE,
    cacheKeeps: "Results already on the Search screen stay there, with the search they came from; clearing the cache does not remove them.",
    cacheCleared: CACHE_CLEARED,
    aboutData: "Data: seats.aero · your own keys, on this device",
    aboutSent:
      "Searches go to seats.aero with your key. When you use AI assistance, your question, the earlier questions and answers in that conversation, the search you include and the seats.aero results it reads go to Anthropic. Keeping keys on this device does not keep searches off the network.",
    back: "Back to settings",
    close: "Close",
    seats: {
      title: "Connect seats.aero",
      purpose: "Your own seats.aero Pro key finds award seats. It stays in this device's Keychain and is sent only to seats.aero.",
      where: "Create one on the API tab of your seats.aero settings.",
      label: "seats.aero Pro key",
      placeholder: "Paste your Pro key",
      paste: "Paste",
      pasteFailed: "Could not read the clipboard. Paste into the field instead.",
      checkAndSave: "Check and save",
      checking: "Checking the key with seats.aero",
      saved: "Saved. You can search now.",
      invalid: "seats.aero did not accept this key. Check that it is a Pro key, then try again. The key was not saved.",
      network: "Could not reach seats.aero. The key was not saved. The check may still count as a call.",
      unknown: "seats.aero could not check the key right now. The key was not saved.",
      malformed: "This key has a space or a line break in it. Paste it again without them. Nothing was sent.",
      quota: "No seats.aero calls are left today to check a key with. Nothing was sent and the key was not saved. The count starts again at midnight UTC.",
      saveFailed: (message) => `Could not save the key on this device: ${message}`,
      remove: "Remove key",
      removed: "seats.aero key removed from this device.",
      notRemoved: "Could not remove the key: it is still on this device.",
      removeUnconfirmed: "Could not confirm that the key was removed. Open this page again to check.",
      startSearching: "Start searching",
      confirmTitle: "Remove the seats.aero key?",
      confirmBody: ["Search stops until you add a key again.", "AI assistance keeps its own key.", "Today's call count is kept."],
      confirmRemove: "Remove",
      confirmKeep: "Keep key",
    },
    anthropic: {
      title: ANTHROPIC_SECTION_TITLE,
      use: ANTHROPIC_KEY_USE,
      dataSent: ANTHROPIC_DATA_SENT,
      pricing: PRICING_LINE,
      label: ANTHROPIC_KEY_INPUT_LABEL,
      placeholder: ANTHROPIC_KEY_PLACEHOLDER,
      save: SAVE_KEY,
      saveName: SAVE_ANTHROPIC_KEY_NAME,
      check: CHECK_KEY,
      remove: REMOVE_KEY,
      removeName: REMOVE_ANTHROPIC_KEY_NAME,
      removalNote: KEY_REMOVAL_NOTE,
      saved: KEY_SAVED,
      checking: KEY_CHECKING,
      noKey: NO_KEY_ON_FILE,
      removed: KEY_REMOVED,
      notRemoved: KEY_NOT_REMOVED,
      onFile: keyOnFileLabel,
      saveFailed: keySaveFailedLabel,
      readFailed: keyReadFailedLabel,
      confirmTitle: "Remove the Anthropic key?",
      confirmBody: ["AI assistance stops until you add a key again.", "Search keeps working.", "Today's call count is kept."],
    },
  },
  zh: {
    title: "设置",
    groups: { data: "数据连接", ai: "AI（可选）", appearance: "外观与语言", local: "本地数据", about: "关于" },
    seatsRow: "seats.aero Pro 密钥",
    anthropicRow: "Anthropic API 密钥",
    anthropicRowNote: "仅用于 AI 辅助，没有它也能查票。",
    onFile: (last4) => `已保存密钥，末四位 ${last4}`,
    notConnected: "未连接",
    theme: "主题",
    themes: { system: "跟随系统", light: "浅色", dark: "深色" },
    language: "语言",
    clearCache: "清除缓存结果",
    cacheNote: "兑换结果在本机缓存 45 分钟，重复查询不消耗 seats.aero 调用。清除后下次查询需重新获取，不影响密钥和 AI 对话。",
    cacheKeeps: "查票页上已显示的结果会随其查询一起保留，清除缓存不会删除它们。",
    cacheCleared: "缓存结果已清除，密钥未受影响。",
    aboutData: "数据：seats.aero · 使用你自己的密钥，保存在本机",
    aboutSent: "查票请求会携带你的密钥发往 seats.aero。使用 AI 辅助时，你的问题、同一对话中之前的问答、你附带的查询，以及它读取的 seats.aero 结果会发往 Anthropic。密钥保存在本机，不代表查询内容不外发。",
    back: "返回设置",
    close: "关闭",
    seats: {
      title: "连接 seats.aero",
      purpose: "你自己的 seats.aero Pro 密钥用于查找兑换座位，保存在本机钥匙串，只发送给 seats.aero。",
      where: "可在 seats.aero 设置的 API 页生成。",
      label: "seats.aero Pro 密钥",
      placeholder: "粘贴你的 Pro 密钥",
      paste: "粘贴",
      pasteFailed: "无法读取剪贴板，请直接粘贴到输入框。",
      checkAndSave: "检查并保存",
      checking: "正在向 seats.aero 检查密钥",
      saved: "已保存，现在可以查票。",
      invalid: "seats.aero 未接受此密钥。请确认是 Pro 密钥后重试。密钥未保存。",
      network: "无法连接 seats.aero，密钥未保存。此次检查仍可能计为一次调用。",
      unknown: "seats.aero 暂时无法检查此密钥，密钥未保存。",
      malformed: "此密钥中有空格或换行。请去掉后重新粘贴。未发送任何请求。",
      quota: "今天已没有可用于检查密钥的 seats.aero 调用。未发送任何请求，密钥未保存。计数在 UTC 午夜重新开始。",
      saveFailed: (message) => `无法在本机保存密钥：${message}`,
      remove: "移除密钥",
      removed: "已从本机移除 seats.aero 密钥。",
      notRemoved: "无法移除密钥：它仍保存在本机。",
      removeUnconfirmed: "无法确认密钥已移除。请重新打开此页查看。",
      startSearching: "开始查票",
      confirmTitle: "移除 seats.aero 密钥？",
      confirmBody: ["移除后无法查票，直到重新添加密钥。", "AI 辅助使用自己的密钥，不受影响。", "今日调用次数会保留。"],
      confirmRemove: "移除",
      confirmKeep: "保留密钥",
    },
    anthropic: {
      title: "Anthropic API 密钥（用于 AI 辅助）",
      use: "可选。AI 辅助使用你自己的 Anthropic 密钥，保存在本机钥匙串，只发送给 Anthropic。每次提问由 Anthropic 按此密钥计费。查票和关注不使用它。",
      dataSent: "AI 辅助会把你的问题、同一对话中之前的问答、你附带的查询，以及它读取的 seats.aero 结果发给 Anthropic。你的 seats.aero 密钥不会发给 Anthropic。",
      pricing: "Anthropic 的价格页列出了这些 token 的费用。",
      label: "Anthropic API 密钥",
      placeholder: "粘贴你的 Anthropic API 密钥",
      save: "保存",
      saveName: "保存 Anthropic 密钥",
      check: "检查密钥",
      remove: "移除密钥",
      removeName: "移除 Anthropic 密钥",
      removalNote: "移除此密钥不会删除 AI 对话，查票照常可用。",
      saved: "Anthropic 密钥已保存到本机钥匙串。",
      checking: "正在向 Anthropic 检查密钥…",
      noKey: "未保存 Anthropic 密钥。",
      removed: "已从本机钥匙串移除 Anthropic 密钥。",
      notRemoved: "无法移除密钥：钥匙串中仍有该密钥。",
      onFile: (masked) => `已保存：${masked}`,
      saveFailed: (message) => `无法保存密钥：${message}`,
      readFailed: (message) => `无法从钥匙串读取密钥：${message}`,
      confirmTitle: "移除 Anthropic 密钥？",
      confirmBody: ["移除后无法使用 AI 辅助，直到重新添加密钥。", "查票照常可用。", "今日调用次数会保留。"],
    },
  },
};
