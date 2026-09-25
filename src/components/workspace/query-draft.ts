/**
 * The Web workspace's query draft (UI/UX v1 T19; docs/04 S10 "Top query"): what the query bar and the conditions
 * toolbar edit, and nothing runs until Find (or Cmd/Ctrl+Enter from inside the query). The rules are core's
 * (validateDraft: schema, span cap, calendar). Airports are typed as codes or place names: a city code or name expands
 * to its airports through core's places (TYO → NRT, HND; SHA → PVG, SHA, as the grid does), and the bar says so; any
 * other three-letter code is taken as an airport, as core does; anything else is named as unknown rather than dropped.
 */
import { expandPlace, resolveAlias } from "@awardgrid/core/query/places";
import { DEFAULT_CABINS, DEFAULT_MIN_CABIN_PCT, MAX_SPAN_DAYS, type QueryObject } from "@awardgrid/core/query/schema";
import { validateDraft, type DraftErrorCode, type DraftField, type QueryDraft } from "@awardgrid/core/workspace/query-editor";

export interface DraftTexts {
  origins: string;
  destinations: string;
}

export type QueryField = DraftField | "programs";

export interface QueryError {
  field: DraftField;
  /** A dictionary key (workspace.q.err.* or workspace.q.unknown_code) and its values. */
  key: string;
  vars?: Record<string, string>;
}

export interface Expansion {
  /** What was typed, as a code (a name reads as its code: "Tokyo" → TYO). */
  code: string;
  airports: string[];
}

/**
 * The airports an airport field names: parts separated by commas, 、 or semicolons, and within a part by spaces. A part
 * is a code or a place name ("Tokyo", "东京"); a city expands to its airports (core expandPlace), in the seed's order,
 * each airport once. What was expanded is returned, so the bar can say what a city code means before anything runs.
 */
export function codesFromText(text: string): { codes: string[]; bad: string[]; expanded: Expansion[] } {
  const codes: string[] = [];
  const bad: string[] = [];
  const expanded: Expansion[] = [];
  const add = (code: string) => {
    const airports = expandPlace(code);
    if (airports.length > 1 || (airports.length === 1 && airports[0] !== code)) {
      if (!expanded.some((e) => e.code === code)) expanded.push({ code, airports });
    }
    for (const airport of airports) if (!codes.includes(airport)) codes.push(airport);
  };
  for (const part of text.split(/[,，、;；]+/).map((p) => p.trim()).filter(Boolean)) {
    const alias = /^[A-Za-z]{3}$/.test(part) ? null : resolveAlias(part);
    if (alias) {
      add(alias);
      continue;
    }
    for (const token of part.split(/\s+/).filter(Boolean)) {
      const upper = token.toUpperCase();
      if (/^[A-Z]{3}$/.test(upper)) add(upper);
      else {
        const named = resolveAlias(token);
        if (named) add(named);
        else if (!bad.includes(token)) bad.push(token);
      }
    }
  }
  return { codes, bad, expanded };
}

/** The browser's calendar day, as the query's dates are (docs/02 D06): never shifted through UTC. */
export function localToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const at = new Date(Date.UTC(y, m - 1, d + days));
  return at.toISOString().slice(0, 10);
}

/** A new search: no airports yet, the next 30 days (today included), core's default cabins; every other condition at its default. */
export function blankDraft(today: string, sortBy: QueryObject["sort_by"] = "miles_asc"): QueryDraft {
  const from = today;
  const to = addDays(today, 29);
  return {
    query: {
      origins: [],
      destinations: [],
      date_from: from,
      date_to: to,
      cabins: [...DEFAULT_CABINS],
      direct_only: false,
      include_filtered: false,
      min_cabin_pct: DEFAULT_MIN_CABIN_PCT,
      sort_by: sortBy,
      raw_text: "",
      language: "en",
    },
    dates: { kind: "fixed", from, to },
  };
}

const ERROR_KEY: Record<DraftErrorCode, string> = {
  invalid_calendar_date: "workspace.q.err.invalid_calendar_date",
  end_before_start: "workspace.q.err.end_before_start",
  span_exceeds_core_limit: "workspace.q.err.span_exceeds_core_limit",
  invalid_relative_days: "workspace.q.err.invalid_calendar_date",
  required: "workspace.q.err.cabins_required",
  same_as_origin: "workspace.q.err.same_as_origin",
  ends_in_past: "workspace.q.err.ends_in_past",
  invalid_miles: "workspace.q.err.invalid_miles",
  unchosen_text: "workspace.q.err.origins_required",
};

/** Every broken field, in the bar's order (so the first can take focus), each as a dictionary key. */
export function queryErrors(draft: QueryDraft, texts: DraftTexts, today: string): QueryError[] {
  const errors: QueryError[] = [];
  const typed = { origins: codesFromText(texts.origins), destinations: codesFromText(texts.destinations) };
  for (const field of ["origins", "destinations"] as const) {
    const bad = typed[field].bad[0];
    if (bad) errors.push({ field, key: "workspace.q.unknown_code", vars: { code: bad } });
  }
  for (const error of validateDraft(draft, today)) {
    if (errors.some((e) => e.field === error.field)) continue;
    let key = ERROR_KEY[error.code];
    if (error.code === "required") key = error.field === "origins" ? "workspace.q.err.origins_required" : error.field === "destinations" ? "workspace.q.err.destinations_required" : "workspace.q.err.cabins_required";
    errors.push({ field: error.field, key, ...(error.code === "span_exceeds_core_limit" ? { vars: { days: String(MAX_SPAN_DAYS) } } : {}) });
  }
  const order: DraftField[] = ["origins", "destinations", "dates", "cabins", "max_miles"];
  return errors.sort((a, b) => order.indexOf(a.field) - order.indexOf(b.field));
}
