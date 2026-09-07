/**
 * Pure grid-page state: chip editing reducers, the shareable ?q= URL codec and number
 * formatting. No React, no DOM, no network — everything here is unit-tested.
 *
 * Chip edits always yield a VALID QueryObject (the executor's contract): removing the last
 * origin/cabin is a no-op, date edits are clamped to the 92-day cap, airport codes are
 * upper-cased and validated as IATA before they become chips.
 */
import type { AvailabilityRow, Grid, GridCell } from "@/lib/grid/types";
import { CABIN_ORDER, MAX_SPAN_DAYS, QueryObject, type Cabin, type SortBy } from "@/lib/query/schema";
import { SEATS_SOURCES } from "@/lib/seatsaero/types";

/**
 * The one canonical cabin order, spec §3.2's "J / F / W / Y". Both the toolbar's toggle and the
 * chip editor rewrite `cabins` into it, so the same set always reads the same way ("J, F"),
 * whichever control the user touched. It lives in the schema now (the per-cabin cell in
 * src/lib/grid/pivot.ts needs it, and a lib module must not import a component one); this
 * re-export keeps the component-layer name that the chip editors already import.
 */
export const ALL_CABINS: readonly Cabin[] = CABIN_ORDER;
export const SORT_OPTIONS: readonly SortBy[] = ["miles_asc", "fees_asc", "seats_desc", "date_asc"];

export type ChipAction =
  | { type: "add_origin"; code: string }
  | { type: "remove_origin"; code: string }
  | { type: "add_destination"; code: string }
  | { type: "remove_destination"; code: string }
  | { type: "set_dates"; date_from?: string; date_to?: string }
  | { type: "toggle_cabin"; cabin: Cabin }
  | { type: "set_direct_only"; value: boolean }
  | { type: "set_include_filtered"; value: boolean }
  | { type: "set_min_cabin_pct"; value: number }
  | { type: "set_max_miles"; value: number | null }
  | { type: "set_sort"; value: SortBy }
  | { type: "toggle_program"; program: string }
  | { type: "set_programs"; programs: string[] | null };

