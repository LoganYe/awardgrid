/**
 * parseQuery: NL → QueryObject (kickoff §4.2). Deterministic first; the LLM is called ONLY when
 * origins/destinations or both date bounds cannot be produced deterministically. Without an
 * LLM client the caller gets a ParseError naming the missing fields so the UI can ask for them.
 */
import { addDays, capRange, parseISODate } from "@/lib/query/dates";
import { parseDeterministic, type MissingField, type Provenance } from "@/lib/query/deterministic";
import { ParseError, parseWithLLM, type ParserClient } from "@/lib/query/llm";
import { DEFAULT_PLACES, expandPlace, type Places } from "@/lib/query/places";
import { MAX_SPAN_DAYS, QueryObject, type QueryObjectInput, type QueryObjectLLM } from "@/lib/query/schema";

export interface ParseQueryOptions {
  /** ISO date (YYYY-MM-DD), injected by the caller. */
  today: string;
  llmClient?: ParserClient;
  model?: string;
  places?: Places;
}

export interface ParseQueryResult {
  query: QueryObject;
  provenance: Record<string, Provenance>;
  used_llm: boolean;
  warnings: string[];
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

/**
 * LLM place codes → airports (kickoff §4.1: origins/destinations are airports AFTER city
 * expansion). The prompt asks for airports, but a metro code (TYO, NYC) still slips through the
 * /^[A-Z]{3}$/ schema, so expand here exactly as the deterministic path does. Codes outside the
 * seed are kept (the seed is small and the grid still works) but flagged so the chips get a look.
 */
function expandLLMPlaces(codes: readonly string[], field: "origins" | "destinations", places: Places, warnings: string[]): string[] {
  const out: string[] = [];
  const unknown: string[] = [];
  for (const code of codes) {
    if (!places.knownCodes.has(code)) unknown.push(code);
    for (const airport of expandPlace(code, places)) if (!out.includes(airport)) out.push(airport);
  }
  if (unknown.length > 0) {
    warnings.push(`${field} ${unknown.join(", ")} came from the language model and are not in the places seed; check the chips`);
  }
  return out;
}

/** Take LLM values only for fields the deterministic pass did not establish. */
function mergeLLM(
  partial: Partial<QueryObjectInput>,
  provenance: Record<string, Provenance>,
  llm: QueryObjectLLM,
  missing: MissingField[],
  places: Places,
  warnings: string[],
): Partial<QueryObjectInput> {
  const out: Partial<QueryObjectInput> = { ...partial };
  const take = (field: keyof QueryObjectLLM): boolean => provenance[field] !== "deterministic";

  if (missing.includes("origins") && llm.origins.length > 0) {
    out.origins = expandLLMPlaces(llm.origins, "origins", places, warnings);
    provenance.origins = "llm";
  }
  if (missing.includes("destinations") && llm.destinations.length > 0) {
    out.destinations = expandLLMPlaces(llm.destinations, "destinations", places, warnings);
    provenance.destinations = "llm";
  }
  if (missing.includes("date_from")) {
    out.date_from = llm.date_from;
    out.date_to = llm.date_to;
    provenance.date_from = "llm";
    provenance.date_to = "llm";
  }
  if (take("cabins") && llm.cabins.length > 0) {
    out.cabins = llm.cabins;
    provenance.cabins = "llm";
  }
  if (take("sort_by")) {
    out.sort_by = llm.sort_by;
    provenance.sort_by = "llm";
  }
  if (take("direct_only") && llm.direct_only) {
    out.direct_only = true;
    provenance.direct_only = "llm";
  }
  if (take("max_miles") && llm.max_miles !== null) {
    out.max_miles = llm.max_miles;
    provenance.max_miles = "llm";
  }
  if (take("programs") && llm.programs && llm.programs.length > 0) {
    out.programs = llm.programs;
    provenance.programs = "llm";
  }
  return out;
}

/** Enforce date_to >= date_from and the 92-day cap by truncation (never by failing). */
function normalizeDates(input: Partial<QueryObjectInput>, warnings: string[]): void {
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
    warnings.push(`end date ${input.date_to} was before start date ${input.date_from}; using a single day`);
    to = from;
  }
  const capped = capRange(from, to);
  if (capped.capped) {
    warnings.push(
      `date range truncated to ${MAX_SPAN_DAYS} days (${capped.date_from} → ${capped.date_to}); split longer searches into several queries`,
    );
  }
  input.date_from = capped.date_from;
  input.date_to = capped.date_to;
}

export async function parseQuery(text: string, opts: ParseQueryOptions): Promise<ParseQueryResult> {
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new ParseError("Please enter a query.", { missing: ["origins", "destinations", "date_from", "date_to"] });
  parseISODate(opts.today); // fail fast on a bad `today`

  const det = parseDeterministic(trimmed, { today: opts.today, places: opts.places });
  const warnings: string[] = [...det.warnings];
  let input = det.partial;
  let usedLLM = false;

  if (det.missing.length > 0) {
    if (!opts.llmClient) {
      throw new ParseError(
        `Could not determine the ${describeMissing(det.missing)} from "${trimmed}". Name the cities (e.g. 香港到西雅图 / HKG to SEA) and a date window (e.g. 未来一个月 / next month).`,
        { missing: det.missing },
      );
    }
    const llm = await parseWithLLM(trimmed, {
      today: opts.today,
      partial: det.partial,
      client: opts.llmClient,
      model: opts.model,
      places: opts.places,
    });
    usedLLM = true;
    input = mergeLLM(det.partial, det.provenance, llm.result, det.missing, opts.places ?? DEFAULT_PLACES, warnings);
    if (llm.attempts > 1) warnings.push("the language model needed a retry to produce a valid answer");
  }

  normalizeDates(input, warnings);
  if (input.date_from && parseISODate(input.date_from) < parseISODate(opts.today)) {
    warnings.push(`start date ${input.date_from} is in the past relative to ${opts.today}`);
  }
  if (input.date_from && parseISODate(input.date_from) > addDays(parseISODate(opts.today), 366)) {
    warnings.push(`start date ${input.date_from} is more than a year out; award calendars rarely open that far`);
  }

  const checked = QueryObject.safeParse(input);
  if (!checked.success) {
    const issues = checked.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new ParseError(`The parsed query is incomplete or invalid (${issues}).`, {
      missing: det.missing,
      cause: checked.error,
    });
  }
  return { query: checked.data, provenance: det.provenance, used_llm: usedLLM, warnings };
}
