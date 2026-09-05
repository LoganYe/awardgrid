"use client";

import { formatAgeCompact, tier } from "@/lib/grid/freshness";
import { programDisplayName } from "@/lib/grid/ranking";
import type { FreshnessTier, Grid, GridCell } from "@/lib/grid/types";
import { useLocale, useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { formatFees, formatMiles, formatSeats } from "@/components/grid/state";

export interface GridTableProps {
  grid: Grid;
  now: number;
  selected: GridCell | null;
  onSelect: (cell: GridCell) => void;
}

/** Freshness is never colour-only (kickoff §4.4): tint + glyph + text label. */
export const FRESHNESS_GLYPH: Record<FreshnessTier, string> = { fresh: "●", aging: "◐", stale: "○" };

const TIER_CLASSES: Record<FreshnessTier, string> = {
  fresh: "bg-fresh/10 hover:bg-fresh/20",
  aging: "bg-aging/15 hover:bg-aging/25",
  stale: "bg-stale/15 hover:bg-stale/25",
};

export const TIER_TEXT: Record<FreshnessTier, string> = { fresh: "text-fresh", aging: "text-aging", stale: "text-stale" };

/** One grid cell: `miles · $fees · seats · program · freshness` in monospace. */
export function Cell({ cell, now, selected, onSelect }: { cell: GridCell; now: number; selected: boolean; onSelect: (c: GridCell) => void }) {
  const t = useT();
  const locale = useLocale();
  if (cell.status === "unmonitored") {
    return (
      <td className="border-b border-border px-1.5 py-1 align-top">
        <span className="block text-[11px] leading-4 text-muted-foreground" title={t("grid.cell.not_monitored")}>
          {t("grid.cell.unmonitored_short")}
        </span>
      </td>
    );
  }
  const best = cell.best;
  if (!best) {
    return (
      <td className="border-b border-border px-1.5 py-1 text-center align-top text-muted-foreground/60" aria-label={t("grid.empty.no_results")}>
        {t("grid.cell.none")}
      </td>
    );
  }
  const tr = tier(best.computed_last_seen, now);
  const label = `${formatMiles(best.miles)} ${t("grid.cell.miles")} · ${formatFees(best.fees_cents, best.currency)} · ${formatSeats(best.seats_left)} ${t("grid.cell.seats")} · ${programDisplayName(best.program)} · ${t(`grid.freshness.${tr}`)}`;
  return (
    <td className={cn("border-b border-border p-0 align-top", TIER_CLASSES[tr], selected && "ring-2 ring-inset ring-ring")}>
      <button
        type="button"
        onClick={() => onSelect(cell)}
        aria-label={label}
        title={t("grid.cell.click_hint")}
        className="flex w-full flex-col items-start gap-0 px-1.5 py-1 text-left leading-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="num text-[13px] font-medium text-foreground">
          {formatMiles(best.miles)}
          <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">{best.cabin}</span>
        </span>
        <span className="num text-[11px] text-muted-foreground">
          {formatFees(best.fees_cents, best.currency)} · {formatSeats(best.seats_left)}
          {best.direct ? ` · ${t("grid.cell.direct")}` : ""}
        </span>
        <span className="flex w-full items-center gap-1 text-[11px]">
          <span className="truncate text-muted-foreground">{programDisplayName(best.program)}</span>
          <span className={cn("num ml-auto shrink-0", TIER_TEXT[tr])} title={t("grid.freshness.updated", { age: formatAgeCompact(best.computed_last_seen, now, locale) })}>
            {FRESHNESS_GLYPH[tr]} {formatAgeCompact(best.computed_last_seen, now, locale)}
            {tr === "stale" ? ` ${t("grid.freshness.stale")}` : ""}
          </span>
        </span>
        {cell.all.length > 1 && <span className="text-[10px] text-muted-foreground/80">{t("grid.cell.best_of", { n: cell.all.length })}</span>}
      </button>
    </td>
  );
}

/** Sticky first column + horizontal scroll (kickoff §8 mobile requirement). */
export function GridTable({ grid, now, selected, onSelect }: GridTableProps) {
  const t = useT();
  const isSelected = (c: GridCell) => selected !== null && selected.origin === c.origin && selected.dest === c.dest && selected.date === c.date;
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-max min-w-full border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 border-r border-b border-border bg-card px-2 py-1.5 text-left font-medium text-muted-foreground">
              {grid.orientation === "dates" ? t("grid.chips.dates") : t("grid.rows_routes")}
            </th>
            {grid.cols.map((col) => (
              <th key={col} className="num min-w-[9.5rem] border-b border-border bg-card px-1.5 py-1.5 text-left font-medium">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row, r) => (
            <tr key={row}>
              <th scope="row" className="num sticky left-0 z-10 border-r border-b border-border bg-card px-2 py-1 text-left font-medium whitespace-nowrap">
                {row}
              </th>
              {grid.cells[r]?.map((cell) => (
                <Cell key={`${cell.origin}-${cell.dest}-${cell.date}`} cell={cell} now={now} selected={isSelected(cell)} onSelect={onSelect} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
