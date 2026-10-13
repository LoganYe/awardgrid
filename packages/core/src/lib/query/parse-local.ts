/**
 * parseQueryLocal: NL → QueryObject with the deterministic parser alone (kickoff §4.2), for a caller that never asks an
 * LLM: the iPhone app's search and planner, and the migration of its old text watches. It is parseQuery (./parse.ts)
 * without the LLM fallback, and the steps the two share are here, so this module imports neither ./llm.ts nor the
 * Anthropic SDK that comes with it: a bundle built from it carries no LLM client (apps/ios/scripts/
 * check-store-bundle.mjs). Text the deterministic pass cannot complete is a ParseError naming the missing fields, as
 * parseQuery without an LLM client says it.
 */
import { notice, noticesToText, type Notice } from "../notices";
import { addDays, capRange, parseISODate } from "./dates";
import { type DeterministicResult, type MissingField, type Provenance, parseDeterministic } from "./deterministic";
import { ParseError } from "./parse-error";
import type { Places } from "./places";
import { MAX_SPAN_DAYS, QueryObject, type QueryObjectInput } from "./schema";

export interface ParseQueryLocalOptions {
  /** ISO date (YYYY-MM-DD), injected by the caller. */
  today: string;
  places?: Places;
}

export interface ParseQueryResult {
  query: QueryObject;
  provenance: Record<string, Provenance>;
  used_llm: boolean;
  /** English renderings of `notices` (CLI, logs, tests). */
  warnings: string[];
  /** Structured {code, vars} for translation in the UI. */
  notices: Notice[];
}

const FIELD_LABELS: Record<MissingField, string> = {
  origins: "origin airport(s)",
  destinations: "destination airport(s)",
  date_from: "start date",
  date_to: "end date",
};

function describeMissing(missing: MissingField[]): string {
  const labels = [...new Set(missing.map((m) => FIELD_LABELS[m]))];
  return labels.join(", ");
}

/** The first step of every parse: refuse empty text and a bad `today`, then the deterministic pass. */
export function startParse(text: string, opts: Pick<ParseQueryLocalOptions, "today" | "places">): { trimmed: string; det: DeterministicResult } {
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new ParseError(notice("parse.empty"), { missing: ["origins", "destinations", "date_from", "date_to"] });
  parseISODate(opts.today); // fail fast on a bad `today`
  return { trimmed, det: parseDeterministic(trimmed, { today: opts.today, places: opts.places }) };
}

/** What a parse that cannot ask an LLM says when the deterministic pass left fields unread. */
export function missingFieldsError(trimmed: string, missing: MissingField[]): ParseError {
  return new ParseError(notice("parse.missing", { fields: describeMissing(missing), text: trimmed }), { missing });
}

/** Enforce date_to >= date_from and the 92-day cap by truncation (never by failing). */
function normalizeDates(input: Partial<QueryObjectInput>, notices: Notice[]): void {
  if (!input.date_from || !input.date_to) return;
  let from: number;
  let to: number;
  try {
    from = parseISODate(input.date_from);
    to = parseISODate(input.date_to);
  } catch {
    return; // let QueryObject.parse report the invalid date
  }
  if (to < from) {
    notices.push(notice("parse.end_before_start", { date_to: input.date_to, date_from: input.date_from }));
    to = from;
  }
  const capped = capRange(from, to);
  if (capped.capped) {
    notices.push(notice("parse.range_truncated", { days: MAX_SPAN_DAYS, date_from: capped.date_from, date_to: capped.date_to }));
  }
  input.date_from = capped.date_from;
  input.date_to = capped.date_to;
}

/** The last step of every parse: the date rules, the notes about the dates, and the schema's own check. */
export function finishParse(
  input: Partial<QueryObjectInput>,
  det: DeterministicResult,
  usedLLM: boolean,
  notices: Notice[],
  today: string,
): ParseQueryResult {
  normalizeDates(input, notices);
  if (input.date_from && parseISODate(input.date_from) < parseISODate(today)) {
    notices.push(notice("parse.start_in_past", { date_from: input.date_from, today }));
  }
  if (input.date_from && parseISODate(input.date_from) > addDays(parseISODate(today), 366)) {
    notices.push(notice("parse.start_far_out", { date_from: input.date_from }));
  }

  const checked = QueryObject.safeParse(input);
  if (!checked.success) {
    const issues = checked.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new ParseError(notice("parse.invalid", { issues }), {
      missing: det.missing,
      cause: checked.error,
    });
  }
  return { query: checked.data, provenance: det.provenance, used_llm: usedLLM, warnings: noticesToText(notices), notices };
}

export async function parseQueryLocal(text: string, opts: ParseQueryLocalOptions): Promise<ParseQueryResult> {
  const { trimmed, det } = startParse(text, opts);
  if (det.missing.length > 0) throw missingFieldsError(trimmed, det.missing);
  return finishParse(det.partial, det, false, [...det.notices], opts.today);
}
