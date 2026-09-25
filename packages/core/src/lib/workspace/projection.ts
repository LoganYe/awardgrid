/**
 * One projection of one snapshot, read by every view (UI/UX v1 T08; docs/03 §2 projectResults; decisions D07).
 *
 * List, Calendar and Matrix are three readings of the same answer: the rows the local filter lets through, in the
 * view's sort; each calendar day of the query's range for one cabin, with the keys of the rows behind its minimum;
 * and one matrix cell per route, day and cabin with rows, holding exactly those rows. A number a view shows can
 * therefore always be opened to the rows that make it. Pure: no fetching, no clock, the snapshot is not touched.
 *
 * The honesty rules:
 *
 *   - **The local filter narrows what is shown, not what was proven.** Coverage passes through unchanged, and the
 *     count of hidden rows is reported so a view can say "hidden by your filter" rather than "no results".
 *   - **Sorting compares raw values in their own units** — no valuation across programs. Fees compare only within one
 *     currency: each currency is its own group (by code), then amounts with no currency, then unknown fees; no
 *     exchange rate is assumed. A seat count not provided sorts after every known count, never as "most".
 *   - **An empty day is "no matches" only where every monitored route was checked to the end** for that day, cabin
 *     and every program asked, and the snapshot's own verdict is not unknown; a day with no monitored route is "not
 *     monitored"; otherwise it is partial or unknown, and a minimum there is only the lowest retrieved. A day or cell
 *     whose rows the local filter hides carries that count, so it is never mistaken for an empty one.
 */
import { enumerateDates } from "../grid/pivot";
import { programDisplayName } from "../grid/ranking";
import type { AvailabilityRow } from "../grid/types";
import { CABIN_ORDER, type Cabin, type QueryObject } from "../query/schema";
import { feesState, knownSeats } from "./semantics";
import type { MatrixModel, MatrixSlot, ProjectedCell, ProjectedDay, ProjectedResults, ResultSnapshot, ViewPreferences, WorkspaceRow } from "./types";

/** The calendar's cabin: the one chosen, if the query asked for it; else the query's first in cabin order (D07). */
export function calendarCabinFor(query: Pick<QueryObject, "cabins">, chosen: Cabin): Cabin {
  if (query.cabins.includes(chosen)) return chosen;
  return CABIN_ORDER.find((c) => query.cabins.includes(c)) ?? chosen;
}

/** The fee group a row sorts in: its currency code, "currency_unknown" (an amount without one), or "unknown". */
export function feeGroup(row: Pick<AvailabilityRow, "fees_cents" | "currency">): string {
  const fees = feesState(row.fees_cents, row.currency);
  return fees.kind === "known" ? fees.currency : fees.kind === "currency_missing" ? "currency_unknown" : "unknown";
}

type Cmp = (a: WorkspaceRow, b: WorkspaceRow) => number;

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Group rank: a known currency (by code), then an amount without a currency, then unknown. */
function feeRank(row: AvailabilityRow): [number, string, number] {
  const fees = feesState(row.fees_cents, row.currency);
  if (fees.kind === "known") return [0, fees.currency, fees.cents];
  if (fees.kind === "currency_missing") return [1, "", fees.cents];
  return [2, "", 0];
}

const byFees: Cmp = (a, b) => {
  const [ga, ca, xa] = feeRank(a.value);
  const [gb, cb, xb] = feeRank(b.value);
  return ga - gb || cmpStr(ca, cb) || xa - xb;
};
const byMiles: Cmp = (a, b) => a.value.miles - b.value.miles;
/** Known counts, most first; a count not provided after all of them. */
const bySeats: Cmp = (a, b) => (knownSeats(b.value.seats_left) ?? -1) - (knownSeats(a.value.seats_left) ?? -1);
const byDate: Cmp = (a, b) => cmpStr(a.value.date, b.value.date);
const byProgram: Cmp = (a, b) => cmpStr(programDisplayName(a.value.program), programDisplayName(b.value.program)) || cmpStr(a.value.program, b.value.program);
/** Route, cabin order, then the row key: equal rows keep one order whatever order they arrive in. */
const byTail: Cmp = (a, b) =>
  cmpStr(a.value.origin, b.value.origin) ||
  cmpStr(a.value.dest, b.value.dest) ||
  CABIN_ORDER.indexOf(a.value.cabin) - CABIN_ORDER.indexOf(b.value.cabin) ||
  cmpStr(a.key, b.key);

function chain(...cmps: Cmp[]): Cmp {
  return (a, b) => {
    for (const cmp of cmps) {
      const r = cmp(a, b);
      if (r !== 0) return r;
    }
    return 0;
  };
}

const COMPARATORS: Record<ViewPreferences["sort"], Cmp> = {
  miles_asc: chain(byMiles, byFees, bySeats, byProgram, byDate, byTail),
  fees_asc: chain(byFees, byMiles, bySeats, byProgram, byDate, byTail),
  seats_desc: chain(bySeats, byMiles, byFees, byProgram, byDate, byTail),
  date_asc: chain(byDate, byMiles, byFees, bySeats, byProgram, byTail),
};

