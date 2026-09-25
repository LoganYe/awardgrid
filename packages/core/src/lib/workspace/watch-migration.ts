/**
 * From a text watch to a structured one (UI/UX v1 T14; docs/02 D05; docs/03 SavedQueryV2; acceptance A24).
 *
 * An iOS watch used to be a sentence, read again by the parser on every check, so "next 30 days" moved with the day.
 * A watch is now the structured query and date rule the person saw or edited: a check runs that, and never reads the
 * old text again over fields that were changed. The migration builds the rule only from what the parser proves:
 *
 *   - **Relative** when the text, read today and tomorrow, gives windows starting on each day with the same length:
 *     "next 30 days", "未来两周".
 *   - **Fixed** when the same dates come back read today, tomorrow, the day after they start and the day after they
 *     end: "2026-10-01 to 2026-10-30". The dates keep their meaning. Two days before a range starts are not proof:
 *     "October" reads as Oct 1–31 all September, then as the rest of the month, then as next year's October; a date
 *     without a year moves to next year once it has passed.
 *   - **Unclear** otherwise (a month name, a date without a year): nothing is guessed. The watch keeps its text and
 *     is checked as it always was, and it is marked for the person to confirm its dates (`review: "dates"`).
 *   - A text the parser cannot read at all is kept, never dropped (`review: "unparsed"`, no draft).
 *
 * No AI is involved; the deterministic parser only.
 */
import { addDays, formatISODate, parseDates, parseISODate } from "../query/dates";
import { parseQuery } from "../query/parse";
import { spanDays } from "./query-editor";
import type { DateRule, ISODate, QueryDraft, SavedQueryV2 } from "./types";

export interface LegacyWatchInput {
  id: string;
  name: string;
  enabled: boolean;
  text: string;
}

export type DateEvidence =
  | { kind: "relative"; rule: Extract<DateRule, { kind: "relative_days" }> }
  | { kind: "fixed"; rule: Extract<DateRule, { kind: "fixed" }> }
  /** The text's dates depend on the day in a way that is not "the next N days". */
  | { kind: "unclear" }
  /** No date phrase at all. */
  | { kind: "none" };

const nextDay = (day: ISODate): ISODate => formatISODate(addDays(parseISODate(day), 1));

/** What the text's date phrase is, proven by reading it on the days where a moving phrase would move. */
export function dateRuleFromText(text: string, today: ISODate): DateEvidence {
  const a = parseDates(text, today);
  const b = parseDates(text, nextDay(today));
  if (!a || !b) return { kind: "none" };
  const spanA = spanDays(a.date_from, a.date_to);
  const spanB = spanDays(b.date_from, b.date_to);
  if (a.date_from === today && b.date_from === nextDay(today) && spanA === spanB) {
    return { kind: "relative", rule: { kind: "relative_days", days: spanA, clock: "UTC" } };
  }
  const same = (r: ReturnType<typeof parseDates>) => r !== null && r.date_from === a.date_from && r.date_to === a.date_to;
  // Read again once the range has started and once it has ended: a month name or a date without a year moves there.
  if (same(b) && same(parseDates(text, nextDay(a.date_from))) && same(parseDates(text, nextDay(a.date_to)))) {
    return { kind: "fixed", rule: { kind: "fixed", from: a.date_from, to: a.date_to } };
  }
  return { kind: "unclear" };
}

/** A text watch as a structured one: the same identity, what it asked for, and the rule its dates follow. */
export async function migrateLegacyWatch(input: LegacyWatchInput, today: ISODate): Promise<SavedQueryV2> {
  const base = { schemaVersion: 2 as const, id: input.id, title: input.name, enabled: input.enabled, legacyRawText: input.text };
  let query;
  try {
    ({ query } = await parseQuery(input.text, { today }));
  } catch {
    return { ...base, draft: null, review: "unparsed" };
  }
  const evidence = dateRuleFromText(input.text, today);
  if (evidence.kind === "relative" || evidence.kind === "fixed") {
    const draft: QueryDraft = { query, dates: evidence.rule };
    return { ...base, draft };
  }
  // Unclear (or no phrase, which parseQuery would not have accepted): what the text means today, for the person to
  // confirm; the watch keeps reading its text until then.
  return { ...base, draft: { query, dates: { kind: "fixed", from: query.date_from, to: query.date_to } }, review: "dates" };
}

/**
 * The draft a new watch of a search on screen keeps (T14): the search's own structured query, and its date rule,
 * proven from the sentence that describes it (the editor writes "next N days" for a relative rule) on the day it was
 * made; otherwise its fixed dates. Nothing is re-read from text over the query's fields.
 */
export function draftForWatch(query: QueryDraft["query"], madeOn: ISODate): QueryDraft {
  const evidence = dateRuleFromText(query.raw_text, madeOn);
  if (evidence.kind === "relative") {
    const days = evidence.rule.days;
    const to = formatISODate(addDays(parseISODate(madeOn), days - 1));
    // Only when the rule gives exactly the dates this search ran with.
    if (query.date_from === madeOn && query.date_to === to) return { query, dates: evidence.rule };
  }
  return { query, dates: { kind: "fixed", from: query.date_from, to: query.date_to } };
}
