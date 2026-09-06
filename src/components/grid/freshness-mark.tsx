/**
 * Freshness mark (spec §3.4, docs/UI_PLAN.md §5): an 8 × 8 inline SVG that carries the tier by
 * SHAPE — filled dot (fresh), left-half dot (aging), hollow ring (stale, unknown) — and by color
 * through `currentColor`, which the enclosing `.ag-age[data-tier]` sets from the tier's token
 * (--fresh / --aging / --stale / --fg-muted). The age text next to it always spells the tier
 * out, so the encoding survives grayscale and screen readers; the SVG itself is aria-hidden.
 *
 * Shape and color token per tier come from FRESHNESS_SPEC in src/lib/grid/freshness.ts — this
 * file only draws.
 */
import { markFor, type FreshnessMarkShape } from "@/lib/grid/freshness";
import type { FreshnessTier } from "@/lib/grid/types";

/** Text glyphs for places that cannot render SVG (the cell drawer today; CSV/ASCII have their own). */
export const FRESHNESS_GLYPH: Record<FreshnessTier, string> = { fresh: "●", aging: "◐", stale: "○", unknown: "○" };

/** Tailwind text color per tier (cell drawer). */
export const TIER_TEXT: Record<FreshnessTier, string> = { fresh: "text-fresh", aging: "text-aging", stale: "text-stale", unknown: "text-fg-muted" };

export interface FreshnessMarkProps {
  tier: FreshnessTier;
  className?: string;
}

function Shape({ shape }: { shape: FreshnessMarkShape }) {
  switch (shape) {
    case "dot":
      return <circle cx="4" cy="4" r="4" fill="currentColor" />;
    case "half":
      return (
        <>
          <path d="M4 0 A4 4 0 0 0 4 8 Z" fill="currentColor" />
          <circle cx="4" cy="4" r="3.5" fill="none" stroke="currentColor" strokeWidth="1" />
        </>
      );
    case "ring":
      return <circle cx="4" cy="4" r="3.375" fill="none" stroke="currentColor" strokeWidth="1.25" />;
  }
}

export function FreshnessMark({ tier, className }: FreshnessMarkProps) {
  const { shape } = markFor(tier);
  const cls = className ? `ag-mark ${className}` : "ag-mark";
  return (
    <svg className={cls} width="8" height="8" viewBox="0 0 8 8" aria-hidden="true" focusable="false" data-tier={tier} data-shape={shape}>
      <Shape shape={shape} />
    </svg>
  );
}
