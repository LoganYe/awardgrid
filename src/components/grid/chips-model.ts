/**
 * The chip/query state model (Phase 6 §3.2, docs/UI_PLAN.md §6.2a and §7).
 *
 * Three queries exist at once and this file keeps them apart:
 *   - **parsed**  what `/api/parse` returned, plus its provenance. The baseline.
 *   - **draft**   what the chips currently say. Edits land here and nowhere else.
 *   - **run**     the query the grid on screen was produced from, and the one the URL encodes.
 *
 * `isModified(draft, parsed)` drives the accent outline, the Run affordance and the disabled
 * toolbar; `resetToParsed` restores the baseline. Everything here is pure: no React, no DOM, no
 * network. The eight chips are a typed list in the spec's order, so the chip row, the editors
 * and the aria labels all iterate the same source.
 */
import { formatRange, fromQueryDates, clampTo92 } from "@/components/grid/date-model";
import { programShortName } from "@/lib/grid/format";
import { DEFAULT_PLACES_INDEX, groupForEditor, type PlacesIndex } from "@/components/grid/places-index";
import type { I18nKey, Locale, Translate } from "@/lib/i18n";
import { DEFAULT_MIN_CABIN_PCT, MAX_SPAN_DAYS, type Cabin, type QueryObject, type SortBy } from "@/lib/query/schema";
import { SEATS_SOURCES, SOURCE_NAMES, type SeatsSource } from "@/lib/seatsaero/types";

// ---------------------------------------------------------------------------
// The eight chips
// ---------------------------------------------------------------------------

export type ChipId = "origins" | "destinations" | "dates" | "cabins" | "programs" | "direct_only" | "min_cabin_pct" | "sort";

/**
 * Spec §3.2 / docs/UI_PLAN.md §6.2a: the chips, always in this order. Seven until issue #18
 * added "Mixed cabin" at index 6 — after Direct only, keeping the two search-shaping toggles
 * together, and before Sort, which stays last as the only display-only chip.
 */
export const CHIP_ORDER = ["origins", "destinations", "dates", "cabins", "programs", "direct_only", "min_cabin_pct", "sort"] as const;

export interface ChipDef {
  id: ChipId;
  /** Dictionary key for the chip's label. */
  labelKey: I18nKey;
  /** QueryObject fields this chip owns — the provenance lookup and the modified diff use them. */
  fields: readonly (keyof QueryObject)[];
}

export const CHIPS: readonly ChipDef[] = [
  { id: "origins", labelKey: "grid.chips.origins", fields: ["origins"] },
  { id: "destinations", labelKey: "grid.chips.destinations", fields: ["destinations"] },
  { id: "dates", labelKey: "grid.chips.dates", fields: ["date_from", "date_to"] },
  { id: "cabins", labelKey: "grid.chips.cabins", fields: ["cabins"] },
  { id: "programs", labelKey: "grid.chips.programs", fields: ["programs"] },
  { id: "direct_only", labelKey: "grid.chips.direct_only", fields: ["direct_only"] },
  { id: "min_cabin_pct", labelKey: "grid.chips.min_cabin_pct", fields: ["min_cabin_pct"] },
  { id: "sort", labelKey: "grid.chips.sort", fields: ["sort_by"] },
];

const CHIP_BY_ID = new Map(CHIPS.map((c) => [c.id, c]));

export function chipDef(chip: ChipId): ChipDef {
  return CHIP_BY_ID.get(chip)!;
}

export function chipLabel(chip: ChipId, t: Translate): string {
  return t(chipDef(chip).labelKey);
}

/**
 * A query while the user is editing it. Looser than QueryObject on purpose: an editor may leave
 * origins or cabins empty for a moment, and the chip has to be able to say so.
 */
export interface QueryDraft {
  origins: readonly string[];
  destinations: readonly string[];
  date_from: string;
  date_to: string;
  cabins: readonly Cabin[];
  programs?: readonly string[];
  direct_only: boolean;
  include_filtered: boolean;
  /** seats.aero min_cabin_pct; 100 (the API default) means no mixed-cabin distance allowed. */
  min_cabin_pct: number;
  max_miles?: number;
  sort_by: SortBy;
  raw_text: string;
  language: string;
}

