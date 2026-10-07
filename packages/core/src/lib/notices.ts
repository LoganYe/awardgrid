/**
 * Structured notices: the codes + variables behind every user-visible warning or parse error
 * the server produces, so the UI can render them in the viewer's language (kickoff §8
 * "zh-CN toggle") instead of showing English sentences verbatim.
 *
 * The English wording lives in the i18n dictionary (`notice.<code>`), which is also what the
 * CLI and the plain-string `warnings` arrays use via `noticeText()` — one source of truth,
 * so the strings tests assert on and the strings the client translates never drift apart.
 */
import { NOTICES_EN } from "./i18n/dictionaries/notices-en";
import { interpolate } from "./i18n";

export const NOTICE_CODES = [
  // parse warnings
  "parse.unknown_codes",
  "parse.end_before_start",
  "parse.range_truncated",
  "parse.llm_retry",
  "parse.start_in_past",
  "parse.start_far_out",
  "parse.range_end_first",
  // parse errors (ParseError.notice)
  "parse.empty",
  "parse.missing",
  "parse.invalid",
  "parse.llm_unreachable",
  "parse.llm_failed",
  // find warnings
  "find.quota_headroom",
  "find.truncated_search",
  "find.truncated_bulk",
  "find.routes_skipped",
  "find.routes_failed",
] as const;

export type NoticeCode = (typeof NOTICE_CODES)[number];
export type NoticeVars = Record<string, string | number>;

export interface Notice {
  code: NoticeCode;
  vars?: NoticeVars;
}

/** i18n key for a notice code. */
export type NoticeKey = `notice.${NoticeCode}`;

export function noticeKey(code: NoticeCode): NoticeKey {
  return `notice.${code}`;
}

export function notice(code: NoticeCode, vars?: NoticeVars): Notice {
  return vars ? { code, vars } : { code };
}

/** English rendering (CLI output, `warnings: string[]`, ParseError.message). */
export function noticeText(n: Notice): string {
  return interpolate(NOTICES_EN[noticeKey(n.code)], n.vars);
}

export function noticesToText(list: readonly Notice[]): string[] {
  return list.map(noticeText);
}

/** True for any object shaped like a Notice with a known code (API responses are untrusted input). */
export function isNotice(value: unknown): value is Notice {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { code?: unknown; vars?: unknown };
  if (typeof v.code !== "string" || !(NOTICE_CODES as readonly string[]).includes(v.code)) return false;
  if (v.vars === undefined) return true;
  if (typeof v.vars !== "object" || v.vars === null) return false;
  return Object.values(v.vars as Record<string, unknown>).every((x) => typeof x === "string" || typeof x === "number");
}
