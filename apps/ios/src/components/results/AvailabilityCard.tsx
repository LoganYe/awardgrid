/**
 * One availability option as a card (UI/UX v1 T07; docs/04 S01; reference results-light.png): route, the day with
 * its weekday and the cabin in words, miles in large tabular digits, the program, fees, seats and the source time —
 * every one of them from the trusted snapshot row, and unknown values said as unknown (core present.ts).
 *
 * The selection checkbox is a sibling of the card's content, never nested in another control, with a 44 pt target.
 * The card and its checkbox are named in full — route, day, cabin, program, miles, fees, seats (spec §19) — so two
 * options on the same route and day are never announced alike; a selected card also says "Selected" in words.
 * "View option" (T10) opens the option's details over the results; it is a button of its own, named in full, never
 * the whole card, so the checkbox and the details are two separate targets. It fetches nothing: the details show the
 * aggregate first, and only their own "View flight itineraries" spends a call.
 */
import { cabinName } from "@awardgrid/core/workspace/query-editor";
import { dayLabel, feesLabel, formatMiles, programLabel, resultName, seatsLabel, timeLabel } from "@awardgrid/core/workspace/present";
import type { SnapshotId, WorkspaceRow } from "@awardgrid/core/workspace/types";
import type { Locale } from "../../app/locale";
import { Icon } from "../ui";
import { RESULTS } from "./copy";

export interface AvailabilityCardProps {
  row: WorkspaceRow;
  snapshotId: SnapshotId;
  selected: boolean;
  /** Choose for comparison (T12). Without it the card has no checkbox: a saved snapshot's rows (T13) are read only. */
  onToggle?: (selected: boolean) => void;
  /** The app's clock, as an ISO instant, for the source time's age. */
  now: string;
  locale: Locale;
  /** The route heading's level: 2 in the list, 3 under a calendar day's heading. */
  headingLevel?: 2 | 3;
  /** Open the option's details; `returnFocusId` is this card's button, where focus comes back to. */
  onOpen?: (returnFocusId: string) => void;
}

export function AvailabilityCard({ row, snapshotId, selected, onToggle, now, locale, headingLevel = 2, onOpen }: AvailabilityCardProps) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const t = RESULTS[locale];
  const v = row.value;
  const route = `${v.origin} → ${v.dest}`;
  const day = dayLabel(v.date, locale);
  const cabin = cabinName(v.cabin, locale);
  const name = resultName(v, locale);
  return (
    <article className="ag-result-card" data-testid="availability-card" data-row-key={row.key} data-snapshot={snapshotId} aria-label={name}>
      <div className="ag-result-card-top">
        <div className="ag-result-card-head">
          <Heading className="ag-result-route">{route}</Heading>
          <p className="ag-result-when">
            <span>{day}</span>
            <span className="ag-result-cabin">{cabin}</span>
          </p>
        </div>
        {onToggle ? (
          <div className="ag-result-select-wrap">
            {selected ? <span className="ag-result-selected">{t.selected}</span> : null}
            <label className="ag-result-select">
              <input type="checkbox" checked={selected} aria-label={t.select(name)} onChange={(e) => onToggle(e.target.checked)} />
            </label>
          </div>
        ) : null}
      </div>
      <div className="ag-result-line">
        <p className="ag-result-miles" data-testid="card-miles">
          <span className="ag-miles">{formatMiles(v.miles)}</span> <span className="ag-result-unit">{t.milesUnit}</span>
        </p>
        <p className="ag-result-fees">{feesLabel(v.fees_cents, v.currency, locale)}</p>
      </div>
      <div className="ag-result-line">
        <p className="ag-result-program">{programLabel(v.program)}</p>
        <p className="ag-result-seats">{seatsLabel(v.seats_left, locale)}</p>
      </div>
      {/* The way into the details shares the source-time line, so the card keeps its 164 pt (spec §13). */}
      <div className="ag-result-foot">
        <p className="ag-result-time">{timeLabel(row.time, now, locale)}</p>
        {onOpen ? (
          <button type="button" id={`open-${row.key}`} className="ag-result-open-button" aria-label={t.viewOptionName(name)} onClick={() => onOpen(`open-${row.key}`)}>
            <span>{t.viewOption}</span>
            <Icon name="chevron-right" />
          </button>
        ) : null}
      </div>
    </article>
  );
}
