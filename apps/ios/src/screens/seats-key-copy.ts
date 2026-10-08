/**
 * The key flavour's connect page (./SeatsKeyScreen.tsx; app/flags.ts CONNECT "key"), in English and Chinese: the paste
 * field, its key check and the key's removal, and the Settings rows' value for a key on file.
 *
 * Its own file, imported only by the key page and by the uses of KEY_ON_FILE in branches the OAuth flavour compiles
 * out, so the App Store build (`npm run build:store`, the OAuth flavour: seats.aero's own sign-in, no paste field)
 * carries none of these words. scripts/check-store-bundle.mjs fails that build if any of them reach its bundle, and
 * store-copy.test.ts holds the source it is made from to the same.
 *
 * The approved sentence about the key check's cost is core's COPY row key.check_cost, rendered by the key page.
 */
import { STORE } from "../app/flags";
import type { Locale } from "../app/locale";
import { ASK_SURFACES } from "../ask/ask-surface-copy";

export interface SeatsKeyCopy {
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
  confirmTitle: string;
  confirmBody: string[];
  confirmRemove: string;
  confirmKeep: string;
}

/** A Settings row's value for a key on file (the seats.aero key in the key flavour; the Anthropic key with Ask). */
export const KEY_ON_FILE: Record<Locale, (last4: string) => string> = {
  en: (last4) => `Key on file ending in ${last4}`,
  zh: (last4) => `已保存密钥，末四位 ${last4}`,
};

/**
 * A key row's value in Settings: nothing until the Keychain has answered (so nothing says "no key" before it knows),
 * `notConnected` without a key, and the key's last four characters with one. Its callers are in branches the OAuth
 * App Store build compiles out (the key flavour's seats.aero row, and the Anthropic row of a build with Ask).
 */
export function keyRowValue(value: string | null | undefined, locale: Locale, notConnected: string): string {
  return value === undefined ? "" : value === null ? notConnected : KEY_ON_FILE[locale](value);
}

export const SEATS_KEY: Record<Locale, SeatsKeyCopy> = {
  en: {
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
    confirmTitle: "Remove the seats.aero key?",
    confirmBody: STORE
      ? ["Search stops until you add a key again.", "Today's call count is kept."]
      : ["Search stops until you add a key again.", ASK_SURFACES.en.settings.seatsKeyKeepsAi, "Today's call count is kept."],
    confirmRemove: "Remove",
    confirmKeep: "Keep key",
  },
  zh: {
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
    confirmTitle: "移除 seats.aero 密钥？",
    confirmBody: STORE
      ? ["移除后无法查票，直到重新添加密钥。", "今日调用次数会保留。"]
      : ["移除后无法查票，直到重新添加密钥。", ASK_SURFACES.zh.settings.seatsKeyKeepsAi, "今日调用次数会保留。"],
    confirmRemove: "移除",
    confirmKeep: "保留密钥",
  },
};
