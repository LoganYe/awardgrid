/**
 * Settings' own words, in English and Chinese (UI/UX v1 T11; docs/04 S08). Sentences with an approved key (the key
 * check's cost, the example's label) come from core's COPY.
 *
 * Ask's lines are not here. The AI group and its row, and the Ask-naming versions of five sentences below (what is
 * sent where, the non-affiliation sentence, the cache note and its result, the seats.aero key's removal sheet), are
 * ask/ask-surface-copy.ts, read only when the build has Ask; the App Store build (app/flags.ts STORE) uses the
 * neutral versions written here. The Anthropic key page's words are ./anthropic-copy.ts.
 */
import { STORE } from "../app/flags";
import type { Locale } from "../app/locale";
import { ASK_SURFACES } from "../ask/ask-surface-copy";

export interface SettingsCopy {
  title: string;
  groups: { data: string; appearance: string; local: string; about: string };
  seatsRow: string;
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
  /** Release D7: the non-affiliation sentence (LEGAL.md), and the rows to the site's pages and the licenses. */
  notAffiliated: string;
  privacy: string;
  support: string;
  /** Said to a screen reader after an external row's label: the tap leaves the app. */
  opensInSafari: string;
  acknowledgements: {
    title: string;
    intro: string;
    meta: (version: string, license: string) => string;
  };
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

}

export const SETTINGS: Record<Locale, SettingsCopy> = {
  en: {
    title: "Settings",
    groups: { data: "Data connection", appearance: "Appearance and language", local: "Local data", about: "About" },
    seatsRow: "seats.aero account",
    onFile: (last4) => `Key on file ending in ${last4}`,
    notConnected: "Not connected",
    theme: "Theme",
    themes: { system: "System", light: "Light", dark: "Dark" },
    language: "Language",
    clearCache: "Clear cached results",
    cacheNote: STORE
      ? "Award results are cached on this device for 45 minutes so repeating a search costs no seats.aero calls. Clearing it costs one cold search, nothing more. This does not touch your seats.aero key."
      : ASK_SURFACES.en.settings.cacheNote,
    cacheKeeps: "Results already on the Search screen stay there, with the search they came from; clearing the cache does not remove them.",
    cacheCleared: STORE ? "Cached results cleared. Your seats.aero key is untouched." : ASK_SURFACES.en.settings.cacheCleared,
    aboutData: "Data: seats.aero",
    aboutSent: STORE
      ? "Searches go to seats.aero with your seats.aero API key. Keeping the key on this device does not keep searches off the network."
      : ASK_SURFACES.en.settings.aboutSent,
    notAffiliated: STORE
      ? "AwardGrid is not affiliated with, endorsed by, or sponsored by seats.aero, any airline, or any loyalty program."
      : ASK_SURFACES.en.settings.notAffiliated,
    privacy: "Privacy policy",
    support: "Support",
    opensInSafari: "Opens in Safari",
    acknowledgements: {
      // "Licenses", not "Acknowledgements": one 16-letter word does not fit a 320-point screen at large text sizes.
      title: "Licenses",
      intro: "AwardGrid is built with this open-source software. Each is used under its license, and each license's text is below, as its authors ask.",
      meta: (version, license) => `Version ${version}, ${license}`,
    },
    back: "Back to settings",
    close: "Close",
    seats: {
      title: "Connect your seats.aero account",
      purpose:
        "Optional. Connect your own seats.aero account to see its results instead of sample data. Paste the API key from the API tab of your seats.aero settings. It stays in this device's Keychain and is sent only to seats.aero.",
      where: "No API tab in your seats.aero settings? Then your account has no API access, and AwardGrid shows sample data only.",
      label: "seats.aero API key",
      placeholder: "Paste your seats.aero API key",
      paste: "Paste",
      pasteFailed: "Could not read the clipboard. Paste into the field instead.",
      checkAndSave: "Check and save",
      checking: "Checking the key with seats.aero",
      saved: "Saved. You can search now.",
      invalid: "seats.aero did not accept this key. Check that you copied all of it from the API tab of your seats.aero settings, then try again. Nothing was saved.",
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
      confirmBody: STORE
        ? ["Search stops until you add a key again.", "Today's call count is kept."]
        : ["Search stops until you add a key again.", ASK_SURFACES.en.settings.seatsKeyKeepsAi, "Today's call count is kept."],
      confirmRemove: "Remove",
      confirmKeep: "Keep key",
    },
  },
  zh: {
    title: "设置",
    groups: { data: "数据连接", appearance: "外观与语言", local: "本地数据", about: "关于" },
    seatsRow: "seats.aero 账户",
    onFile: (last4) => `已保存密钥，末四位 ${last4}`,
    notConnected: "未连接",
    theme: "主题",
    themes: { system: "跟随系统", light: "浅色", dark: "深色" },
    language: "语言",
    clearCache: "清除缓存结果",
    cacheNote: STORE ? "兑换结果在本机缓存 45 分钟，重复查询不消耗 seats.aero 调用。清除后下次查询需重新获取，不影响 seats.aero 密钥。" : ASK_SURFACES.zh.settings.cacheNote,
    cacheKeeps: "查票页上已显示的结果会随其查询一起保留，清除缓存不会删除它们。",
    cacheCleared: STORE ? "缓存结果已清除，seats.aero 密钥未受影响。" : ASK_SURFACES.zh.settings.cacheCleared,
    aboutData: "数据：seats.aero",
    aboutSent: STORE ? "查票请求会携带你的 seats.aero API 密钥发往 seats.aero。密钥保存在本机，不代表查询内容不外发。" : ASK_SURFACES.zh.settings.aboutSent,
    notAffiliated: STORE ? "AwardGrid 与 seats.aero、任何航空公司或任何里程计划均无关联，也未获其认可或赞助。" : ASK_SURFACES.zh.settings.notAffiliated,
    privacy: "隐私政策",
    support: "支持",
    opensInSafari: "在 Safari 中打开",
    acknowledgements: {
      title: "开源许可",
      intro: "AwardGrid 使用了以下开源软件，均按各自的许可证使用；按作者的要求，每份许可证的全文附在下方。",
      meta: (version, license) => `版本 ${version}，${license}`,
    },
    back: "返回设置",
    close: "关闭",
    seats: {
      title: "连接你的 seats.aero 账户",
      purpose: "可选。连接你自己的 seats.aero 账户，即可看到该账户的结果，而不是示例数据。请粘贴 seats.aero 设置中 API 页上的 API 密钥。密钥保存在本机钥匙串，只发送给 seats.aero。",
      where: "seats.aero 设置中没有 API 页？说明你的账户没有 API 访问权限，AwardGrid 只显示示例数据。",
      label: "seats.aero API 密钥",
      placeholder: "粘贴你的 seats.aero API 密钥",
      paste: "粘贴",
      pasteFailed: "无法读取剪贴板，请直接粘贴到输入框。",
      checkAndSave: "检查并保存",
      checking: "正在向 seats.aero 检查密钥",
      saved: "已保存，现在可以查票。",
      invalid: "seats.aero 未接受此密钥。请确认已从 seats.aero 设置的 API 页完整复制，然后重试。未保存任何内容。",
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
      confirmBody: STORE
        ? ["移除后无法查票，直到重新添加密钥。", "今日调用次数会保留。"]
        : ["移除后无法查票，直到重新添加密钥。", ASK_SURFACES.zh.settings.seatsKeyKeepsAi, "今日调用次数会保留。"],
      confirmRemove: "移除",
      confirmKeep: "保留密钥",
    },
  },
};
