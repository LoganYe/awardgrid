"use client";

/**
 * The flights a program returns for one availability row (spec §3.5 "Show flights"): skeleton
 * rows while the Get Trips call is in flight, then one block per trip with its segments.
 *
 * Times are printed exactly as seats.aero sends them — airport-local wall clock, with a "Z"
 * suffix that is NOT UTC (ARCHITECTURE §2.3). Nothing here parses them into a Date, so nothing
 * can shift them by a timezone; the drawer says so in one muted line.
 */
import { Button } from "@/components/ui/button";
import { failureText } from "@/components/grid/empty-states";
import type { ApiFailure } from "@/components/grid/api";
import { formatFees, formatGridDate, formatMiles, formatSeats } from "@/lib/grid/format";
import { useLocale, useT } from "@/lib/i18n/client";
import type { TripsForUserResult, TripSegmentSummary, TripSummary } from "@/lib/server/find";

export type FlightsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; result: TripsForUserResult }
  | { status: "error"; failure: ApiFailure };

export interface FlightsListProps {
  state: FlightsState;
  /** Retry after a failure (the same Get Trips call; it costs another seats.aero call). */
  onRetry: () => void;
}

/** "2026-03-14T08:05:00Z" → "08:05". Never converted: the value is already airport-local. */
export function localTime(iso: string): string {
  return /T(\d{2}:\d{2})/.exec(iso)?.[1] ?? iso;
}

/** The calendar day part, for the rare arrival that lands on another date. */
export function localDate(iso: string): string {
  return iso.slice(0, 10);
}

function Skeleton() {
  const t = useT();
  return (
    <div className="agd-skel" data-testid="flights-skeleton">
      <span className="sr-only" role="status">
        {t("grid.sheet.loading_trips")}
      </span>
      <div className="agd-skel-bar" aria-hidden="true" />
      <div className="agd-skel-bar" aria-hidden="true" />
      <div className="agd-skel-bar" aria-hidden="true" />
    </div>
  );
}

function Segment({ segment, departDate }: { segment: TripSegmentSummary; departDate: string }) {
  const locale = useLocale();
  // Each side carries its own date. Comparing only the arrival against the trip's departure day
  // printed one date at the END of the leg for a segment that had DEPARTED on a later day, so an
  // overnight connection read as leaving on the trip's first morning.
  const legDeparts = localDate(segment.departs_at);
  const departsLater = legDeparts !== departDate;
  const arrivesLater = localDate(segment.arrives_at) !== legDeparts;
  return (
    <span className="agd-leg">
      <span>{segment.flight_number}</span>
      <span>
        {segment.origin} {localTime(segment.departs_at)}
        {departsLater && <span className="agd-airlines"> {formatGridDate(legDeparts, locale)}</span>}
        <span aria-hidden="true"> → </span>
        {segment.dest} {localTime(segment.arrives_at)}
        {arrivesLater && <span className="agd-airlines"> {formatGridDate(localDate(segment.arrives_at), locale)}</span>}
      </span>
      {segment.aircraft && <span className="agd-airlines">{segment.aircraft}</span>}
    </span>
  );
}

function Trip({ trip }: { trip: TripSummary }) {
  const t = useT();
  const locale = useLocale();
  const departDate = localDate(trip.departs_at);
  return (
    <li className="agd-flight">
      {trip.segments.length > 0 ? (
        trip.segments.map((segment, i) => <Segment key={`${trip.id}-${i}`} segment={segment} departDate={departDate} />)
      ) : (
        <span className="agd-leg">
          <span>{trip.flight_numbers}</span>
          <span>
            {localTime(trip.departs_at)}
            <span aria-hidden="true"> → </span>
            {localTime(trip.arrives_at)}
          </span>
          <span className="agd-airlines">{trip.carriers}</span>
        </span>
      )}
      <span className="agd-flight-meta t-meta">
        <span>{trip.stops === 0 ? t("grid.sheet.nonstop") : trip.stops === 1 ? t("grid.sheet.stop_one") : t("grid.sheet.stops", { n: trip.stops })}</span>
        <span>
          {formatMiles(trip.miles, locale)} {t("grid.cell.miles")}
        </span>
        <span>
          {formatFees(trip.fees_cents, trip.currency, locale)} {t("grid.cell.fees")}
        </span>
        <span>{formatSeats(trip.seats, locale, t)}</span>
        {trip.mixed_cabin_pct !== null && <span>{t("grid.sheet.mixed_cabin", { pct: trip.mixed_cabin_pct })}</span>}
      </span>
    </li>
  );
}

/** Skeleton · flights · "no flight-level detail" · error with retry · quota with its reset time. */
export function FlightsList({ state, onRetry }: FlightsListProps) {
  const t = useT();
  const locale = useLocale();

  if (state.status === "idle") return null;
  if (state.status === "loading") return <Skeleton />;

  if (state.status === "error") {
    // A quota refusal is not a failure of this button: it says what ran out and when it comes
    // back, and offers no retry that could only fail again.
    const quota = state.failure.error === "quota";
    return (
      <p className="t-meta text-error" role="alert" data-testid="flights-error">
        {quota ? failureText(t, locale, state.failure) : t("grid.drawer.flights_error")}
        {!quota && (
          <Button type="button" size="xs" variant="outline" className="ml-2" onClick={onRetry} data-testid="flights-retry">
            {t("common.retry")}
          </Button>
        )}
      </p>
    );
  }

  if (state.result.trips.length === 0) return <p className="t-meta text-fg-muted">{t("grid.sheet.no_trips")}</p>;

  return (
    <>
      <p className="t-meta text-fg-muted">{t("grid.sheet.local_times")}</p>
      <ul className="agd-flights t-meta" data-testid="flights-list">
        {state.result.trips.map((trip) => (
          <Trip key={trip.id} trip={trip} />
        ))}
      </ul>
    </>
  );
}
