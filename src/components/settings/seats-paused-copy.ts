/**
 * What the web app says while Login with Seats.aero is paused on its server (src/lib/seats-oauth/pause.ts). Web-only
 * copy, kept here rather than in the shared dictionaries (packages/core), which the iPhone app ships: it never pauses.
 * Written to the dictionaries' rules (docs/COPY.md).
 */
import type { Locale } from "@awardgrid/core/i18n";

export const SEATS_PAUSED_COPY: Record<Locale, string> = {
  en: "Connecting seats.aero is paused on this server. awardgrid deleted every seats.aero sign-in and every seats.aero result from its database and from this browser. Searches, standing queries and Ask stay off until connecting is back.",
  zh: "此服务器已暂停 seats.aero 连接。awardgrid 已从其数据库和此浏览器中删除所有 seats.aero 登录和所有 seats.aero 结果。恢复连接之前，搜索、定时查询和提问都不可用。",
};