export interface ChipContext {
  locale: Locale;
  t: Translate;
  /** Programs the user's key can reach; defaults to every seats.aero source. */
  programsTotal?: number;
  places?: PlacesIndex;
}

// ---------------------------------------------------------------------------
// Value summaries
// ---------------------------------------------------------------------------

/**
 * "HKG, PVG/SHA, NRT/HND, ICN" — airports of the same city joined with "/", cities in the
 * order the query lists them. Only selected airports appear (Seoul with just ICN reads "ICN",
 * not "ICN/GMP").
 */
export function summarizeAirports(codes: readonly string[], places: PlacesIndex = DEFAULT_PLACES_INDEX): string {
  return groupForEditor(codes, places)
    .map((row) =>
      row.airports
        .filter((a) => a.selected)
        .map((a) => a.code)
        .join("/"),
    )
    .filter((s) => s.length > 0)
    .join(", ");
}

/** "Oct 1 – Oct 30 (30 days)"; zh wraps the count in full-width parentheses. */
export function summarizeDates(query: Pick<QueryDraft, "date_from" | "date_to">, ctx: ChipContext): string {
  // Both halves describe the CLAMPED window: the label and the count must name the same days,
  // and the days named are the ones seats.aero will actually search.
  const clamped = clampTo92(fromQueryDates(query));
  const range = { start: clamped.start, end: clamped.end };
  const label = formatRange(range, ctx.locale);
  const days = clamped.days;
  if (days <= 0) return label;
  const count = days === 1 ? ctx.t("grid.chips.days_one") : ctx.t("grid.chips.days", { n: days });
  return ctx.locale === "zh" ? `${label}（${count}）` : `${label} (${count})`;
}

/** "J, F" — the query's own cabin order, which is the order the parser reported. */
export function summarizeCabins(cabins: readonly Cabin[]): string {
  return cabins.join(", ");
}

/** Programs the query selected, or null for "every program the key can reach". */
export function selectedPrograms(query: Pick<QueryDraft, "programs">): readonly string[] | null {
  return query.programs && query.programs.length > 0 ? query.programs : null;
}

/** "all 24" · "Alaska, American" (≤ 2 selected) · "3 of 24". */
export function summarizePrograms(query: Pick<QueryDraft, "programs">, ctx: ChipContext): string {
  const total = ctx.programsTotal ?? SEATS_SOURCES.length;
  // One definition of "All" for the chip, the editor and the modified diff (isAllPrograms).
  if (isAllPrograms(query, total)) return ctx.t("grid.chips.programs_all_count", { n: total });
  const selected = selectedPrograms(query) ?? [];
  if (selected.length <= 2) return selected.map(programShortName).join(", ");
  return ctx.t("grid.chips.programs_count", { n: programCount(query, total), total });
}

/** The value summary for one chip, exactly as the chip row renders it. */
export function chipSummary(chip: ChipId, query: QueryDraft, ctx: ChipContext): string {
  const places = ctx.places ?? DEFAULT_PLACES_INDEX;
  switch (chip) {
    case "origins":
      return summarizeAirports(query.origins, places);
    case "destinations":
      return summarizeAirports(query.destinations, places);
    case "dates":
      return summarizeDates(query, ctx);
    case "cabins":
      return summarizeCabins(query.cabins);
    case "programs":
      return summarizePrograms(query, ctx);
    case "direct_only":
      return ctx.t(query.direct_only ? "grid.chips.on" : "grid.chips.off");
    case "min_cabin_pct":
      return summarizeMinCabinPct(query, ctx);
    case "sort":
      return ctx.t(SORT_LABEL_KEYS[query.sort_by]);
  }
}

/**
 * "not allowed" at 100, "any" at 0, "75% and up" otherwise. 100 reads as a STATE, not a number:
 * it is the API's own default and nobody chose the figure. It deliberately does NOT reuse
 * "off", the word the Direct only chip immediately to its left uses: there "off" means the
 * constraint is lifted, here 100 is the constraint at maximum and the reason a cell can read
 * "none", so the same word beside it would have said the opposite of what it means (issue #18).
 * Absent reads as 100 so a draft parsed from a pre-#18 payload is at rest, not silently
 * different.
 */
