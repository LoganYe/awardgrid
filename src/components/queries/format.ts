/**
 * Pure helpers for the saved-queries UI: route summaries, default names, cron presets and the
 * human "every 3 h" rendering, the SaveQueryDialog form reducer, and the Queries page's
 * wording (run results, relative times, the next-run fallback and the diff rows the grid cell
 * renders). No React, no DOM, no network — unit-tested in format.test.ts. Safe to import from
 * server and client code.
 */
import { formatPillDateRange } from "@/components/ask/labels";
import { intlLocale, type FormatLocale } from "@/lib/grid/format";
import type { AvailabilityRow, GridCell } from "@/lib/grid/types";
import { hasKey, type Translate } from "@/lib/i18n";
import type { Cabin, QueryObject } from "@/lib/query/schema";
// Type-only: the runtime module pulls node-cron, which must never reach the browser bundle.
import type { CronDescription as ScheduleShape } from "@/lib/scheduler/cron";

// ---------------------------------------------------------------------------
// Route / name summaries
// ---------------------------------------------------------------------------

/** "HKG,PVG,NRT" → "HKG,PVG…" when more than `max` codes. */
export function joinCodes(codes: readonly string[], max = 3): string {
  if (codes.length <= max) return codes.join(",");
  return `${codes.slice(0, max).join(",")}…`;
}

/** "HKG,PVG… → SEA" — the route column of the table. */
export function routeSummary(query: Pick<QueryObject, "origins" | "destinations">, max = 3): string {
  return `${joinCodes(query.origins, max)} → ${joinCodes(query.destinations, max)}`;
}

/** "J,F" — cabins in the fixed F/J/W/Y order. */
export function cabinSummary(query: Pick<QueryObject, "cabins">): string {
  const order = ["F", "J", "W", "Y"];
  return [...query.cabins].sort((a, b) => order.indexOf(a) - order.indexOf(b)).join(",");
}

/** "2026-10-01 → 2026-10-30" */
export function dateSummary(query: Pick<QueryObject, "date_from" | "date_to">): string {
  return query.date_from === query.date_to ? query.date_from : `${query.date_from} → ${query.date_to}`;
}

/** Default name for the save dialog, e.g. "HKG,PVG… → SEA F" (≤ 60 chars). */
export function defaultQueryName(query: Pick<QueryObject, "origins" | "destinations" | "cabins">, max = 60): string {
  const name = `${routeSummary(query)} ${cabinSummary(query)}`;
  return name.length > max ? name.slice(0, max - 1) + "…" : name;
}

/**
 * What a standing query will actually watch, in words: "PVG to SEA, Sep 7–13, business and
 * first". The save dialog shows it because the query being saved is not always the query on
 * screen — from the cell drawer it is one route over a ±3-day window (spec §3.5) — and §1.3 says
 * a button says exactly what happens.
 *
 * `formatPillDateRange` is the Ask pill's range formatter, reused rather than re-derived: both
 * places print the same window to the same reader.
 */
export function queryScopeSummary(query: QueryObject, t: Translate, locale: FormatLocale): string {
  const route = t("grid.drawer.route", { origin: query.origins.join(", "), dest: query.destinations.join(", ") });
  const dates = formatPillDateRange(query.date_from, query.date_to, locale);
  const order = ["F", "J", "W", "Y"];
  const names = [...query.cabins].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((c) => t(`grid.cabin.${c}`));
  let cabins: string;
  try {
    cabins = new Intl.ListFormat(intlLocale(locale), { style: "long", type: "conjunction" }).format(names);
  } catch {
    cabins = names.join(locale === "zh" ? "、" : ", ");
  }
  return t("saved.dialog.scope", { route, dates, cabins });
}

// ---------------------------------------------------------------------------
// Cron presets + human rendering
// ---------------------------------------------------------------------------

export type { ScheduleShape };

export type CronPresetId = "every_3h" | "every_6h" | "every_12h" | "daily_08" | "custom";

export interface CronPreset {
  id: Exclude<CronPresetId, "custom">;
  cron: string;
}

/** Kickoff §12: every 3 h is the default. */
export const CRON_PRESETS: readonly CronPreset[] = [
  { id: "every_3h", cron: "0 */3 * * *" },
  { id: "every_6h", cron: "0 */6 * * *" },
  { id: "every_12h", cron: "0 */12 * * *" },
  { id: "daily_08", cron: "0 8 * * *" },
];

export const DEFAULT_PRESET: CronPreset = CRON_PRESETS[0]!;

/** Which preset a stored cron corresponds to ("custom" when none). */
export function presetForCron(cron: string): CronPresetId {
  const norm = cron.trim().replace(/\s+/g, " ");
  return CRON_PRESETS.find((p) => p.cron === norm)?.id ?? "custom";
}

