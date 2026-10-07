/**
 * The English notice strings (`notice.<code>`, lib/notices.ts): the CLI's output, the plain `warnings` arrays and
 * ParseError.message. Part of the English dictionary — ./en.ts spreads them in, so its keys and values are unchanged,
 * and zh.ts keeps their translations — and on their own here so lib/notices.ts can read them without importing the
 * whole web dictionary into every bundle that parses a query, the iOS app's among them.
 *
 * Same rules as en.ts (docs/COPY.md, copy-rules.test.ts); append a key here AND in zh.ts.
 */
export const NOTICES_EN = {
  "notice.parse.unknown_codes":
    "{field} {codes} came from the language model and are not in the places list. Check the chips.",
  "notice.parse.end_before_start": "End date {date_to} is before start date {date_from}. Searching a single day.",
  "notice.parse.range_truncated":
    "Date range truncated to {days} days ({date_from} to {date_to}). Split longer searches into several queries.",
  // Lowercase fragment kept verbatim: pinned by src/lib/notices.test.ts:23 (sentence-case it there first).
  "notice.parse.llm_retry": "the language model needed a retry to produce a valid answer",
  "notice.parse.start_in_past": "Start date {date_from} is before today ({today}).",
  "notice.parse.start_far_out": "Start date {date_from} is more than a year out. Award calendars rarely open that far.",
  "notice.parse.range_end_first":
    "The date range was written end-first ({from} to {to}). Searching {date_from} to {date_to}.",
  "notice.parse.empty": "Enter a query first.",
  "notice.parse.missing":
    "Couldn't read the {fields} in \"{text}\". Name the cities (香港到西雅图 or HKG to SEA) and a date window (未来一个月 or next month).",
  "notice.parse.invalid": "The parsed query is incomplete or invalid ({issues}).",
  "notice.parse.llm_unreachable": "The query parser couldn't reach the language model. Try again in a minute.",
  "notice.parse.llm_failed":
    "Couldn't read the query after {attempts} attempts ({reason}). Name the cities, dates and cabin explicitly, for example \"HKG to SEA, next month, business\".",
  "notice.find.quota_headroom": "Stopped before finishing the search: today's seats.aero quota headroom is used up.",
  "notice.find.truncated_search":
    "Results may be incomplete: stopped after {pages} page(s) of Cached Search to protect the daily quota.",
  "notice.find.truncated_bulk":
    "Results may be incomplete: stopped after {pages} page(s) of Bulk Availability ({source}) to protect the daily quota.",
  "notice.find.routes_skipped":
    "Couldn't check whether seats.aero monitors {pairs} empty pair(s): {skipped} program route list(s) skipped to stay within today's quota.",
  "notice.find.routes_failed":
    "Couldn't load the route list for {programs}. Blank cells on those routes may be unchecked rather than empty.",
} as const;
