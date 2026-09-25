"use client";
/**
 * One award option on the Web workspace (UI/UX v1 T18): what seats.aero reported for it, unknowns said as unknown,
 * the source's own time, and "Save option", which keeps it for this account on this browser. Values come from the
 * trusted snapshot, never from anything a model wrote.
 */
import type { Locale } from "@awardgrid/core/i18n";
import { useT } from "@awardgrid/core/i18n/client";
import { dayLabel, feesLabel, formatMiles, programLabel, resultName, seatsLabel, timeLabel } from "@awardgrid/core/workspace/present";
import { cabinName } from "@awardgrid/core/workspace/query-editor";
import type { WorkspaceRow } from "@awardgrid/core/workspace/types";

export interface OptionCardProps {
  row: WorkspaceRow;
  snapshotId: string;
  locale: Locale;
  now: string;
  saved: boolean;
  busy: boolean;
  onSave: () => void;
  /** T19: open the option's details (local; nothing is fetched). */
  onOpen?: (opener: HTMLElement) => void;
  /** T21: the card's heading level, one below the heading it sits under (the page's h1, or a cell's or day's h2). */
  headingLevel?: 2 | 3;
}

export function OptionCard({ row, snapshotId, locale, now, saved, busy, onSave, onOpen, headingLevel = 3 }: OptionCardProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const t = useT();
  const v = row.value;
  const miles = locale === "zh" ? `${formatMiles(v.miles)} 里程` : `${formatMiles(v.miles)} miles`;
  return (
    <article className="ag-web-option" data-row-key={row.key} data-snapshot-id={snapshotId}>
      <div className="ag-web-option-main">
        <Heading className="ag-web-option-route">
          {v.origin} → {v.dest}
        </Heading>
        <p className="ag-web-option-meta">
          {dayLabel(v.date, locale)} · {cabinName(v.cabin, locale)} · {programLabel(v.program)}
        </p>
        <p className="ag-web-option-miles tabular">{miles}</p>
        <p className="ag-web-option-meta tabular">
          {feesLabel(v.fees_cents, v.currency, locale)} · {seatsLabel(v.seats_left, locale)}
        </p>
        <p className="ag-web-option-time">{timeLabel(row.time, now, locale)}</p>
      </div>
      <div className="ag-web-option-actions">
        {onOpen ? (
          <button type="button" className="ag-web-button" onClick={(e) => onOpen(e.currentTarget)} aria-label={t("workspace.view_option_named", { name: resultName(v, locale) })}>
            {t("workspace.view_option")}
          </button>
        ) : null}
        <button type="button" className="ag-web-button" aria-pressed={saved} disabled={busy || saved} onClick={onSave}>
          {saved ? t("workspace.option_saved") : t("workspace.save_option")}
        </button>
      </div>
    </article>
  );
}
