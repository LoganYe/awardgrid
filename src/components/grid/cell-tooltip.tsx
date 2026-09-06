"use client";

/**
 * The cell tooltip (spec §3.4 "Hover", docs/UI_PLAN.md §6.2, §7): one positioned popover the
 * grid owns, shown for the hovered or focused cell after 300 ms and closed on leave, blur, Esc
 * or any keyboard move. Lists EVERY program in the cell sorted by miles, each with its own
 * freshness mark and age; for the other states it repeats the state's label. Text only,
 * --bg-raised ground, 1 px --line-strong edge, 12/16, no motion.
 *
 * Rendered through a portal so the grid's scroll container can never clip it; positioned from
 * the anchor cell's viewport rect and flipped above the cell when there is no room below.
 * Hoverable (WCAG 2.1 SC 1.4.13): it takes pointer events and reports enter / leave so the grid
 * keeps it open while the pointer is on it.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { formatAgeCompact, tier } from "@/lib/grid/freshness";
import { formatFees, formatLongDate, formatMiles, formatSeats, programShortName } from "@/lib/grid/format";
import { compareRows } from "@/lib/grid/ranking";
import type { CellStatus, GridCell } from "@/lib/grid/types";
import { hasKey, type Locale, type Translate } from "@/lib/i18n";
import { FreshnessMark } from "@/components/grid/freshness-mark";

export interface CellTooltipProps {
  id: string;
  cell: GridCell;
  status: CellStatus;
  now: number;
  /** Viewport rect of the anchor cell at open time. */
  anchor: DOMRect;
  t: Translate;
  locale: Locale;
  /** The pointer moved onto the tooltip (the grid cancels the pending close). */
  onPointerEnter?: () => void;
  /** The pointer left the tooltip (the grid schedules the close). */
  onPointerLeave?: () => void;
}

const GAP = 4;
const MARGIN = 8;

function positionFor(anchor: DOMRect, width: number, height: number): CSSProperties {
  const vw = typeof window === "undefined" ? 1440 : window.innerWidth;
  const vh = typeof window === "undefined" ? 900 : window.innerHeight;
  let left = anchor.left;
  if (left + width + MARGIN > vw) left = Math.max(MARGIN, vw - width - MARGIN);
  let top = anchor.bottom + GAP;
  if (top + height + MARGIN > vh && anchor.top - height - GAP >= MARGIN) top = anchor.top - height - GAP;
  return { left: Math.round(left), top: Math.round(top) };
}

export function CellTooltip({ id, cell, status, now, anchor, t, locale, onPointerEnter, onPointerLeave }: CellTooltipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>(() => ({ left: anchor.left, top: anchor.bottom + GAP, visibility: "hidden" }));

  // Measure once mounted, then place (and flip) against the viewport.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setStyle(positionFor(anchor, width, height));
  }, [anchor, cell, status]);

  if (typeof document === "undefined") return null;

  let body: React.ReactNode;
  // The arrow is the route notation (spec §3.4), built here rather than stored in a string.
  const heading = `${cell.origin} → ${cell.dest}, ${formatLongDate(cell.date, locale)}`;
  if (status === "unmonitored") body = <div>{t("grid.cell.not_monitored")}</div>;
  else if (status === "not_fetched") body = <div>{cell.reason !== undefined && hasKey(cell.reason) ? t(cell.reason) : t("grid.cell.not_fetched")}</div>;
  else if (status === "loading") body = <div>{t("grid.cell.loading")}</div>;
  else if (cell.all.length === 0) body = <div>{t("grid.cell.no_availability")}</div>;
  else {
    const rows = [...cell.all].sort(compareRows("miles_asc"));
    const cabins = new Set(rows.map((r) => r.cabin));
    body = (
      <div>
        {rows.map((row) => {
          const tr = tier(row.computed_last_seen, now);
          const name = cabins.size > 1 ? `${row.cabin} ${programShortName(row.program)}` : programShortName(row.program);
          const dynamic = row.dynamic === true ? ` ${t("grid.cell.filtered")}` : "";
          const fees = row.fees_cents === null ? "" : formatFees(row.fees_cents, row.currency, locale);
          const seats = row.seats_left > 0 ? formatSeats(row.seats_left, locale, t) : "";
          return (
            <div key={`${row.program}-${row.cabin}-${row.source_id}`} className="ag-tip-row">
              <span className="ag-program">
                {name}
                {dynamic}
              </span>
              <span className="ag-tip-miles">{formatMiles(row.miles, locale)}</span>
              <span className="ag-tip-detail">
                <span>{fees}</span>
                <span>{seats}</span>
              </span>
              <span className="ag-age" data-tier={tr}>
                <FreshnessMark tier={tr} />
                <span>{formatAgeCompact(row.computed_last_seen, now, locale)}</span>
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  return createPortal(
    <div ref={ref} id={id} role="tooltip" className="ag-tip" style={style} data-testid="cell-tooltip" onMouseEnter={onPointerEnter} onMouseLeave={onPointerLeave}>
      <div className="ag-tag">{heading}</div>
      {body}
    </div>,
    document.body,
  );
}
