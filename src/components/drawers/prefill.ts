/**
 * "Save as standing query", prefilled from a grid cell (spec §3.5: the cell drawer's third
 * action is "Save as standing query (prefilled to this route and a ±3-day window)").
 *
 * The cell drawer knows one square — one origin, one destination, one date. A standing query
 * that watched exactly that square would notify on almost nothing, so the prefill keeps the
 * cell's route and opens the date to the week around it; every other field (cabins, programs,
 * direct only, dynamic pricing, sort) is inherited from the query the grid is showing, because
 * that is what the user is looking at.
 *
 * Pure module — no React, no network. Unit tested in prefill.test.ts.
 */
import { cabinSummary, NAME_MAX_LENGTH } from "@/components/queries/format";
import { MAX_SPAN_DAYS, type QueryObject } from "@/lib/query/schema";

/** ±3 days around the cell (spec §3.5) — a 7-day window. */
export const PREFILL_WINDOW_DAYS = 3;

/** The three fields that address a grid cell. */
export interface PrefillCell {
  origin: string;
  dest: string;
  date: string;
}

/** What SaveQueryDialog accepts as its `prefill`. */
export interface QueryPrefill {
  query: QueryObject;
  name?: string;
}

const DAY_MS = 86_400_000;

/** `iso` + `days` calendar days, UTC arithmetic. Returns `iso` unchanged if it is not a date. */
function addDays(iso: string, days: number): string {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms + days * DAY_MS).toISOString().slice(0, 10);
}

function maxDate(a: string, b: string): string {
  return a >= b ? a : b;
}

/**
 * A standing-query name that says what is being watched: route, cabins, and the cell's own date
 * (the window is ±3 days around it, so the date is the thing worth naming). Trimmed to the
 * dialog's 60-character limit, like `defaultQueryName`.
 */
export function prefillNameFromCell(cell: PrefillCell, query: Pick<QueryObject, "cabins">, max: number = NAME_MAX_LENGTH): string {
  const name = `${cell.origin} → ${cell.dest} ${cabinSummary(query)} ${cell.date}`;
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

/**
 * Build the prefill for one cell.
 *
 * `today` is optional and, when given, clamps the start of the window: a standing query that
 * begins in the past would spend seats.aero calls on dates nobody can book. The end of the
 * window is never pulled below the start, so a cell in the past still yields a valid range.
 * `raw_text` is carried over unchanged — it records what the user typed, and this query was
 * derived from a click, not from new text.
 */
export function prefillFromCell(cell: PrefillCell, baseQuery: QueryObject, today?: string): QueryPrefill {
  const from = addDays(cell.date, -PREFILL_WINDOW_DAYS);
  const start = today ? maxDate(from, today) : from;
  const end = maxDate(addDays(cell.date, PREFILL_WINDOW_DAYS), start);
  const query: QueryObject = {
    ...baseQuery,
    origins: [cell.origin],
    destinations: [cell.dest],
    date_from: start,
    // The window is 7 days, well inside the cap; clamped anyway so a future wider window cannot
    // silently produce a QueryObject the schema rejects.
    date_to: maxDate(start, end <= addDays(start, MAX_SPAN_DAYS - 1) ? end : addDays(start, MAX_SPAN_DAYS - 1)),
  };
  return { query, name: prefillNameFromCell(cell, baseQuery) };
}
