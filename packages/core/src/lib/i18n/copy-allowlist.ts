/**
 * Allowlists for the copy lint (copy-rules.test.ts). Keep these short: every entry is a word
 * the lint would otherwise flag, with the reason it is fine. See docs/COPY.md.
 */
import { SOURCE_NAMES } from "../seatsaero/types";

/** Whole tokens that may be ALL CAPS (4+ letters) inside a string. */
export const CAPS_ALLOWED: ReadonlySet<string> = new Set([
  "CSV",
  "API",
  "ID",
  "URL",
  "OK",
  "IATA", // the airport-code standard, named in the chip editor hint
  "UTC",
  "MASTER_KEY", // env var the self-hoster must set (error.internal)
  "TELEGRAM_BOT_TOKEN", // env var the self-hoster must set (settings.telegram.mock_explain)
]);

/**
 * Words that may be capitalised mid-sentence without counting toward Title Case: product and
 * program names, the Telegram button, seats.aero API endpoints, and place names used in copy.
 */
export const PROPER_NOUNS: ReadonlySet<string> = new Set([
  "seats.aero",
  "awardgrid",
  "Telegram",
  "Duffel",
  "Ignav",
  "Pro", // seats.aero Pro plan
  "Ask", // the Ask lane, named as a feature ("Today's Ask budget")
  "Start", // Telegram's /start button, quoted as the user sees it
  "Cached",
  "Search", // seats.aero "Cached Search" endpoint
  "Bulk",
  "Availability", // seats.aero "Bulk Availability" endpoint
  "Tokyo",
  "Seoul",
  ...Object.values(SOURCE_NAMES).flatMap((name) => name.split(/[\s/]+/)),
]);

/**
 * Keys exempt from the " · " rule, with the reason. Only Telegram message templates whose exact
 * text is pinned by tests outside src/lib/i18n belong here.
 */
export const MIDDLE_DOT_EXEMPT: Readonly<Record<string, string>> = {
  "notify.digest.title": "Telegram digest header; pinned by src/lib/notify/format.test.ts (lines 72, 133)",
};

/**
 * Keys whose value is a control label (button, link, menu item, tab): sentence case, no Title
 * Case, no trailing period. Matched against the full key.
 */
export const CONTROL_KEY_PATTERNS: readonly RegExp[] = [
  /^nav\./,
  /^theme\.(label|system|light|dark)$/,
  /^common\.(save|cancel|close|retry|delete|confirm|yes|no|back|copy|copied|keep|go_to_grid)$/,
  // Last segment is a verb or control name (dot-anchored so `no_link`, `first_run` do not match).
  /\.(search|run|send|stop|clear|show|hide|link|unlink|replace|remove|add|open|delete|edit|keep|examples|transpose)$/,
  // Compound control names, whichever separator precedes them.
  /(\.|_)(cta|submit|submitting|action|run_now|open_link|open_grid|export_csv|save_query|build_with_chips|reset_to_parsed|run_to_refresh|widen_dates|add_cabin|review_unmonitored|logout_all|change_password|copy_details|load_trips|use_example|register_link|login_link|no_key_link)$/,
];