export type CronDescription =
  | { kind: "every_hours"; hours: number }
  | { kind: "hourly" }
  | { kind: "daily"; time: string }
  | { kind: "custom"; cron: string };

/**
 * Human description of the common 5-field shapes: `M *&#47;N * * *` → every N h, `M H * * *` →
 * daily at HH:MM, `M * * * *` → hourly; anything else is shown as the raw expression.
 */
export function describeCron(cron: string): CronDescription {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return { kind: "custom", cron: cron.trim() };
  const [minute, hour, dom, month, dow] = parts as [string, string, string, string, string];
  const simpleMinute = /^\d{1,2}$/.test(minute);
  const rest = dom === "*" && month === "*" && dow === "*";
  if (!simpleMinute || !rest) return { kind: "custom", cron: cron.trim() };
  const every = /^\*\/(\d{1,2})$/.exec(hour);
  if (every) {
    const n = Number(every[1]);
    return n === 1 ? { kind: "hourly" } : { kind: "every_hours", hours: n };
  }
  if (hour === "*") return { kind: "hourly" };
  if (/^\d{1,2}$/.test(hour)) {
    return { kind: "daily", time: `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}` };
  }
  return { kind: "custom", cron: cron.trim() };
}

/** Client-side mirror of the server's cron rule: 5 fields, single-value minute (≤ hourly). */
export function looksLikeValidCron(cron: string): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  if (!/^\d{1,2}$/.test(parts[0]!) || Number(parts[0]) > 59) return false;
  return parts.every((p) => /^[\d*,\-/]+$/.test(p));
}

// ---------------------------------------------------------------------------
// Save / edit dialog form state (reducer)
// ---------------------------------------------------------------------------

export type NotifyRule = "new_cells" | "price_drop" | "both";

export interface QueryFormState {
  name: string;
  preset: CronPresetId;
  customCron: string;
  notifyOn: NotifyRule;
  thresholdPct: number;
}

export type QueryFormAction =
  | { type: "set_name"; value: string }
  | { type: "set_preset"; value: CronPresetId }
  | { type: "set_custom_cron"; value: string }
  | { type: "set_notify"; value: NotifyRule }
  | { type: "set_threshold"; value: number }
  | { type: "reset"; state: QueryFormState };

export const THRESHOLD_RANGE = { min: 1, max: 90 } as const;
export const NAME_MAX_LENGTH = 60;

/** Initial state for a NEW standing query (§12 defaults). */
export function initialFormState(query: Pick<QueryObject, "origins" | "destinations" | "cabins">): QueryFormState {
  return { name: defaultQueryName(query), preset: DEFAULT_PRESET.id, customCron: "", notifyOn: "both", thresholdPct: 10 };
}

/** Initial state when EDITING an existing saved query. */
export function formStateFrom(saved: { name: string; schedule_cron: string; notify_on: NotifyRule; drop_threshold_pct: number }): QueryFormState {
  const preset = presetForCron(saved.schedule_cron);
  return {
    name: saved.name,
    preset,
    customCron: preset === "custom" ? saved.schedule_cron : "",
    notifyOn: saved.notify_on,
    thresholdPct: saved.drop_threshold_pct,
  };
}

export function queryFormReducer(state: QueryFormState, action: QueryFormAction): QueryFormState {
  switch (action.type) {
    case "set_name":
      return { ...state, name: action.value.slice(0, NAME_MAX_LENGTH) };
    case "set_preset":
      return { ...state, preset: action.value };
    case "set_custom_cron":
      return { ...state, customCron: action.value.slice(0, 64) };
    case "set_notify":
      return { ...state, notifyOn: action.value };
    case "set_threshold": {
      if (!Number.isFinite(action.value)) return state;
      const v = Math.round(action.value);
      return { ...state, thresholdPct: Math.min(THRESHOLD_RANGE.max, Math.max(THRESHOLD_RANGE.min, v)) };
    }
    case "reset":
      return action.state;
    default:
      return state;
  }
}

/** The cron the form currently denotes. */
export function formCron(state: QueryFormState): string {
  if (state.preset === "custom") return state.customCron.trim().replace(/\s+/g, " ");
  return CRON_PRESETS.find((p) => p.id === state.preset)?.cron ?? DEFAULT_PRESET.cron;
}

export type FormProblem = "name" | "cron" | "threshold";

