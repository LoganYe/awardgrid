/**
 * parseQuery: NL → QueryObject (kickoff §4.2). Deterministic first; the LLM is called ONLY when
 * origins/destinations or both date bounds cannot be produced deterministically. Without an
 * LLM client the caller gets a ParseError naming the missing fields so the UI can ask for them.
 *
 * The steps before and after the LLM are ./parse-local.ts's, shared with parseQueryLocal, the same parse with no LLM
 * at all for a caller that must not bundle one (the iPhone app).
 */
import { notice, type Notice } from "../notices";
import { parseWithLLM, type ParserClient } from "./llm";
import { type ParseQueryResult, finishParse, missingFieldsError, startParse } from "./parse-local";
import { DEFAULT_PLACES, expandPlace, type Places } from "./places";
import type { QueryObjectInput, QueryObjectLLM } from "./schema";
import type { MissingField, Provenance } from "./deterministic";

export type { ParseQueryResult } from "./parse-local";

export interface ParseQueryOptions {
  /** ISO date (YYYY-MM-DD), injected by the caller. */
  today: string;
  llmClient?: ParserClient;
  model?: string;
  places?: Places;
}

/**
 * LLM place codes → airports (kickoff §4.1: origins/destinations are airports AFTER city
 * expansion). The prompt asks for airports, but a metro code (TYO, NYC) still slips through the
 * /^[A-Z]{3}$/ schema, so expand here exactly as the deterministic path does. Codes outside the
 * seed are kept (the seed is small and the grid still works) but flagged so the chips get a look.
 */
function expandLLMPlaces(codes: readonly string[], field: "origins" | "destinations", places: Places, notices: Notice[]): string[] {
  const out: string[] = [];
  const unknown: string[] = [];
  for (const code of codes) {
    if (!places.knownCodes.has(code)) unknown.push(code);
    for (const airport of expandPlace(code, places)) if (!out.includes(airport)) out.push(airport);
  }
  if (unknown.length > 0) {
    notices.push(notice("parse.unknown_codes", { field, codes: unknown.join(", ") }));
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
  notices: Notice[],
): Partial<QueryObjectInput> {
  const out: Partial<QueryObjectInput> = { ...partial };
  const take = (field: keyof QueryObjectLLM): boolean => provenance[field] !== "deterministic";

  if (missing.includes("origins") && llm.origins.length > 0) {
    out.origins = expandLLMPlaces(llm.origins, "origins", places, notices);
    provenance.origins = "llm";
  }
  if (missing.includes("destinations") && llm.destinations.length > 0) {
    out.destinations = expandLLMPlaces(llm.destinations, "destinations", places, notices);
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

export async function parseQuery(text: string, opts: ParseQueryOptions): Promise<ParseQueryResult> {
  const { trimmed, det } = startParse(text, opts);
  const notices: Notice[] = [...det.notices];
  let input = det.partial;
  let usedLLM = false;

  if (det.missing.length > 0) {
    if (!opts.llmClient) throw missingFieldsError(trimmed, det.missing);
    const llm = await parseWithLLM(trimmed, {
      today: opts.today,
      partial: det.partial,
      client: opts.llmClient,
      model: opts.model,
      places: opts.places,
    });
    usedLLM = true;
    input = mergeLLM(det.partial, det.provenance, llm.result, det.missing, opts.places ?? DEFAULT_PLACES, notices);
    if (llm.attempts > 1) notices.push(notice("parse.llm_retry"));
  }

  return finishParse(input, det, usedLLM, notices, opts.today);
}