/** The view's order for rows (List, and a calendar day's rows). A total order. */
export function sortRows(rows: readonly WorkspaceRow[], sort: ViewPreferences["sort"]): WorkspaceRow[] {
  return [...rows].sort(COMPARATORS[sort]);
}

/**
 * The query's own row conditions, as the grid applies them (pivot.ts rowMatchesQuery, isHiddenDynamic): its cabins,
 * its programs (none listed = all), its mileage cap, nonstop when asked, and dynamic pricing only when asked. A row
 * outside them is not part of the answer to this query, whatever the cache held.
 */
function inQuery(row: AvailabilityRow, query: QueryObject): "in" | "dynamic" | "out" {
  if (!query.cabins.includes(row.cabin)) return "out";
  if (query.programs && query.programs.length > 0 && !query.programs.includes(row.program)) return "out";
  if (query.max_miles !== undefined && row.miles > query.max_miles) return "out";
  if (query.direct_only && !row.direct) return "out";
  if (row.dynamic === true && !query.include_filtered) return "dynamic";
  return "in";
}

function passesFilter(row: AvailabilityRow, filter: ViewPreferences["localFilter"]): boolean {
  if (filter.maxMiles !== undefined && row.miles > filter.maxMiles) return false;
  if (filter.onlyKnownSeats && knownSeats(row.seats_left) === null) return false;
  return true;
}

/** Weakest first; "unmonitored" joins as the strongest, so a day is unmonitored only when every route is. */
const STRENGTH = { unknown: 0, partial: 1, complete: 2, unmonitored: 3 } as const;
type DayCoverage = ProjectedDay["coverage"];
const weaker = (a: DayCoverage, b: DayCoverage): DayCoverage => (STRENGTH[b] < STRENGTH[a] ? b : a);

/**
 * What the snapshot proved for one route, day and cabin. For each program asked (all programs = only a slice for all
 * programs proves it, as coverage.ts provesScope), the slices covering the day and cabin decide: none or any unknown
 * → unknown; all unmonitored → unmonitored; all complete or unmonitored → complete; else partial. The route takes the
 * weakest program, and is unknown whenever the snapshot's own verdict is.
 */
function routeCoverage(snapshot: ResultSnapshot, origin: string, destination: string, date: string, cabin: Cabin): DayCoverage {
  if (snapshot.coverage.state === "unknown") return "unknown";
  const asked = snapshot.query.programs && snapshot.query.programs.length > 0 ? [...new Set(snapshot.query.programs)] : [null];
  let route: DayCoverage = "unmonitored";
  for (const program of asked) {
    const slices = snapshot.coverage.slices.filter(
      (s) =>
        s.origin === origin &&
        s.destination === destination &&
        s.dateFrom <= date &&
        date <= s.dateTo &&
        s.cabins.includes(cabin) &&
        (s.programs === null || (program !== null && s.programs.includes(program))),
    );
    let state: DayCoverage;
    if (slices.length === 0 || slices.some((s) => s.state === "unknown")) state = "unknown";
    else if (slices.every((s) => s.state === "unmonitored")) state = "unmonitored";
    else if (slices.every((s) => s.state === "complete" || s.state === "unmonitored")) state = "complete";
    else state = "partial";
    route = weaker(route, state);
  }
  return route;
}

/** A calendar day takes the weakest of its routes: "unmonitored" only when no route is monitored. */
function dayCoverage(snapshot: ResultSnapshot, date: string, cabin: Cabin): DayCoverage {
  let day: DayCoverage = "unmonitored";
  for (const origin of snapshot.query.origins) {
    for (const destination of snapshot.query.destinations) day = weaker(day, routeCoverage(snapshot, origin, destination, date, cabin));
  }
  return day;
}