/** Client-side validation mirroring the route's zod schema; empty array = submittable. */
export function formProblems(state: QueryFormState): FormProblem[] {
  const problems: FormProblem[] = [];
  const name = state.name.trim();
  if (name.length < 1 || name.length > NAME_MAX_LENGTH) problems.push("name");
  if (state.preset === "custom" && !looksLikeValidCron(state.customCron)) problems.push("cron");
  if (state.thresholdPct < THRESHOLD_RANGE.min || state.thresholdPct > THRESHOLD_RANGE.max) problems.push("threshold");
  return problems;
}

/** Body for POST /api/queries (create) — the query is attached by the caller. */
export function formToBody(state: QueryFormState): { name: string; schedule_cron: string; notify_on: NotifyRule; drop_threshold_pct: number } {
  return { name: state.name.trim(), schedule_cron: formCron(state), notify_on: state.notifyOn, drop_threshold_pct: state.thresholdPct };
}

// ---------------------------------------------------------------------------
// Queries page (spec §4): schedule / skip / result wording, relative times,
// the next-run fallback, and the last diff's cells
// ---------------------------------------------------------------------------

/**
 * "every 3 hours" / "hourly" / "daily at 08:00", or the expression itself when it is none of
 * those. The API classifies the schedule for us (`SavedQuerySummary.schedule_label`, from the
 * scheduler's own cron parser) and never returns English; passing it keeps the label and the
 * worker's reading of the expression in step. Without one, the local `describeCron` covers the
 * same three shapes.
 */
export function scheduleText(t: Translate, cron: string, label?: ScheduleShape): string {
  if (label) {
    switch (label.kind) {
      case "every_hours":
        return label.n === 1 ? t("saved.schedule.hourly") : t("saved.schedule.every_hours", { hours: label.n });
      case "daily":
        return t("saved.schedule.daily", { time: `${String(label.hh).padStart(2, "0")}:${String(label.mm).padStart(2, "0")}` });
      default:
        return label.expr;
    }
  }
  const d = describeCron(cron);
  switch (d.kind) {
    case "every_hours":
      return t("saved.schedule.every_hours", { hours: d.hours });
    case "hourly":
      return t("saved.schedule.hourly");
    case "daily":
      return t("saved.schedule.daily", { time: d.time });
    default:
      return d.cron;
  }
}

/** Translate a `skipped_reason` when the dictionary has a key for it, else show the raw code. */
export function skipReasonText(t: Translate, reason: string): string {
  const key = `saved.skip.${reason}`;
  return hasKey(key) ? t(key) : reason;
}

export interface RunLike {
  new_cells: number;
  dropped_cells: number;
  skipped_reason: string | null;
  /**
   * Whether the run sent a digest. `query_runs` counts new and dropped cells but not price
   * drops, and a price drop is the third thing `shouldNotify` fires on
   * (src/lib/scheduler/run.ts), so a delivered run with no cell movement IS a price drop —
   * the one place this flag is load-bearing rather than decorative.
   */
  notified?: boolean;
}

/**
 * What a run did, in one phrase: "+2 new, −1 dropped" / "prices dropped" / "no change" /
 * "skipped: daily limit". The first run of a query has nothing to compare against and says so
 * ("baseline"). A run that notified with no cell added or lost changed only prices; calling
 * that "no change" would contradict the digest the user already read.
 */
export function runResultText(run: RunLike, t: Translate): string {
  if (run.skipped_reason === "first_run") return t("saved.skip.first_run");
  if (run.skipped_reason !== null) return t("saved.status.skipped", { reason: skipReasonText(t, run.skipped_reason) });
  if (run.new_cells === 0 && run.dropped_cells === 0) {
    return run.notified === true ? t("saved.status.price_drop") : t("saved.status.no_change");
  }
  return t("saved.result.changes", { new_cells: run.new_cells, dropped_cells: run.dropped_cells });
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * "2 hours ago" / "in 58 minutes" / "刚刚" through `Intl.RelativeTimeFormat` in the viewer's
 * locale (spec §8: numbers and dates go through Intl). An unparseable timestamp returns "".
 */
export function relativeTime(iso: string | null | undefined, now: number, locale: FormatLocale): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const delta = ms - now;
  const abs = Math.abs(delta);
  let unit: Intl.RelativeTimeFormatUnit;
  let value: number;
  if (abs < MINUTE_MS) {
    unit = "second";
    value = Math.round(delta / 1000);
  } else if (abs < HOUR_MS) {
    unit = "minute";
    value = Math.round(delta / MINUTE_MS);
  } else if (abs < DAY_MS) {
    unit = "hour";
    value = Math.round(delta / HOUR_MS);
  } else {
    unit = "day";
    value = Math.round(delta / DAY_MS);
  }
  try {
    return new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: "auto" }).format(value, unit);
  } catch {
    return iso;
  }
}