export function summarizeMinCabinPct(query: Pick<QueryDraft, "min_cabin_pct">, ctx: ChipContext): string {
  const pct = query.min_cabin_pct ?? DEFAULT_MIN_CABIN_PCT;
  if (pct === DEFAULT_MIN_CABIN_PCT) return ctx.t("grid.chips.mixed_cabin_none");
  if (pct === 0) return ctx.t("grid.chips.mixed_cabin_any");
  return ctx.t("grid.chips.mixed_cabin_min", { pct });
}

/**
 * The editor's hint, which has to carry the chosen figure: a fixed sentence about "less of the
 * distance" names no threshold at 100 and is simply false at 0, where nothing is dropped.
 */
export function mixedCabinHint(pct: number, ctx: Pick<ChipContext, "t">): string {
  if (pct === DEFAULT_MIN_CABIN_PCT) return ctx.t("grid.chips.mixed_cabin_hint_none");
  if (pct === 0) return ctx.t("grid.chips.mixed_cabin_hint_any");
  return ctx.t("grid.chips.mixed_cabin_hint_min", { pct });
}

const SORT_LABEL_KEYS: Record<SortBy, I18nKey> = {
  miles_asc: "grid.sort.miles_asc",
  fees_asc: "grid.sort.fees_asc",
  seats_desc: "grid.sort.seats_desc",
  date_asc: "grid.sort.date_asc",
};

/** Chip label + value summary, for the tooltip and the aria label. */
export function chipAriaLabel(chip: ChipId, query: QueryDraft, ctx: ChipContext): string {
  return `${chipLabel(chip, ctx.t)} ${chipSummary(chip, query, ctx)}`.trim();
}

// ---------------------------------------------------------------------------
// Modified state
// ---------------------------------------------------------------------------

const sortedCopy = (list: readonly string[]): string[] => [...list].sort();

/**
 * Per-chip equality. Origins and destinations compare in order (the order is the grid's column
 * order and the seats.aero preference order); cabins and programs compare as sets, so toggling
 * a cabin off and back on is not a change.
 */
function chipEqual(chip: ChipId, a: QueryDraft, b: QueryDraft): boolean {
  switch (chip) {
    case "origins":
      return a.origins.length === b.origins.length && a.origins.every((c, i) => c === b.origins[i]);
    case "destinations":
      return a.destinations.length === b.destinations.length && a.destinations.every((c, i) => c === b.destinations[i]);
    case "dates":
      return a.date_from === b.date_from && a.date_to === b.date_to;
    case "cabins":
      return JSON.stringify(sortedCopy(a.cabins)) === JSON.stringify(sortedCopy(b.cabins));
    case "programs": {
      const pa = selectedPrograms(a);
      const pb = selectedPrograms(b);
      if (pa === null || pb === null) return pa === pb;
      return JSON.stringify(sortedCopy(pa)) === JSON.stringify(sortedCopy(pb));
    }
    case "direct_only":
      return a.direct_only === b.direct_only;
    case "min_cabin_pct":
      // `?? 100` or the accent outline paints on a chip nobody touched whenever the parsed
      // baseline predates the field.
      return (a.min_cabin_pct ?? DEFAULT_MIN_CABIN_PCT) === (b.min_cabin_pct ?? DEFAULT_MIN_CABIN_PCT);
    case "sort":
      return a.sort_by === b.sort_by;
  }
}

/** The chips whose value differs from the parsed baseline, in chip order. Each gets the outline. */
export function modifiedChips(current: QueryDraft, parsed: QueryDraft | null): ChipId[] {
  if (parsed === null) return [];
  return CHIP_ORDER.filter((chip) => !chipEqual(chip, current, parsed));
}

/**
 * True when the draft would produce a different grid from the parsed baseline.
 * `raw_text` and `language` are ignored (they describe where the query came from, not what it
 * asks for), and so is object key order; the two fields that are not chips —
 * `include_filtered` (the toolbar switch) and `max_miles` — still count, because changing them
 * changes the results.
 */
export function isModified(current: QueryDraft, parsed: QueryDraft | null): boolean {
  if (parsed === null) return false;
  if (modifiedChips(current, parsed).length > 0) return true;
  return current.include_filtered !== parsed.include_filtered || (current.max_miles ?? null) !== (parsed.max_miles ?? null);
}

