/**
 * Tiny 5-field cron matcher for the standing-query scheduler (kickoff §6, §12: default every
 * 3 hours). Matching is at MINUTE granularity in UTC (DECISIONS: the master tick runs with
 * `timezone: 'UTC'`).
 *
 *   fields   minute hour day-of-month month day-of-week
 *   syntax   `*`, `a`, `a-b`, `a,b,c`, star-slash-n (every n), `a-b/n`, `a/n` (start at a, every n)
 *   dow      0–7, 7 = Sunday like 0; no month/day names (not needed for our UI presets)
 *   dom/dow  Vixie semantics: when BOTH are restricted a minute matches if EITHER matches
 *
 * `validateCron` runs this parser AND node-cron@4's `validate()` (ARCHITECTURE §9.3 — exported
 * from the package root; `validateDetailed` also exists but we only need the boolean), so an
 * expression accepted at save time is one node-cron would also accept. node-cron additionally
 * accepts a 6-field (seconds) form and names; we deliberately require exactly 5 numeric fields.
 *
 * `isDue(expr, lastRunAt, now)`: due when some matching minute exists in (lastRunAt, now],
 * scanning at most 24 h back so a query that slept for a week fires once, not 56 times.
 * `lastRunAt === null` → due now (a new query runs on the next tick).
 */
import cron from "node-cron";

export const DEFAULT_CRON = "0 */3 * * *";

/** The scan window: matching minutes older than this are not "missed", they are forgotten. */
export const MAX_CATCHUP_MS = 24 * 60 * 60 * 1000;

export interface CronFields {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  /** True when the field was a star (with or without a step), which changes dom/dow combination semantics. */
  domAny: boolean;
  dowAny: boolean;
}

export class CronSyntaxError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(`cron ${field}: ${message}`);
    this.name = "CronSyntaxError";
    this.field = field;
  }
}

const FIELD_RANGES = [
  ["minute", 0, 59],
  ["hour", 0, 23],
  ["day-of-month", 1, 31],
  ["month", 1, 12],
  ["day-of-week", 0, 7],
] as const;

function parseInt10(name: string, raw: string): number {
  if (!/^\d+$/.test(raw)) throw new CronSyntaxError(name, `"${raw}" is not a number`);
  return Number.parseInt(raw, 10);
}

/** Parse one field into the set of allowed values; also reports whether it was a bare `*`. */
export function parseField(name: string, field: string, min: number, max: number): { values: Set<number>; any: boolean } {
  if (field.length === 0) throw new CronSyntaxError(name, "empty field");
  const values = new Set<number>();
  let any = false;
  for (const part of field.split(",")) {
    if (part.length === 0) throw new CronSyntaxError(name, "empty list item");
    const [rangePart = "", stepPart, ...rest] = part.split("/");
    if (rest.length > 0) throw new CronSyntaxError(name, `"${part}" has more than one "/"`);
    let step = 1;
    if (stepPart !== undefined) {
      step = parseInt10(name, stepPart);
      if (step < 1) throw new CronSyntaxError(name, "step must be >= 1");
    }
    let lo: number;
    let hi: number;
    if (rangePart === "*") {
      lo = min;
      hi = max;
      any = true; // a star with or without a step counts as "unrestricted" for the dom/dow rule
    } else if (rangePart.includes("-")) {
      const [a, b, ...more] = rangePart.split("-");
      if (more.length > 0 || a === undefined || b === undefined) throw new CronSyntaxError(name, `bad range "${rangePart}"`);
      lo = parseInt10(name, a);
      hi = parseInt10(name, b);
      if (lo > hi) throw new CronSyntaxError(name, `range "${rangePart}" is reversed`);
    } else {
      lo = parseInt10(name, rangePart);
      // `a/n` means "starting at a, every n until max" (Vixie cron extension).
      hi = stepPart !== undefined ? max : lo;
    }
    if (lo < min || hi > max) throw new CronSyntaxError(name, `"${part}" is outside ${min}-${max}`);
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return { values, any };
}

/** Parse a 5-field expression. Throws CronSyntaxError on anything else. */
export function parseCron(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new CronSyntaxError("expression", `expected 5 fields, got ${parts.length}`);
  const parsed = FIELD_RANGES.map(([name, min, max], i) => parseField(name, parts[i]!, min, max));
  const dow = new Set(parsed[4]!.values);
  if (dow.has(7)) {
    dow.delete(7);
    dow.add(0);
  }
  return {
    minute: parsed[0]!.values,
    hour: parsed[1]!.values,
    dom: parsed[2]!.values,
    month: parsed[3]!.values,
    dow,
    domAny: parsed[2]!.any,
    dowAny: parsed[4]!.any,
  };
}

export interface CronValidation {
  valid: boolean;
  /** Safe to show to the user; never echoes anything but the expression's own text. */
  error?: string;
}

/** Our parser AND node-cron's validate() must both accept the expression. */
export function validateCron(expr: string): CronValidation {
  if (typeof expr !== "string" || expr.trim().length === 0) return { valid: false, error: "cron expression is empty" };
  try {
    parseCron(expr);
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : "invalid cron expression" };
  }
  // node-cron@4 exports validate(expression) → boolean (ARCHITECTURE §9.3).
  if (typeof cron.validate === "function" && !cron.validate(expr.trim())) {
    return { valid: false, error: "cron expression rejected by node-cron" };
  }
  return { valid: true };
}

