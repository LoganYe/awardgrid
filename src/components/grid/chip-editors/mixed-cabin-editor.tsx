"use client";

/**
 * Mixed cabin editor (issue #18, docs/UI_PLAN.md §6.2a): one native select bound to
 * `min_cabin_pct`, modelled on sort-editor.tsx and restyled on the same tokens.
 *
 * A select, not a slider: `<select>` is already in the coarse-pointer `min-height:
 * var(--row-touch)` list in globals.css, so the 40 px touch target comes free, and a slider
 * would be motion plus a precision the API does not reward — 0-100 is found by trial (75 → 50),
 * not by dragging.
 */
import { mixedCabinHint } from "@/components/grid/chips-model";
import { useT } from "@awardgrid/core/i18n/client";
import { DEFAULT_MIN_CABIN_PCT } from "@awardgrid/core/query/schema";

/** Presets, in the order they are offered: not allowed (the API default) down to any. */
export const MIN_CABIN_PCT_PRESETS: readonly number[] = [DEFAULT_MIN_CABIN_PCT, 75, 50, 25, 0];

/**
 * The presets, plus `value` itself when a shared `?q=` link carries something else (63, say),
 * so opening the editor never silently snaps a stranger's link to the nearest preset.
 */
export function minCabinPctOptions(value: number): number[] {
  return MIN_CABIN_PCT_PRESETS.includes(value) ? [...MIN_CABIN_PCT_PRESETS] : [...MIN_CABIN_PCT_PRESETS, value].sort((a, b) => b - a);
}

export interface MixedCabinEditorProps {
  value: number;
  onChange: (value: number) => void;
}

export function MixedCabinEditor({ value, onChange }: MixedCabinEditorProps) {
  const t = useT();
  const label = (pct: number): string =>
    pct === DEFAULT_MIN_CABIN_PCT
      ? t("grid.chips.mixed_cabin_none")
      : pct === 0
        ? t("grid.chips.mixed_cabin_any")
        : t("grid.chips.mixed_cabin_min", { pct });
  return (
    <label className="flex flex-col gap-1 text-grid">
      <span className="t-meta text-fg-muted">{t("grid.chips.min_cabin_pct")}</span>
      <select
        value={String(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={t("grid.chips.min_cabin_pct")}
        className="h-8 w-full rounded-lg border border-line-strong bg-bg px-2 text-grid text-fg"
      >
        {minCabinPctOptions(value).map((pct) => (
          <option key={pct} value={String(pct)}>
            {label(pct)}
          </option>
        ))}
      </select>
      {/* The hint names the selected threshold: a fixed sentence is false at one end or the other. */}
      <span className="t-meta text-fg-muted">{mixedCabinHint(value, { t })}</span>
    </label>
  );
}
