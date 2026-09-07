/**
 * The one sentence under the toolbar while a search is in flight (spec §3.4, docs/UI_PLAN.md §6.2 and §11).
 *
 * Spec §3.4 asks for a per-program tally ("Alaska ✓ American ✓ Aeroplan …"). It cannot be
 * written honestly: `planFind` sends ONE Cached Search request whose `sources` parameter is the
 * whole comma-joined program list (and is omitted entirely — all 26 programs — when the query
 * names none), so no program ever "arrives" before the others. Splitting the request per program
 * would multiply the daily quota by up to 26 and permanently disable the cache, whose coverage
 * rows are keyed on the exact sorted program set. See DECISIONS.md "Progressive per-program fill".
 *
 * So the line says what is being ASKED, never what has answered:
 *
 *   no query yet       →  "Searching seats.aero…" (the plain fallback)
 *   no programs named  →  "Asking seats.aero about all 26 mileage programs…"
 *   1–3 named          →  "Asking seats.aero about Alaska Mileage Plan and Air Canada Aeroplan…"
 *   4 or more          →  "Asking seats.aero about 7 mileage programs…"
 *   after 12 s         →  "Still asking seats.aero. Wide date ranges take longer."
 *
 * The last one REPLACES the sentence rather than appending to it: the line stays one sentence,
 * so a screen reader's polite re-announcement is a sentence and not a growing paragraph.
 *
 * Pure and locale-only so it can be unit-tested without a DOM (vitest runs `src/**\/*.test.ts`
 * in a node environment); the component that renders it lives in `toolbar.tsx`.
 */
import { intlLocale } from "@/lib/grid/format";
import type { I18nKey, Locale, TranslateVars } from "@/lib/i18n";
import type { QueryObject } from "@/lib/query/schema";
import { SEATS_SOURCES, SOURCE_NAMES } from "@/lib/seatsaero/types";

/** All the sentence needs from the query being run; null while there is no query to describe. */
export type SearchingQuery = Pick<QueryObject, "programs"> | null;

/** Named programs listed by name up to this many; beyond it the sentence gives a count. */
export const SEARCHING_NAMED_MAX = 3;

/** After this long the sentence is swapped for the "still going" one. */
export const SEARCHING_SLOW_AFTER_SECONDS = 12;

export interface SearchingSentence {
  key: I18nKey;
  vars?: TranslateVars;
}

/** Whole seconds since the search started; never negative, never NaN. */
export function elapsedSeconds(startedAt: number, now: number): number {
  if (!Number.isFinite(startedAt) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

/** Long program names in the locale's own list punctuation ("A, B and C" / "A、B和C"). */
export function programList(programs: readonly string[], locale: Locale): string {
  const names = programs.map((p) => (SOURCE_NAMES as Record<string, string>)[p] ?? p);
  return new Intl.ListFormat(intlLocale(locale), { style: "long", type: "conjunction" }).format(names);
}

/**
 * The sentence for a search that has been running `elapsed` seconds over `query`.
 *
 * `query` is null when there is nothing to describe yet, and that is NOT the same claim as a
 * query that simply names no programs: the first says nothing, the second says "all 26". They
 * are told apart by the argument being the query itself rather than its `programs` field —
 * `QueryObject.programs` is optional, so "every program" reaches us as `undefined` and a bare
 * `undefined` could not carry both meanings.
 *
 * The seconds are NOT part of the sentence — they are rendered in an aria-hidden sibling, so the
 * live region only changes when the wording does.
 */
export function searchingSentence(query: SearchingQuery, elapsed: number, locale: Locale): SearchingSentence {
  if (elapsed >= SEARCHING_SLOW_AFTER_SECONDS) return { key: "grid.searching_slow" };
  if (query === null) return { key: "grid.searching" };
  const programs = query.programs;
  if (programs === undefined || programs.length === 0) return { key: "grid.searching_all", vars: { n: SEATS_SOURCES.length } };
  if (programs.length <= SEARCHING_NAMED_MAX) return { key: "grid.searching_named", vars: { programs: programList(programs, locale) } };
  return { key: "grid.searching_some", vars: { n: programs.length } };
}
