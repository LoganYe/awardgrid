"use client";

/**
 * One program's offer for the selected cell (spec §3.5): miles, fees, seats, direct or with
 * stops, operating airlines as plain text codes, and the freshness mark with "Seen by
 * seats.aero 2 h ago". "Show flights" spends one seats.aero call and expands the flight rows
 * underneath (flights-list.tsx).
 *
 * Program names are text — never a logo, never a brand color (kickoff §0.1). The cost of the
 * button sits in its `title`, not beside it (docs/UI_PLAN.md §8 row 11), so the row reads as
 * data rather than as a warning.
 */
import { useState } from "react";
import { apiTrips } from "@/components/grid/api";
import { FreshnessMark } from "@/components/grid/freshness-mark";
import { FlightsList, type FlightsState } from "@/components/grid/cell-drawer/flights-list";
import { drawerFees } from "@/components/grid/cell-drawer/copy-details";
import { Button } from "@/components/ui/button";
import { cabinName, formatMiles, formatSeats } from "@awardgrid/core/grid/format";
import { formatAge, tier } from "@awardgrid/core/grid/freshness";
import { programDisplayName } from "@awardgrid/core/grid/ranking";
import type { AvailabilityRow } from "@awardgrid/core/grid/types";
import { useLocale, useT } from "@awardgrid/core/i18n/client";
import type { TripsForUserResult } from "@/lib/server/find";

export interface ProgramRowProps {
  row: AvailabilityRow;
  /** Epoch ms the freshness age is measured against. */
  now: number;
  /** The query's dynamic-pricing scope; the fallback for a row that does not carry its own. */
  includeFiltered: boolean;
  /** The query's min_cabin_pct; Get Trips must ask in the same scope, or the flight list
   * would show itineraries the grid excluded (or hide ones it counted). */
  minCabinPct: number;
  /** Fees and the booking link learned from Get Trips flow back into the grid. */
  onTripsLoaded: (row: AvailabilityRow, result: TripsForUserResult) => void;
}

export function ProgramRow({ row, now, includeFiltered, minCabinPct, onTripsLoaded }: ProgramRowProps) {
  const t = useT();
  const locale = useLocale();
  const [flights, setFlights] = useState<FlightsState>({ status: "idle" });
  const tr = tier(row.computed_last_seen, now);
  const loaded = flights.status === "ok";

  async function load() {
    setFlights({ status: "loading" });
    // Ask in the ROW's own scope, falling back to the query's. The two differ for a
    // `dynamic: true` row borrowed into a plain grid, which appendCachedDynamicRows takes from
    // the include_filtered=true cache scope: asking with the query's false would price a row
    // that scope never held, and the #52 fee write-back would find no row of its own to land on
    // (it refuses to write across a scope boundary), silently wasting the call's quota.
    const res = await apiTrips(
      row.source_id,
      row.cabin,
      row.include_filtered ?? includeFiltered,
      row.min_cabin_pct ?? minCabinPct,
    );
    if (res.ok) {
      setFlights({ status: "ok", result: res.value });
      onTripsLoaded(row, res.value);
    } else {
      setFlights({ status: "error", failure: res });
    }
  }

  return (
    <section className="agd-prog" data-tier={tr} data-program={row.program} data-testid="program-row">
      <div className="agd-prog-head">
        <h3 className="agd-prog-name">{programDisplayName(row.program)}</h3>
        <span className="agd-age t-meta" data-tier={tr}>
          <FreshnessMark tier={tr} />
          <span>{t("grid.freshness.updated", { age: formatAge(row.computed_last_seen, now, locale) })}</span>
        </span>
      </div>

      <p className="agd-stats t-body">
        <span className="agd-miles" data-testid="program-miles" data-miles={row.miles}>
          {formatMiles(row.miles, locale)} {t("grid.cell.miles")}
        </span>
        {/*
          里程 behaves like a unit after a number, so "70,000 里程" reads correctly; 税费 is a
          category noun and has to precede its value, or "$169.70 税费" reads as "the $169.70
          fee" rather than "fees: $169.70". The order is per language, not per string.
        */}
        <span data-testid="program-fees">
          {locale === "zh" ? `${t("grid.cell.fees")} ${drawerFees(row, locale)}` : `${drawerFees(row, locale)} ${t("grid.cell.fees")}`}
        </span>
        <span>{formatSeats(row.seats_left, locale, t)}</span>
        {/* Stops and cabin wrap together: as five separate items the cabin word orphaned onto a
            line of its own in every program block on the 390 px sheet. */}
        <span className="agd-stats-tail">
          <span>{row.direct ? t("grid.cell.direct") : t("grid.drawer.with_stops")}</span>
          <span>{cabinName(row.cabin, t)}</span>
        </span>
        {row.dynamic === true && <span className="agd-muted">{t("grid.cell.filtered")}</span>}
      </p>

      {row.airlines.length > 0 && (
        <p className="agd-muted t-meta">{t("grid.drawer.operated_by", { airlines: row.airlines.join(", ") })}</p>
      )}

      {/* The fees column reads "—" until a Get Trips call fills it in; say why, once. */}
      {row.fees_cents === null && !loaded && <p className="agd-muted t-meta">{t("grid.sheet.fees_after_load")}</p>}

      {!loaded && (
        <div>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={flights.status === "loading"}
            title={t("grid.sheet.load_trips_cost")}
            onClick={() => void load()}
            data-testid="show-flights"
          >
            {flights.status === "loading" ? t("grid.sheet.loading_trips") : t("grid.sheet.load_trips")}
          </Button>
        </div>
      )}

      <FlightsList state={flights} onRetry={() => void load()} />
    </section>
  );
}
