/**
 * The OAuth flavour's connect page (./SeatsConnectScreen.tsx; app/flags.ts OAUTH; release plan step 18b), in English
 * and Chinese. Its own file, imported by that page alone, which only the OAuth flavour loads: the other flavours carry
 * none of these words. Settings' other sentences, and their OAuth versions, are ./settings-copy.ts.
 *
 * What the connection means is said before it is made, in one sentence: seats.aero's own page asks the person to sign
 * in and approve AwardGrid, AwardGrid never sees the password, and Disconnect is there at any time (here, or in the
 * seats.aero settings). Then: searches from the device to seats.aero, results kept on the device for 24 hours at most,
 * and a token service that renews the connection and keeps nothing. This page is the App Store build's only way to
 * connect an account: there is no paste field in that build.
 */
import type { Locale } from "../app/locale";

export interface OAuthConnectCopy {
  purpose: string;
  /** The one sentence on what connecting is: seats.aero's own page asks you to sign in and approve, no password seen, Disconnect. */
  how: string;
  where: string;
  keeps: string;
  connect: string;
  connecting: string;
  connectedNow: string;
  onFile: string;
  revokeNote: string;
  notConfigured: string;
  failure: Record<"unavailable" | "canceled" | "denied" | "mismatch" | "failed" | "rejected" | "network" | "service" | "keychain", string>;
  disconnect: string;
  disconnecting: string;
  disconnected: string;
  disconnectKeychain: string;
  disconnectSaved: (message: string) => string;
  confirmTitle: string;
  confirmBody: string[];
  confirmDisconnect: string;
  confirmKeep: string;
}

export const OAUTH_CONNECT: Record<Locale, OAuthConnectCopy> = {
  en: {
    purpose: "Optional. Connect your own seats.aero account to see its results instead of sample data.",
    how: "Connect seats.aero opens seats.aero's own page, where seats.aero asks you to sign in and approve AwardGrid; AwardGrid never sees your password, and you can disconnect at any time, here or in your seats.aero settings.",
    where: "seats.aero offers this to accounts with API access. Without it, AwardGrid shows sample data only.",
    keeps:
      "While connected, searches go from this device to seats.aero, and their results are kept on this device for 24 hours at most. A small token service at awardgrid.dowhiz.com renews the connection and stores nothing.",
    connect: "Connect seats.aero",
    connecting: "Waiting for seats.aero",
    connectedNow: "Connected. You can search now.",
    onFile: "Your seats.aero account is connected.",
    revokeNote: "Disconnect removes the connection and every seats.aero result from this device. You can also remove AwardGrid's access in your seats.aero account.",
    notConfigured: "This build cannot connect to seats.aero: it was made without a seats.aero client ID.",
    failure: {
      unavailable: "Connecting needs the iPhone app. It is not available here.",
      canceled: "Connecting was cancelled. Nothing was saved.",
      denied: "AwardGrid was not allowed to connect. Nothing was saved.",
      mismatch: "seats.aero's answer did not belong to this sign-in, so it was not used. Try again.",
      failed: "The seats.aero sign-in did not finish. Try again.",
      rejected: "seats.aero did not accept the sign-in. Try again.",
      network: "Could not reach AwardGrid's token service. Check your connection and try again. Nothing was saved.",
      service: "The token service could not finish connecting. Try again later. Nothing was saved.",
      keychain: "seats.aero allowed the connection, but this device could not save it. Try again.",
    },
    disconnect: "Disconnect",
    disconnecting: "Disconnecting",
    disconnected: "Disconnected. Results from seats.aero were removed from this device.",
    disconnectKeychain: "Could not remove the connection from this device. Try again.",
    disconnectSaved: (message) => `Disconnected, but a file on this device could not be updated: ${message}`,
    confirmTitle: "Disconnect seats.aero?",
    confirmBody: [
      "Search stops until you connect again.",
      "Results from seats.aero are removed from this device: cached results, the results on the Search screen, the results in Saved (your saved searches stay) and what your watches last saw (your watches stay).",
      "Today's call count is kept.",
    ],
    confirmDisconnect: "Disconnect",
    confirmKeep: "Stay connected",
  },
  zh: {
    purpose: "可选。连接你自己的 seats.aero 账户，即可看到该账户的结果，而不是示例数据。",
    how: "“连接 seats.aero”会打开 seats.aero 自己的页面，由 seats.aero 请你登录并批准 AwardGrid；AwardGrid 不会看到你的密码，你也可以随时在这里或 seats.aero 设置中断开连接。",
    where: "seats.aero 只向有 API 访问权限的账户提供此功能。没有它，AwardGrid 只显示示例数据。",
    keeps: "连接期间，查票请求从本机发往 seats.aero，其结果在本机最多保留 24 小时。awardgrid.dowhiz.com 上的一个小型令牌服务只负责续期连接，不保存任何内容。",
    connect: "连接 seats.aero",
    connecting: "正在等待 seats.aero",
    connectedNow: "已连接，现在可以查票。",
    onFile: "你的 seats.aero 账户已连接。",
    revokeNote: "断开连接会从本机移除连接和所有来自 seats.aero 的结果。你也可以在 seats.aero 账户中移除 AwardGrid 的访问权限。",
    notConfigured: "此版本无法连接 seats.aero：构建时没有提供 seats.aero 客户端 ID。",
    failure: {
      unavailable: "连接需要在 iPhone 应用中进行，此处不可用。",
      canceled: "已取消连接，未保存任何内容。",
      denied: "未允许 AwardGrid 连接，未保存任何内容。",
      mismatch: "seats.aero 的回应不属于这次登录，因此未使用。请重试。",
      failed: "seats.aero 登录未完成。请重试。",
      rejected: "seats.aero 未接受这次登录。请重试。",
      network: "无法连接 AwardGrid 的令牌服务。请检查网络后重试。未保存任何内容。",
      service: "令牌服务暂时无法完成连接。请稍后重试。未保存任何内容。",
      keychain: "seats.aero 已允许连接，但本机无法保存。请重试。",
    },
    disconnect: "断开连接",
    disconnecting: "正在断开连接",
    disconnected: "已断开连接，来自 seats.aero 的结果已从本机移除。",
    disconnectKeychain: "无法从本机移除连接。请重试。",
    disconnectSaved: (message) => `已断开连接，但本机有一个文件无法更新：${message}`,
    confirmTitle: "断开 seats.aero 连接？",
    confirmBody: [
      "断开后无法查票，直到重新连接。",
      "来自 seats.aero 的结果会从本机移除：缓存结果、查票页上的结果、收藏中的结果（收藏的查询会保留）以及关注上次看到的内容（关注会保留）。",
      "今日调用次数会保留。",
    ],
    confirmDisconnect: "断开连接",
    confirmKeep: "保持连接",
  },
};