export function projectResults(snapshot: ResultSnapshot, prefs: ViewPreferences): ProjectedResults {
  const kept: WorkspaceRow[] = [];
  const hidden: WorkspaceRow[] = [];
  let dynamicNotShown = 0;
  for (const row of snapshot.rows) {
    const verdict = inQuery(row.value, snapshot.query);
    if (verdict !== "in") {
      if (verdict === "dynamic") dynamicNotShown += 1;
      continue;
    }
    (passesFilter(row.value, prefs.localFilter) ? kept : hidden).push(row);
  }
  const rows = sortRows(kept, prefs.sort);
  const count = (key: (r: AvailabilityRow) => string) => {
    const counts = new Map<string, number>();
    for (const row of hidden) counts.set(key(row.value), (counts.get(key(row.value)) ?? 0) + 1);
    return counts;
  };

  const cabin = calendarCabinFor(snapshot.query, prefs.calendarCabin);
  const byDay = new Map<string, WorkspaceRow[]>();
  for (const row of rows) {
    if (row.value.cabin !== cabin) continue;
    const list = byDay.get(row.value.date);
    if (list) list.push(row);
    else byDay.set(row.value.date, [row]);
  }
  const hiddenByDay = count((r) => (r.cabin === cabin ? r.date : ""));
  const days: ProjectedDay[] = enumerateDates(snapshot.query.date_from, snapshot.query.date_to).map((date) => {
    // Sorted by miles within the day, whatever the list's sort: the day's first key is its minimum.
    const dayRows = sortRows(byDay.get(date) ?? [], "miles_asc");
    return {
      date,
      cabin,
      rowKeys: dayRows.map((r) => r.key),
      minMiles: dayRows.length > 0 ? dayRows[0]!.value.miles : null,
      coverage: dayCoverage(snapshot, date, cabin),
      hidden: hiddenByDay.get(date) ?? 0,
    };
  });

  const byCell = new Map<string, ProjectedCell>();
  const cellOf = (r: AvailabilityRow): ProjectedCell => {
    const id = `${r.date}|${r.origin}|${r.dest}|${r.cabin}`;
    let cell = byCell.get(id);
    if (!cell) byCell.set(id, (cell = { origin: r.origin, dest: r.dest, date: r.date, cabin: r.cabin, rowKeys: [], hidden: 0 }));
    return cell;
  };
  for (const row of sortRows(rows, "miles_asc")) cellOf(row.value).rowKeys.push(row.key);
  for (const row of hidden) cellOf(row.value).hidden += 1;
  const cells = [...byCell.values()].sort(
    (a, b) => cmpStr(a.date, b.date) || cmpStr(a.origin, b.origin) || cmpStr(a.dest, b.dest) || CABIN_ORDER.indexOf(a.cabin) - CABIN_ORDER.indexOf(b.cabin),
  );

  return { rows, days, cells, coverage: snapshot.coverage, hiddenByFilter: hidden.length, dynamicNotShown };
}

// ---- the matrix (T09) ------------------------------------------------------------------------------------------

/**
 * The phone matrix's columns (docs/04 S03): an 88 pt date column, then as many whole data columns of at least 124 as
 * fit — at least one, and no more than there are routes — sharing the rest equally. `contentWidth` is the width
 * inside the page gutters (358 at 390). Larger text (`scale`, --ag-text-scale) widens both minimums, so the columns
 * get fewer and wider rather than their text spilling into the next one. Where even one data column would be too
 * narrow for a seven-figure miles value ("110,000": about 4.2 em of the slot's 16 × scale figures, plus the cell's 24 of
 * padding) — 320 at 160–200% — the date column gives way to it, down to 88, so no figure runs out of its cell (docs/04:
 * never cut a mileage; T21 review 2). At 100% text docs/04's 88 stands.
 */
export function mobileColumns(contentWidth: number, routes = Number.POSITIVE_INFINITY, scale = 1): { date: number; count: number; width: number } {
  const s = Math.max(1, scale);
  const figure = Math.ceil(4.2 * 16 * s) + 24;
  const date = s > 1 ? Math.min(Math.round(88 * s), Math.max(88, Math.floor(contentWidth - figure))) : 88;
  const fit = Math.max(1, Math.floor((contentWidth - date) / (124 * s)));
  const count = Math.max(1, Math.min(fit, routes));
  return { date, count, width: Math.round(((contentWidth - date) / count) * 100) / 100 };
}

/**
 * The matrix from the same projection: the query's dates by its routes (query order), each cell one slot per cabin
 * asked (cabin order). A slot shows its lowest miles (the projection's miles order: ties by fees within one currency,
 * never across); an empty slot says why — the view filter hid its rows, or what the search proved for that route,
 * day and cabin. Pure; nothing is fetched.
 */
export function matrixModel(snapshot: ResultSnapshot, projected: ProjectedResults): MatrixModel {
  const q = snapshot.query;
  const dates = enumerateDates(q.date_from, q.date_to);
  const routes = q.origins.flatMap((origin) => q.destinations.map((dest) => ({ origin, dest })));
  const cabins = CABIN_ORDER.filter((c) => q.cabins.includes(c));
  const byCell = new Map(projected.cells.map((c) => [`${c.date}|${c.origin}|${c.dest}|${c.cabin}`, c]));
  const cells = dates.map((date) =>
    routes.map(({ origin, dest }) => ({
      origin,
      dest,
      date,
      slots: cabins.map((cabin): MatrixSlot => {
        const cell = byCell.get(`${date}|${origin}|${dest}|${cabin}`);
        const rowKeys = cell?.rowKeys ?? [];
        const hidden = cell?.hidden ?? 0;
        const coverage = routeCoverage(snapshot, origin, dest, date, cabin);
        if (rowKeys.length > 0) return { cabin, rowKeys, best: rowKeys[0]!, hidden, state: "results", coverage };
        return { cabin, rowKeys, best: null, hidden, state: hidden > 0 ? "hidden" : coverage, coverage };
      }),
    })),
  );
  return { dates, routes, cabins, cells };
}