/** Does the UTC minute containing `date` match the parsed fields? */
export function matchesMinute(fields: CronFields, date: Date): boolean {
  if (!fields.minute.has(date.getUTCMinutes())) return false;
  if (!fields.hour.has(date.getUTCHours())) return false;
  if (!fields.month.has(date.getUTCMonth() + 1)) return false;
  const domOk = fields.dom.has(date.getUTCDate());
  const dowOk = fields.dow.has(date.getUTCDay());
  if (fields.domAny && fields.dowAny) return true;
  if (fields.domAny) return dowOk;
  if (fields.dowAny) return domOk;
  return domOk || dowOk;
}

const MINUTE_MS = 60_000;

function floorToMinute(ms: number): number {
  return Math.floor(ms / MINUTE_MS) * MINUTE_MS;
}

function parseIso(name: string, iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new CronSyntaxError(name, "invalid ISO timestamp");
  return ms;
}

/**
 * True when a matching minute exists in (lastRunAt, now], capped at 24 h back. A run that
 * happened inside minute M does not re-fire for M. Invalid expressions are never due (the
 * caller validated at save time; a corrupted row must not spin the worker).
 */
export function isDue(expr: string, lastRunAtIso: string | null, nowIso: string): boolean {
  let fields: CronFields;
  try {
    fields = parseCron(expr);
  } catch {
    return false;
  }
  const nowMinute = floorToMinute(parseIso("now", nowIso));
  if (lastRunAtIso === null) return true;
  const lastMinute = floorToMinute(parseIso("lastRunAt", lastRunAtIso));
  const earliest = nowMinute - MAX_CATCHUP_MS + MINUTE_MS;
  const start = Math.max(lastMinute + MINUTE_MS, earliest);
  for (let t = start; t <= nowMinute; t += MINUTE_MS) {
    if (matchesMinute(fields, new Date(t))) return true;
  }
  return false;
}

/** The next matching minute strictly after `from` within 366 days, or null. Used for "next run" labels. */
export function nextMatch(expr: string, from: Date): Date | null {
  const fields = parseCron(expr);
  const limit = from.getTime() + 366 * 24 * 60 * MINUTE_MS;
  for (let t = floorToMinute(from.getTime()) + MINUTE_MS; t <= limit; t += MINUTE_MS) {
    const d = new Date(t);
    if (matchesMinute(fields, d)) return d;
  }
  return null;
}