/** Absolute timestamp for the `title` of a relative time (the run history's second reading). */
export function absoluteTime(iso: string, locale: FormatLocale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(intlLocale(locale), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ");
  }
}

/**
 * Client-side fallback for `next_run_at` (the API supplies it; this covers a server that does
 * not yet, and a schedule the user has just edited in the drawer). The worker's cron runs in
 * UTC, so this computes in UTC too, for the three shapes `describeCron` recognises. A custom
 * expression returns null and the row shows the expression instead of a wrong promise.
 */
export function nextRunFromCron(cron: string, now: number): string | null {
  const d = describeCron(cron);
  if (d.kind === "custom") return null;
  const minute = Number(cron.trim().split(/\s+/)[0]);
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  if (d.kind === "daily") {
    const [hh, mm] = d.time.split(":").map(Number) as [number, number];
    const base = new Date(now);
    let at = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hh, mm, 0, 0);
    if (at <= now) at += DAY_MS;
    return new Date(at).toISOString();
  }
  const step = d.kind === "hourly" ? 1 : d.hours;
  if (!Number.isInteger(step) || step < 1 || step > 23) return null;
  const base = new Date(now);
  const topOfHour = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), base.getUTCHours(), 0, 0, 0);
  // At most two days of hours: `*/n` fires on hours where hour % n === 0, which always recurs.
  for (let i = 0; i <= 48; i++) {
    const at = topOfHour + i * HOUR_MS + minute * MINUTE_MS;
    if (at <= now) continue;
    if (new Date(at).getUTCHours() % step === 0) return new Date(at).toISOString();
  }
  return null;
}

// ---------------------------------------------------------------------------
// Diff cells: `query_runs.cells_json` snapshots → rows the real grid cell can render
// ---------------------------------------------------------------------------

export const DIFF_KEY_SEPARATOR = "|";
const CABINS: readonly Cabin[] = ["J", "F", "W", "Y"];

export interface DiffKeyParts {
  program: string;
  origin: string;
  dest: string;
  date: string;
  cabin: Cabin;
}

/** "alaska|HKG|SEA|2026-10-15|J" → its five parts; null when the shape is not that. */
export function parseDiffKey(key: string): DiffKeyParts | null {
  const parts = key.split(DIFF_KEY_SEPARATOR);
  if (parts.length !== 5) return null;
  const [program, origin, dest, date, cabin] = parts as [string, string, string, string, string];
  if (!program || !origin || !dest || !date) return null;
  if (!CABINS.includes(cabin as Cabin)) return null;
  return { program, origin, dest, date, cabin: cabin as Cabin };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * One diff entry → an `AvailabilityRow`, so the queries page renders it with the SAME cell
 * component as the grid (spec §4). Accepts both shapes the API may send: a stored `CellSnapshot`
 * (key + miles + fees + seats + computed_last_seen) and an already-expanded row. What a snapshot
 * does not carry — currency, direct, airlines, the booking link — is left empty rather than
 * invented; the cell renders fees, seats, program and freshness, which is what the row is for.
 */
export function toDiffRow(raw: unknown, fallbackSeen: string): AvailabilityRow | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const parts =
    typeof o.key === "string"
      ? parseDiffKey(o.key)
      : typeof o.program === "string" && typeof o.origin === "string" && typeof o.dest === "string" && typeof o.date === "string" && CABINS.includes(o.cabin as Cabin)
        ? { program: o.program, origin: o.origin, dest: o.dest, date: o.date, cabin: o.cabin as Cabin }
        : null;
  if (!parts) return null;
  const miles = numberOr(o.miles, 0);
  if (miles <= 0) return null;
  const seen = typeof o.computed_last_seen === "string" ? o.computed_last_seen : fallbackSeen;
  return {
    ...parts,
    miles,
    fees_cents: typeof o.fees_cents === "number" ? o.fees_cents : null,
    currency: typeof o.currency === "string" && o.currency.length > 0 ? o.currency : null,
    seats_left: numberOr(o.seats_left, 0),
    direct: o.direct === true,
    airlines: Array.isArray(o.airlines) ? o.airlines.filter((a): a is string => typeof a === "string") : [],
    computed_last_seen: seen,
    source_id: typeof o.source_id === "string" ? o.source_id : "",
    booking_url: typeof o.booking_url === "string" ? o.booking_url : null,
    fetched_at: typeof o.fetched_at === "string" ? o.fetched_at : fallbackSeen,
  };
}

/** Wrap one diff row as a one-row `GridCell` so `<Cell>` renders its full anatomy. */
export function diffGridCell(row: AvailabilityRow): GridCell {
  return { origin: row.origin, dest: row.dest, date: row.date, status: "ok", best: row, all: [row] };
}
