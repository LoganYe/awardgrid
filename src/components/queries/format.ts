/**
 * Pure helpers for the saved-queries UI: route summaries, default names, cron presets and the
 * human "every 3 h" rendering, plus the SaveQueryDialog form reducer. No React, no DOM, no
 * network — unit-tested in format.test.ts. Safe to import from server and client code.
 */
import type { QueryObject } from "@/lib/query/schema";

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

// ---------------------------------------------------------------------------
// Cron presets + human rendering
// ---------------------------------------------------------------------------

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
