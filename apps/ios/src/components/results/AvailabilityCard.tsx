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
 * "Save option" (T22) keeps this one option in Saved, as the Web's card does (a FavoriteV1 with this row; nothing is
 * fetched). It is the Saved tab's bookmark, in the card's top corner right beside the compare box, so the card keeps
 * its 164 pt in both languages; named "Save option", then "Saved" (the plan's own test and the Web name it so), pressed, with
 * the bookmark filled, and described by the card, whose name is the option's full name, so no two read alike (T22 review PROD-4; the Web's
 * Save is described by its row's name the same way). It stays focusable, so focus is never dropped. "Selected" is said on the day line.
 * In sample mode (app/data-source.ts SampleDataContext) the source-time line reads "Sample data".
 */
import { useContext, useId } from "react";
import { cabinName } from "@awardgrid/core/workspace/query-editor";
import { dayLabel, feesLabel, formatMiles, programLabel, resultName, seatsLabel, timeLabel } from "@awardgrid/core/workspace/present";
import type { SnapshotId, WorkspaceRow } from "@awardgrid/core/workspace/types";
import { SampleDataContext } from "../../app/data-source";
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
  /** T22: save this option on its own; without it (a saved snapshot's read-only rows) the card has no Save. */
  onSave?: () => void;
  saved?: boolean;
}

export function AvailabilityCard({ row, snapshotId, selected, onToggle, now, locale, headingLevel = 2, onOpen, onSave, saved = false }: AvailabilityCardProps) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const t = RESULTS[locale];
  const v = row.value;
  const route = `${v.origin} → ${v.dest}`;
  const day = dayLabel(v.date, locale);
  const cabin = cabinName(v.cabin, locale);
  const name = resultName(v, locale);
  const cardId = useId();
  // Sample mode (release plan step 17): the time line says "Sample data", never a source time.
  const sample = useContext(SampleDataContext);
  return (
    <article id={cardId} className="ag-result-card" data-testid="availability-card" data-row-key={row.key} data-snapshot={snapshotId} aria-label={name}>
      <div className="ag-result-card-top">
        <div className="ag-result-card-head">
          <Heading className="ag-result-route">{route}</Heading>
          <p className="ag-result-when">
            <span>{day}</span>
            <span className="ag-result-cabin">{cabin}</span>
            {/* On the day line, so it never widens the corner that holds the bookmark and the box (T22). */}
            {selected ? <span className="ag-result-selected">{t.selected}</span> : null}
          </p>
        </div>
        {onSave || onToggle ? (
          <div className="ag-result-controls">
            {onSave ? (
              <button
                type="button"
                className="ag-result-save"
                aria-label={saved ? t.optionSaved : t.saveOption}
                aria-describedby={cardId}
                aria-pressed={saved}
                aria-disabled={saved || undefined}
                onClick={() => {
                  if (!saved) onSave();
                }}
              >
                <Icon name="bookmark" />
              </button>
            ) : null}
            {onToggle ? (
              <label className="ag-result-select">
                <input type="checkbox" checked={selected} aria-label={t.select(name)} onChange={(e) => onToggle(e.target.checked)} />
              </label>
            ) : null}
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
        <p className="ag-result-time">{timeLabel(row.time, now, locale, { sample })}</p>
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
