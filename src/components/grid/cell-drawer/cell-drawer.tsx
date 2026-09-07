"use client";

/**
 * The cell drawer (spec §3.5, §6; docs/UI_PLAN.md §6.5): 480 px on the right at ≥ 768 px, a
 * full-height sheet below that, drawn in the shared DrawerShell.
 *
 * Header: the route, then the date in its localized long form and the cabins in the cell.
 * Body: every program that has this square, sorted by miles — the cheapest first, because that
 * is the number the grid cell showed and the one the actions act on. Footer: the confirmation
 * line, "Open in <program>", "Copy details" and "Save as standing query".
 *
 * Esc closes and focus returns to the cell that opened it — both are DrawerShell's job, so the
 * keyboard walk (grid → cell → drawer → link → back) works here without any extra wiring.
 */
import { useMemo, useState } from "react";
import { DrawerShell } from "@/components/drawers/drawer-shell";
import { CellActions } from "@/components/grid/cell-drawer/actions";
import { ProgramRow } from "@/components/grid/cell-drawer/program-row";
import { intlLocale, type FormatLocale } from "@/lib/grid/format";
import { programDisplayName } from "@/lib/grid/ranking";
import type { AvailabilityRow, GridCell } from "@/lib/grid/types";
import { useLocale, useT } from "@/lib/i18n/client";
import type { Cabin, QueryObject } from "@/lib/query/schema";
import type { TripsForUserResult } from "@/lib/server/find";
import "./cell-drawer.css";

const CABIN_ORDER: readonly Cabin[] = ["F", "J", "W", "Y"];

/** "Wednesday, October 15" / "10月15日星期三" — calendar days, formatted in UTC so none shift. */
export function formatDrawerDate(isoDate: string, locale: FormatLocale): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return new Intl.DateTimeFormat(intlLocale(locale), { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(d);
}

/** "Business and first" / "商务舱和头等舱"; falls back to a comma list where ListFormat is missing. */
function formatCabinList(names: string[], locale: FormatLocale): string {
  if (names.length <= 1) return names[0] ?? "";
  try {
    return new Intl.ListFormat(intlLocale(locale), { style: "long", type: "conjunction" }).format(names);
  } catch {
    return names.join(locale === "zh" ? "、" : ", ");
  }
}

/**
 * Sorted by miles, whatever the grid's own sort is (spec §3.5). Ties break on fees, then on the
 * program name and its row id, so the order is total and the list never reshuffles between
 * renders of the same data.
 */
export function sortByMiles(rows: readonly AvailabilityRow[]): AvailabilityRow[] {
  return [...rows].sort(
    (a, b) =>
      a.miles - b.miles ||
      (a.fees_cents ?? Number.MAX_SAFE_INTEGER) - (b.fees_cents ?? Number.MAX_SAFE_INTEGER) ||
      programDisplayName(a.program).localeCompare(programDisplayName(b.program)) ||
      a.source_id.localeCompare(b.source_id),
  );
}

export interface CellDrawerProps {
  /** The selected cell, or null when nothing is selected (the drawer is then not rendered). */
  cell: GridCell | null;
  /** The query the grid was produced from: the dynamic scope for Get Trips and the save prefill. */
  query: QueryObject;
  /** Epoch ms the freshness ages are measured against. */
  now: number;
  onClose: () => void;
  /** Fees and booking links learned from Get Trips flow back into the grid. */
  onTripsLoaded: (row: AvailabilityRow, result: TripsForUserResult) => void;
  /**
   * "Ask about this cell": opens the Ask drawer with this cell still selected, so the question
   * carries the "Selected: SEA→NRT Oct 15 F 80,000 Alaska" pill (spec §3.6). Opening Ask closes
   * this drawer — they share one slot — but not the selection.
   */
  onAsk?: () => void;
}

export function CellDrawer({ cell, query, now, onClose, onTripsLoaded, onAsk }: CellDrawerProps) {
  const t = useT();
  const locale = useLocale();
  // The cell the panel is drawn from survives the close so the 200 ms exit has content to
  // animate; `open` — not the presence of a cell — is what makes the drawer visible.
  const [lastCell, setLastCell] = useState<GridCell | null>(cell);
  if (cell !== null && cell !== lastCell) setLastCell(cell);
  const shown = cell ?? lastCell;
  const rows = useMemo(() => sortByMiles(shown?.all ?? []), [shown]);

  if (!shown) return null;

  const cabins = CABIN_ORDER.filter((c) => rows.some((r) => r.cabin === c));
  const when = [formatDrawerDate(shown.date, locale), formatCabinList(cabins.map((c) => t(`grid.cabin.${c}`)), locale)]
    .filter((s) => s.length > 0)
    .join(locale === "zh" ? "，" : ", ");

  return (
    <DrawerShell
      open={cell !== null}
      onClose={onClose}
      width={480}
      mobile="sheet"
      data-testid="cell-drawer"
      // The route is drawn with its arrow but spoken as words: "HKG to SEA".
      ariaLabel={t("grid.drawer.route", { origin: shown.origin, dest: shown.dest })}
      title={
        <span className="tabular-nums">
          {shown.origin} <span aria-hidden="true">→</span> {shown.dest}
        </span>
      }
      subtitle={
        <p className="agd-when t-meta" data-testid="drawer-when">
          {when}
        </p>
      }
      openerKey={shown ? `${shown.origin}-${shown.dest}-${shown.date}` : undefined}
      footer={rows[0] ? <CellActions row={rows[0]} query={query} now={now} onAsk={onAsk} /> : undefined}
    >
      {shown.status === "unmonitored" && <p className="agd-empty t-body">{t("grid.cell.not_monitored")}</p>}
      {shown.status !== "unmonitored" && rows.length === 0 && <p className="agd-empty t-body">{t("grid.empty.no_results")}</p>}
      {rows.map((row) => (
        <ProgramRow
          key={`${row.program}-${row.cabin}-${row.source_id}`}
          row={row}
          now={now}
          includeFiltered={query.include_filtered}
          minCabinPct={query.min_cabin_pct}
          onTripsLoaded={onTripsLoaded}
        />
      ))}
    </DrawerShell>
  );
}
