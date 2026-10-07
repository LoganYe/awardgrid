/**
 * The Anthropic key page's words (Settings › AI, design §7; UI/UX v1 T11), in English and Chinese. The English is
 * ask/labels.ts, kept as it is so its tests and meaning do not move; this file gives its Chinese.
 *
 * Imported only by ./AnthropicKeyScreen.tsx, which App.tsx loads lazily and the App Store build (app/flags.ts STORE)
 * compiles out, so none of these sentences is in that bundle (scripts/check-store-bundle.mjs).
 */
import {
  ANTHROPIC_DATA_SENT,
  ANTHROPIC_KEY_INPUT_LABEL,
  ANTHROPIC_KEY_PLACEHOLDER,
  ANTHROPIC_KEY_USE,
  ANTHROPIC_SECTION_TITLE,
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

export interface AnthropicPageCopy {
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
}

export const ANTHROPIC_PAGE: Record<Locale, AnthropicPageCopy> = {
  en: {
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
  zh: {
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
};