/** "hkg" → "HKG"; anything that is not exactly three letters → null. */
export function normalizeIata(input: string): string | null {
  const code = input.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

const DAY_MS = 86_400_000;

function parseDay(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

function formatDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Apply a date edit keeping date_from <= date_to and the span within MAX_SPAN_DAYS. The
 * field the user touched wins; the other bound moves if it has to.
 */
export function clampDates(current: { date_from: string; date_to: string }, edit: { date_from?: string; date_to?: string }): { date_from: string; date_to: string } {
  const fromRaw = edit.date_from ?? current.date_from;
  const toRaw = edit.date_to ?? current.date_to;
  let from = parseDay(fromRaw);
  let to = parseDay(toRaw);
  if (from === null || to === null) return { date_from: current.date_from, date_to: current.date_to };
  const maxSpan = (MAX_SPAN_DAYS - 1) * DAY_MS;
  if (edit.date_from !== undefined) {
    if (to < from) to = from;
    if (to - from > maxSpan) to = from + maxSpan;
  } else {
    if (from > to) from = to;
    if (to - from > maxSpan) from = to - maxSpan;
  }
  return { date_from: formatDay(from), date_to: formatDay(to) };
}

function addCode(list: readonly string[], raw: string): string[] {
  const code = normalizeIata(raw);
  if (!code || list.includes(code)) return [...list];
  return [...list, code];
}

function removeCode(list: readonly string[], code: string): string[] {
  if (list.length <= 1) return [...list]; // the query needs at least one
  return list.filter((c) => c !== code);
}

/** Pure reducer: returns a new, still-valid QueryObject (the input is never mutated). */
export function applyChipAction(q: QueryObject, action: ChipAction): QueryObject {
  switch (action.type) {
    case "add_origin":
      return { ...q, origins: addCode(q.origins, action.code) };
    case "remove_origin":
      return { ...q, origins: removeCode(q.origins, action.code) };
    case "add_destination":
      return { ...q, destinations: addCode(q.destinations, action.code) };
    case "remove_destination":
      return { ...q, destinations: removeCode(q.destinations, action.code) };
    case "set_dates":
      return { ...q, ...clampDates(q, action) };
    case "toggle_cabin": {
      const has = q.cabins.includes(action.cabin);
      if (has && q.cabins.length === 1) return { ...q, cabins: [...q.cabins] };
      const cabins = has ? q.cabins.filter((c) => c !== action.cabin) : ALL_CABINS.filter((c) => c === action.cabin || q.cabins.includes(c));
      return { ...q, cabins };
    }
    case "set_direct_only":
      return { ...q, direct_only: action.value };
    case "set_include_filtered":
      return { ...q, include_filtered: action.value };
    case "set_min_cabin_pct":
      // Always write the number, never delete the key (the set_direct_only pattern, not
      // set_max_miles): the field is a required number after the schema's .default(100).
      return { ...q, min_cabin_pct: action.value };
    case "set_max_miles": {
      const v = action.value;
      if (v === null || !Number.isFinite(v) || v <= 0) {
        const { max_miles: _drop, ...rest } = q;
        return rest;
      }
      return { ...q, max_miles: Math.floor(v) };
    }
    case "set_sort":
      return { ...q, sort_by: action.value };
    case "toggle_program": {
      const current = q.programs && q.programs.length > 0 ? q.programs : [];
      const next = current.includes(action.program) ? current.filter((p) => p !== action.program) : [...current, action.program];
      return setPrograms(q, next);
    }
    case "set_programs":
      return setPrograms(q, action.programs);
  }
}

/** Empty list or every known program = "all programs" (programs omitted). */
function setPrograms(q: QueryObject, programs: string[] | null): QueryObject {
  const { programs: _drop, ...rest } = q;
  if (!programs || programs.length === 0) return rest;
  const known = programs.filter((p) => (SEATS_SOURCES as readonly string[]).includes(p));
  if (known.length === 0 || known.length === SEATS_SOURCES.length) return rest;
  return { ...rest, programs: known };
}

/** True when two queries would produce the same grid (raw_text/language do not matter). */
export function sameQuery(a: QueryObject | null, b: QueryObject | null): boolean {
  if (a === null || b === null) return a === b;
  return canonicalJson(a) === canonicalJson(b);
}

function canonicalJson(q: QueryObject): string {
  return JSON.stringify({
    o: q.origins,
    d: q.destinations,
    f: q.date_from,
    t: q.date_to,
    c: [...q.cabins].sort(),
    p: q.programs ? [...q.programs].sort() : null,
    x: q.direct_only,
    i: q.include_filtered,
    // Absent and an explicit 100 are the SAME search: `?? 100` is what stops a user who opens
    // the Mixed cabin editor and leaves it alone from seeing the modified state for no reason.
    n: q.min_cabin_pct ?? 100,
    m: q.max_miles ?? null,
    s: q.sort_by,
  });
}

// ---------------------------------------------------------------------------
// Shareable URL: ?q=<base64url(JSON QueryObject)>
// ---------------------------------------------------------------------------

function utf8ToBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToUtf8(s: string): string | null {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  try {
    const bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function encodeQueryParam(q: QueryObject): string {
  return utf8ToBase64Url(JSON.stringify(q));
}

/** Decode + validate; null on any garbage (never throws). */
export function decodeQueryParam(value: string | null | undefined): QueryObject | null {
  if (!value) return null;
  const json = base64UrlToUtf8(value);
  if (json === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const parsed = QueryObject.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function gridHref(q: QueryObject | null): string {
  return q ? `/grid?q=${encodeQueryParam(q)}` : "/grid";
}

// Display formatting (miles, fees, seats) lives in src/lib/grid/format.ts — one formatter set
// for the cell, the tooltip, the aria label and the drawer (Intl in the viewer's locale).

/** Today's date in the browser's local calendar, YYYY-MM-DD. */
export function localToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ---------------------------------------------------------------------------
// Grid patching after Get Trips
// ---------------------------------------------------------------------------

/** Fees/booking link from Get Trips flow back into every cell row with that Availability ID. */
export function mergeTripsIntoGrid(grid: Grid, row: AvailabilityRow, result: { fees_cents: number | null; currency: string | null; booking_url: string | null }): Grid {
  const patch = (r: AvailabilityRow): AvailabilityRow =>
    r.source_id === row.source_id && r.cabin === row.cabin
      ? {
          ...r,
          fees_cents: result.fees_cents ?? r.fees_cents,
          currency: result.currency ?? r.currency,
          booking_url: result.booking_url ?? r.booking_url,
        }
      : r;
  const cells: GridCell[][] = grid.cells.map((line) =>
    line.map((cell) => {
      if (!cell.all.some((r) => r.source_id === row.source_id && r.cabin === row.cabin)) return cell;
      const all = cell.all.map(patch);
      return { ...cell, all, best: cell.best ? patch(cell.best) : null };
    }),
  );
  return { ...grid, cells };
}
