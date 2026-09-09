"use client";

/**
 * One grid cell (spec §3.4, docs/UI_PLAN.md §5–§6): the six states, the three-line anatomy at
 * desktop (two lines at tablet, one on mobile), the cabin tag, the freshness mark + age, the
 * per-cell aria-label (src/lib/grid/aria.ts), and the roving tabindex contract (the table owns
 * the keyboard).
 *
 * States, each with pattern + label (never color alone):
 *   ok            miles / fees + seats / program + mark + age
 *   none          a single quiet en dash; aria "no availability"
 *   unmonitored   diagonal hatch; title + aria "Not monitored by seats.aero"
 *   not_fetched   dotted outline; reason (an i18n key on the cell) in title + aria
 *   filtered      muted anatomy + a small "dyn" text tag at every density (the full word is in
 *                 the title and the aria label; "dynamic" does not fit a 112 px column next to
 *                 a cabin tag and six-digit miles) — the pivot turns it into `ok` once the
 *                 query includes dynamic pricing
 *   loading       skeleton bars at the eventual line positions (static under reduced motion)
 * Stale / unknown: the miles figure drops one contrast step (--fg-muted) + hollow ring.
 *
 * Formatting is the lib's (Intl in the viewer's locale; tabular figures come from the font);
 * program names are the short text names from src/lib/grid/format.ts — never a logo or color.
 */
import { memo } from "react";
import { cellAriaLabel } from "@awardgrid/core/grid/aria";
import { formatAge, formatAgeCompact, tier } from "@awardgrid/core/grid/freshness";
import { formatFees, formatMiles, formatSeats, programShortName } from "@awardgrid/core/grid/format";
import { bestPerCabin } from "@awardgrid/core/grid/pivot";
import { programDisplayName } from "@awardgrid/core/grid/ranking";
import type { AvailabilityRow, CabinSlot, CellLayout, CellStatus, FreshnessTier, GridCell } from "@awardgrid/core/grid/types";
import { hasKey, type Locale, type Translate } from "@awardgrid/core/i18n";
import type { Cabin, QueryObject } from "@awardgrid/core/query/schema";
import { FreshnessMark } from "@/components/grid/freshness-mark";
import type { Density } from "@/components/grid/use-roving-grid";

/** The state the cell renders: the pivot's status, or `loading` while the query runs. */
export function uiCellStatus(cell: GridCell, loading = false): CellStatus {
  return loading ? "loading" : cell.status;
}

/** The i18n key explaining a not-fetched cell (the pivot puts one on the cell; fall back to the generic one). */
export function notFetchedKey(cell: GridCell): "grid.cell.not_fetched" | "grid.cell.not_fetched_quota" | "grid.cell.not_fetched_error" {
  const reason = cell.reason;
  if (reason === "grid.cell.not_fetched_quota" || reason === "grid.cell.not_fetched_error") return reason;
  return "grid.cell.not_fetched";
}

