/**
 * Data freshness (kickoff §4.4 "freshness first-class; > 6h visibly stale").
 * Tiers: fresh < 2h, aging 2h..6h inclusive, stale > 6h. All arithmetic in ms on epoch values,
 * so it is timezone-independent.
 */
import type { FreshnessTier } from "@/lib/grid/types";

export const FRESH_MAX_MS = 2 * 60 * 60 * 1000; // < 2h → fresh
export const AGING_MAX_MS = 6 * 60 * 60 * 1000; // <= 6h → aging; beyond → stale

export type Lang = "en" | "zh";

function toMs(value: string | number | Date): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return Date.parse(value);
}

/**
 * Milliseconds between `seenIso` and `now`. Clamped at 0 (clock skew can put a
 * ComputedLastSeen slightly in the future). NaN when `seenIso` is unparseable.
 */
export function ageMs(seenIso: string, now: string | number | Date): number {
  const seen = Date.parse(seenIso);
  const nowMs = toMs(now);
  if (Number.isNaN(seen) || Number.isNaN(nowMs)) return Number.NaN;
  return Math.max(0, nowMs - seen);
}

export function tier(seenIso: string, now: string | number | Date): FreshnessTier {
  const age = ageMs(seenIso, now);
  if (Number.isNaN(age)) return "stale"; // unknown freshness is treated as stale, never as fresh
  if (age < FRESH_MAX_MS) return "fresh";
  if (age <= AGING_MAX_MS) return "aging";
  return "stale";
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
 * Compact age without the "ago" suffix, for dense cells: "35m", "2h", "3d", "now"/"刚刚".
 * Returns "?" when the timestamp is unparseable.
 */
export function formatAgeCompact(
  seenIso: string,
  now: string | number | Date,
  lang: Lang = "en",
): string {
  const age = ageMs(seenIso, now);
  if (Number.isNaN(age)) return "?";
  const { unit, n } = ageParts(age);
  if (unit === "now") return lang === "zh" ? "刚刚" : "now";
  return `${n}${UNITS[lang][unit]}`;
}

/** Human age: "2h ago" / "2小时前", "35m ago", "3d ago", "just now" / "刚刚". */
export function formatAge(seenIso: string, now: string | number | Date, lang: Lang = "en"): string {
  const age = ageMs(seenIso, now);
  if (Number.isNaN(age)) return lang === "zh" ? "未知" : "unknown";
  const { unit, n } = ageParts(age);
  if (unit === "now") return UNITS[lang].now;
  return lang === "zh" ? `${n}${UNITS.zh[unit]}前` : `${n}${UNITS.en[unit]} ago`;
}