/** A fresh copy of the parser's output: "Reset to parsed" (spec §3.2). */
export function resetToParsed(parsed: QueryObject): QueryObject {
  return {
    ...parsed,
    origins: [...parsed.origins],
    destinations: [...parsed.destinations],
    cabins: [...parsed.cabins],
    ...(parsed.programs ? { programs: [...parsed.programs] } : {}),
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ChipValidation {
  /** True when the draft can be run. */
  valid: boolean;
  /** Chip → error message. An error blocks the run and colors the chip. */
  errors: Partial<Record<ChipId, string>>;
  /** Chip → note. A note is informational and never blocks a run (the 92-day cap). */
  notes: Partial<Record<ChipId, string>>;
}

/**
 * The 92-day cap is a NOTE, not an error (spec §3.2): the range still runs, clamped. Returns the
 * note text once the span reaches the cap, else null.
 */
export function capNote(query: Pick<QueryDraft, "date_from" | "date_to">, t: Translate): string | null {
  const { days, capped } = clampTo92(fromQueryDates(query));
  return capped || days >= MAX_SPAN_DAYS ? t("grid.chips.date_cap") : null;
}

/** Errors and notes for the whole draft, keyed by chip. */
export function validateQuery(query: QueryDraft, t: Translate): ChipValidation {
  const errors: Partial<Record<ChipId, string>> = {};
  const notes: Partial<Record<ChipId, string>> = {};
  if (query.origins.length === 0) errors.origins = t("grid.chips.at_least_one_airport");
  if (query.destinations.length === 0) errors.destinations = t("grid.chips.at_least_one_airport");
  if (query.cabins.length === 0) errors.cabins = t("grid.chips.at_least_one_cabin");
  if (query.date_to < query.date_from) errors.dates = t("grid.chips.date_order");
  const note = capNote(query, t);
  if (note !== null) notes.dates = note;
  return { valid: Object.keys(errors).length === 0, errors, notes };
}

// ---------------------------------------------------------------------------
// Programs
// ---------------------------------------------------------------------------

export interface ProgramOption {
  code: SeatsSource;
  /** "Alaska Mileage Plan" — the long name, for the editor list. */
  name: string;
  /** "Alaska" — the one- or two-word name the chip and the cell use. */
  short: string;
  selected: boolean;
}

export interface ProgramsContext {
  /** Free-text filter over the code, the long name and the short name. */
  search?: string;
  /** Currently selected codes; null or empty means "All". */
  selected?: readonly string[] | null;
}

/**
 * Every seats.aero program as an editor row, in the catalog's own order, each flagged with its
 * selection. "All" is the default and is represented by `programs` being absent from the query,
 * so every row comes back `selected: false` — the editor renders the "All" row as active.
 */
export function programsList(ctx: ProgramsContext = {}): ProgramOption[] {
  const selected = new Set(ctx.selected ?? []);
  const term = (ctx.search ?? "").trim().toLowerCase();
  const rows = SEATS_SOURCES.map((code) => ({
    code,
    name: SOURCE_NAMES[code],
    short: programShortName(code),
    selected: selected.has(code),
  }));
  if (term.length === 0) return rows;
  return rows.filter((r) => r.code.includes(term) || r.name.toLowerCase().includes(term) || r.short.toLowerCase().includes(term));
}

/**
 * Toggle one program. Empty and "everything" both collapse to null, the query's "All": the two
 * are the same search, and only one of them survives a round trip through QueryObject.
 */
export function toggleProgram(selected: readonly string[] | null, code: string, total: number = SEATS_SOURCES.length): string[] | null {
  const current = selected ?? [];
  const next = current.includes(code) ? current.filter((c) => c !== code) : [...current, code];
  return next.length === 0 || next.length >= total ? null : next;
}

/** Select every program, i.e. clear the filter. */
export function selectAllPrograms(): null {
  return null;
}

/** How many programs the query covers: the selection, or the whole catalog for "All". */
export function programCount(query: Pick<QueryDraft, "programs">, total: number = SEATS_SOURCES.length): number {
  return selectedPrograms(query)?.length ?? total;
}

/** True when the query means "every program" (the "All" row is the active one). */
export function isAllPrograms(query: Pick<QueryDraft, "programs">, total: number = SEATS_SOURCES.length): boolean {
  const selected = selectedPrograms(query);
  return selected === null || selected.length >= total;
}
