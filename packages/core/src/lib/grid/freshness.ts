/**
 * Data freshness (kickoff §4.4 "freshness first-class; > 6h visibly stale"; Phase 6 §3.4).
 *
 * Tiers: fresh < 2h, aging 2h..6h inclusive, stale > 6h, unknown when the timestamp is
 * missing or unparseable. All arithmetic in ms on epoch values, so it is timezone-independent.
 *
 * Every constant the encoding needs — thresholds, mark shapes, color tokens, contrast step —
 * lives in FRESHNESS_SPEC so the grid cell, the cell drawer, the legend and the docs read one
 * source. The encoding is never color-only: shape + age text carry the tier as well.
 */
import type { FreshnessTier } from "./types";

export const FRESH_MAX_MS = 2 * 60 * 60 * 1000; // < 2h → fresh
export const AGING_MAX_MS = 6 * 60 * 60 * 1000; // <= 6h → aging; beyond → stale

export type Lang = "en" | "zh";

/** Mark shapes drawn inline (8 × 8, aria-hidden): filled dot, left-half dot, hollow ring. */
export type FreshnessMarkShape = "dot" | "half" | "ring";
/** CSS custom properties from styles/tokens.css. */
export type FreshnessColorToken = "--fresh" | "--aging" | "--stale" | "--fg-muted";

export interface FreshnessMark {
  shape: FreshnessMarkShape;
  colorToken: FreshnessColorToken;
}

export const FRESHNESS_TIERS: readonly FreshnessTier[] = ["fresh", "aging", "stale", "unknown"];

/**
 * The single source of truth for the freshness encoding (UI_PLAN §5 / spec §3.4):
 *   fresh    ≤ 2 h   filled dot   --fresh     miles at full contrast
 *   aging    2–6 h   half dot     --aging     miles at full contrast
 *   stale    > 6 h   hollow ring  --stale     miles drop one contrast step
 *   unknown  ?       hollow ring  --fg-muted  miles drop one contrast step, age "?"
 */
export const FRESHNESS_SPEC = {
  thresholds: { fresh_max_ms: FRESH_MAX_MS, aging_max_ms: AGING_MAX_MS },
  tiers: FRESHNESS_TIERS,
  marks: {
    fresh: { shape: "dot", colorToken: "--fresh" },
    aging: { shape: "half", colorToken: "--aging" },
    stale: { shape: "ring", colorToken: "--stale" },
    unknown: { shape: "ring", colorToken: "--fg-muted" },
  } as Readonly<Record<FreshnessTier, FreshnessMark>>,
  /** How many contrast steps the miles figure drops per tier (0 = `--fg`, 1 = `--fg-muted`). */
  milesContrastStep: { fresh: 0, aging: 0, stale: 1, unknown: 1 } as Readonly<Record<FreshnessTier, 0 | 1>>,
  /** Age text for a missing/unparseable timestamp (both languages). */
  unknownAge: "?",
} as const;

function toMs(value: string | number | Date): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return Date.parse(value);
}

/**
 * Milliseconds between `seenIso` and `now`. Clamped at 0 (clock skew can put a
 * ComputedLastSeen slightly in the future). NaN when `seenIso` is missing or unparseable.
 */
export function ageMs(seenIso: string | null | undefined, now: string | number | Date): number {
  if (seenIso === null || seenIso === undefined) return Number.NaN;
  const seen = Date.parse(seenIso);
  const nowMs = toMs(now);
  if (Number.isNaN(seen) || Number.isNaN(nowMs)) return Number.NaN;
  return Math.max(0, nowMs - seen);
}

export function tier(seenIso: string | null | undefined, now: string | number | Date): FreshnessTier {
  const age = ageMs(seenIso, now);
  if (Number.isNaN(age)) return "unknown"; // never fresh; rendered as a ring with "?"
  if (age < FRESH_MAX_MS) return "fresh";
  if (age <= AGING_MAX_MS) return "aging";
  return "stale";
}

/** Mark shape + color token for a tier (see FRESHNESS_SPEC). */
export function markFor(t: FreshnessTier): FreshnessMark {
  return FRESHNESS_SPEC.marks[t];
}

/** 0 for fresh/aging, 1 (one step quieter: `--fg-muted`) for stale/unknown. */
export function milesContrastStep(t: FreshnessTier): 0 | 1 {
  return FRESHNESS_SPEC.milesContrastStep[t];
}

interface AgeParts {
  unit: "now" | "m" | "h" | "d";
  n: number;
}

function ageParts(age: number): AgeParts {
  const minutes = Math.floor(age / 60_000);
  if (minutes < 1) return { unit: "now", n: 0 };
  if (minutes < 60) return { unit: "m", n: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: "h", n: hours };
  return { unit: "d", n: Math.floor(hours / 24) };
}

const UNITS: Record<Lang, Record<AgeParts["unit"], string>> = {
  en: { now: "just now", m: "m", h: "h", d: "d" },
  zh: { now: "刚刚", m: "分钟", h: "小时", d: "天" },
};

/**
 * Compact age without the "ago" suffix, for dense cells: "45m", "2h", "1d", "now"/"刚刚".
 * Returns "?" when the timestamp is missing or unparseable (the unknown tier).
 */
export function formatAgeCompact(
  seenIso: string | null | undefined,
  now: string | number | Date,
  lang: Lang = "en",
): string {
  const age = ageMs(seenIso, now);
  if (Number.isNaN(age)) return FRESHNESS_SPEC.unknownAge;
  const { unit, n } = ageParts(age);
  if (unit === "now") return lang === "zh" ? "刚刚" : "now";
  return `${n}${UNITS[lang][unit]}`;
}

/** Human age: "2h ago" / "2小时前", "35m ago", "3d ago", "just now" / "刚刚". */
export function formatAge(seenIso: string | null | undefined, now: string | number | Date, lang: Lang = "en"): string {
  const age = ageMs(seenIso, now);
  if (Number.isNaN(age)) return lang === "zh" ? "未知" : "unknown";
  const { unit, n } = ageParts(age);
  if (unit === "now") return UNITS[lang].now;
  return lang === "zh" ? `${n}${UNITS.zh[unit]}前` : `${n}${UNITS.en[unit]} ago`;
}

const LONG_UNITS: Record<Lang, Record<Exclude<AgeParts["unit"], "now">, [one: string, many: string]>> = {
  en: { m: ["minute", "minutes"], h: ["hour", "hours"], d: ["day", "days"] },
  zh: { m: ["分钟", "分钟"], h: ["小时", "小时"], d: ["天", "天"] },
};

/**
 * Spoken-length age without "ago", for aria labels: "2 hours", "1 minute", "3 days",
 * "less than a minute" / "2 小时", "不到 1 分钟". Returns null for the unknown tier so the
 * caller can say "freshness unknown" instead of "seen ? ago".
 */
export function formatAgeLong(
  seenIso: string | null | undefined,
  now: string | number | Date,
  lang: Lang = "en",
): string | null {
  const age = ageMs(seenIso, now);
  if (Number.isNaN(age)) return null;
  const { unit, n } = ageParts(age);
  if (unit === "now") return lang === "zh" ? "不到 1 分钟" : "less than a minute";
  const [one, many] = LONG_UNITS[lang][unit];
  return `${n} ${n === 1 ? one : many}`;
}