/** Title (native tooltip) for the states that have no anatomy to explain themselves. */
export function cellTitle(cell: GridCell, status: CellStatus, t: Translate): string | undefined {
  switch (status) {
    case "unmonitored":
      return t("grid.cell.not_monitored");
    case "not_fetched": {
      const reason = cell.reason;
      return reason !== undefined && hasKey(reason) ? t(reason) : t(notFetchedKey(cell));
    }
    case "filtered":
      return t("grid.cell.filtered_title");
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface CellProps {
  cell: GridCell;
  status: CellStatus;
  now: number;
  density: Density;
  /** Show the J/F tag before the miles (both cabins in the grid). */
  showCabinTag: boolean;
  /** Cabins the grid shows (named in the aria label of empty states). */
  cabins: readonly Cabin[];
  /**
   * How the cell draws when it has rows; default "best" (today's anatomy). Optional so
   * src/components/queries/diff-cells.tsx, which builds a one-cabin cell with no Grid behind it,
   * keeps compiling and behaving exactly as it does — do not make it required.
   */
  layout?: CellLayout;
  /** Needed only by layout "per_cabin" (sort_by, include_filtered). Pass `grid.query`. */
  query?: QueryObject;
  /** 0-based data coordinates (row header / header row excluded). */
  row: number;
  col: number;
  /** The one roving cell: tabindex 0. */
  tabbable: boolean;
  /** The cell whose drawer is open. */
  selected: boolean;
  /** id of the open tooltip that describes this cell. */
  describedBy?: string;
  t: Translate;
  locale: Locale;
  register: (el: HTMLElement | null, row: number, col: number) => void;
  onActivate: (row: number, col: number) => void;
  onFocusCell: (row: number, col: number) => void;
  onHover: (row: number, col: number, entering: boolean) => void;
}

function Skeleton({ density }: { density: Density }) {
  const bars = density === "desktop" ? 3 : density === "tablet" ? 2 : 1;
  return (
    <div className="ag-skel" aria-hidden="true" data-testid="cell-skeleton">
      {Array.from({ length: bars }, (_, i) => (
        <div key={i} className="ag-skel-bar" />
      ))}
    </div>
  );
}

/** Freshness mark + compact age in the tier's color; the long age sits in the title. */
export function AgeMark({ row, now, locale, t }: { row: AvailabilityRow; now: number; locale: Locale; t: Translate }) {
  const tr: FreshnessTier = tier(row.computed_last_seen, now);
  return (
    <span className="ag-age" data-tier={tr} title={t("grid.freshness.updated", { age: formatAge(row.computed_last_seen, now, locale) })}>
      <FreshnessMark tier={tr} />
      <span>{formatAgeCompact(row.computed_last_seen, now, locale)}</span>
    </span>
  );
}

/** One-letter cabin glyph in a 1 px outlined box (a shape, not a color). */
function CabinTag({ cabin }: { cabin: Cabin }) {
  return (
    <span className="ag-cabin" aria-hidden="true">
      {cabin}
    </span>
  );
}

/**
 * One cabin's line in the per-cabin layout: the EXISTING one-line mobile cell (tag, miles, the
 * `dyn` tag, mark + age), reused verbatim at every density. It is already shipped at the 112 px
 * minimum column in both languages, so there is no new width to defend — and the program short
 * name is deliberately not on it: it would ellipse to a stub at the floor, and it is in the
 * tooltip, the drawer and the cell's aria-label instead (docs/UI_PLAN.md §6.2b).
 *
 * Stale / unknown / dynamic muting is a property of the LINE here, not of the cell, so the tier
 * rides on this span and the <td> carries no data-tier in this layout.
 */
function CabinLine({ slot, now, locale, t }: { slot: CabinSlot; now: number; locale: Locale; t: Translate }) {
  const row = slot.row;
  return (
    <span className="ag-l1 ag-cabin-line" data-tier={row ? tier(row.computed_last_seen, now) : undefined} data-slot-state={slot.filtered ? "filtered" : undefined}>
      <CabinTag cabin={slot.cabin} />
      {row ? (
        <>
          <span className="ag-miles">{formatMiles(row.miles, locale)}</span>
          {slot.filtered && (
            <span className="ag-tag" title={t("grid.cell.filtered")}>
              {t("grid.cell.filtered_short")}
            </span>
          )}
          <AgeMark row={row} now={now} locale={locale} t={t} />
        </>
      ) : (
        <span className="ag-cabin-none">{t("grid.cell.none")}</span>
      )}
    </span>
  );
}

function CellBody({ cell, status, now, density, showCabinTag, perCabin, t, locale }: Pick<CellProps, "cell" | "status" | "now" | "density" | "showCabinTag" | "t" | "locale"> & { perCabin?: readonly CabinSlot[] }) {
  if (status === "loading") return <Skeleton density={density} />;
  if (status === "unmonitored") return <div className="ag-cell-in" />;
  if (status === "not_fetched") {
    // The label is drawn at every density. Blanking it below 768 px left a run of cells whose
    // only marking was a 1 px dotted outline, with no hover tooltip on a touch device to
    // recover the reason — the pattern-only case docs/UI_PLAN.md §1.4 rules out.
    return (
      <div className="ag-cell-in">
        <span aria-hidden="true">{t("grid.cell.not_fetched")}</span>
      </div>
    );
  }
  const best = cell.best;
  if (status === "none" || !best) {
    // A cell with nothing for ANY cabin keeps one centred en dash at both layouts: enumerating a
    // dash per cabin would only add noise, and the aria label still names the cabins.
    return (
      <div className="ag-cell-in">
        <span aria-hidden="true">{t("grid.cell.none")}</span>
      </div>
    );
  }
  if (perCabin) {
    return (
      <div className="ag-cell-in" data-layout="per_cabin" aria-hidden="true">
        {perCabin.map((slot) => (
          <CabinLine key={slot.cabin} slot={slot} now={now} locale={locale} t={t} />
        ))}
      </div>
    );
  }
  const miles = formatMiles(best.miles, locale);
  const tag = showCabinTag ? <CabinTag cabin={best.cabin} /> : null;
  const dynamicTag =
    status === "filtered" ? (
      // The tag is the only shrinkable item on line 1 (see .ag-tag in grid-styles.css): at the
      // 112 px minimum column it clips with an ellipsis rather than pushing the miles out of the
      // cell. The full word stays available in the title and in the cell's aria-label.
      <span className="ag-tag" title={t("grid.cell.filtered")}>
        {t("grid.cell.filtered_short")}
      </span>
    ) : null;
  if (density === "mobile") {
    // One line: "60,000 ●2h" (cabin tag kept when both cabins are shown; spec §6). The dynamic
    // tag stays too: the filtered state is never carried by the muted color alone (spec §8).
    return (
      <div className="ag-cell-in" aria-hidden="true">
        <span className="ag-l1">
          {tag}
          <span className="ag-miles">{miles}</span>
          {dynamicTag}
          <AgeMark row={best} now={now} locale={locale} t={t} />
        </span>
      </div>
    );
  }
  if (density === "tablet") {
    // Two lines: miles + tag; program + mark + age (fees and seats move to the tooltip and drawer).
    return (
      <div className="ag-cell-in" aria-hidden="true">
        <span className="ag-l1">
          {tag}
          <span className="ag-miles">{miles}</span>
          {dynamicTag}
        </span>
        <span className="ag-l3">
          <span className="ag-program">{programShortName(best.program)}</span>
          <AgeMark row={best} now={now} locale={locale} t={t} />
        </span>
      </div>
    );
  }
  // Three lines: miles; fees left / seats right (flex, no separator); program / mark + age.
  return (
    <div className="ag-cell-in" aria-hidden="true">
      <span className="ag-l1">
        {tag}
        <span className="ag-miles">{miles}</span>
        {dynamicTag}
      </span>
      <span className="ag-l2">
        <span>{formatFees(best.fees_cents, best.currency, locale)}</span>
        <span>{formatSeats(best.seats_left, locale, t)}</span>
      </span>
      <span className="ag-l3">
        <span className="ag-program" title={programDisplayName(best.program)}>
          {programShortName(best.program)}
        </span>
        <AgeMark row={best} now={now} locale={locale} t={t} />
      </span>
    </div>
  );
}

function CellImpl(props: CellProps) {
  const { cell, status, now, row, col, tabbable, selected, describedBy, cabins, layout, query, t, locale, register, onActivate, onFocusCell, onHover } = props;
  // Per-cabin layout draws one line per cabin, each with its own freshness: the tier is a
  // property of the line there, so the <td> carries none and the cell-level muting cannot reach
  // across both lines (grid-styles.css).
  const perCabin: CabinSlot[] | undefined = layout === "per_cabin" && query && (status === "ok" || status === "filtered") ? bestPerCabin(cell, cabins, query) : undefined;
  const tr: FreshnessTier | undefined = perCabin ? undefined : cell.best && status !== "loading" && status !== "none" ? tier(cell.best.computed_last_seen, now) : undefined;
  const label = cellAriaLabel({ ...cell, status }, locale, t, now, { cabins, perCabin });
  const title = cellTitle(cell, status, t);
  const interactive = status !== "loading";
  return (
    <td
      ref={(el) => register(el, row, col)}
      role="gridcell"
      className="ag-cell"
      data-state={status}
      data-tier={tr}
      data-row={row}
      data-col={col}
      aria-colindex={col + 2}
      aria-label={label}
      aria-selected={selected ? "true" : undefined}
      aria-busy={status === "loading" ? "true" : undefined}
      aria-describedby={describedBy}
      title={title}
      tabIndex={interactive ? (tabbable ? 0 : -1) : -1}
      onClick={interactive ? () => onActivate(row, col) : undefined}
      onFocus={interactive ? () => onFocusCell(row, col) : undefined}
      onMouseEnter={() => onHover(row, col, true)}
      onMouseLeave={() => onHover(row, col, false)}
    >
      <CellBody cell={cell} status={status} now={now} density={props.density} showCabinTag={props.showCabinTag} perCabin={perCabin} t={t} locale={locale} />
    </td>
  );
}

/** Memoized: hover and focus changes elsewhere in the grid do not re-render this cell. */
export const Cell = memo(CellImpl);
