"use client";

import { ExternalLinkIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatAge, tier } from "@/lib/grid/freshness";
import { resolveDeeplink } from "@/lib/grid/deeplinks/index";
import { programDisplayName } from "@/lib/grid/ranking";
import type { AvailabilityRow, GridCell } from "@/lib/grid/types";
import { useLocale, useT } from "@/lib/i18n/client";
import type { SortBy } from "@/lib/query/schema";
import type { TripsForUserResult, TripSummary } from "@/lib/server/find";
import { cn } from "@/lib/utils";
import { apiTrips, type ApiFailure } from "@/components/grid/api";
import { FRESHNESS_GLYPH, TIER_TEXT } from "@/components/grid/grid-table";
import { formatFees, formatMiles, formatSeats } from "@/components/grid/state";
import { failureText } from "@/components/grid/empty-states";

export interface CellSheetProps {
  cell: GridCell | null;
  sortBy: SortBy;
  includeFiltered: boolean;
  now: number;
  onClose: () => void;
  /** Fees/booking link learned from Get Trips flow back into the grid rows. */
  onTripsLoaded: (row: AvailabilityRow, result: TripsForUserResult) => void;
}

type TripsState = { status: "idle" } | { status: "loading" } | { status: "ok"; result: TripsForUserResult } | { status: "error"; failure: ApiFailure };

function localTime(iso: string): string {
  // Airport-local wall time (ARCHITECTURE §2.3): show the literal HH:MM, never convert as UTC.
  const m = /T(\d{2}:\d{2})/.exec(iso);
  return m?.[1] ?? iso;
}

function localDate(iso: string): string {
  return iso.slice(0, 10);
}

function TripList({ trips }: { trips: TripSummary[] }) {
  const t = useT();
  if (trips.length === 0) return <p className="text-xs text-muted-foreground">{t("grid.sheet.no_trips")}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {trips.map((trip) => (
        <li key={trip.id} className="rounded-md border border-border p-2 text-xs">
          <div className="num flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium text-foreground">{formatMiles(trip.miles)}</span>
            <span>{formatFees(trip.fees_cents, trip.currency)}</span>
            <span>{formatSeats(trip.seats)} {t("grid.cell.seats")}</span>
            <span className="text-muted-foreground">{trip.cabin}</span>
            <span className="text-muted-foreground">{trip.stops === 0 ? t("grid.sheet.nonstop") : t("grid.sheet.stops", { n: trip.stops })}</span>
            {trip.mixed_cabin_pct !== null && <span className="text-aging">{t("grid.sheet.mixed_cabin", { pct: trip.mixed_cabin_pct })}</span>}
          </div>
          <div className="num mt-1 text-muted-foreground">
            {localDate(trip.departs_at)} {localTime(trip.departs_at)} → {localDate(trip.arrives_at)} {localTime(trip.arrives_at)} · {trip.carriers} · {trip.flight_numbers}
          </div>
          {trip.segments.length > 0 && (
            <ol className="num mt-1 flex flex-col gap-0.5 text-[11px] text-muted-foreground">
              {trip.segments.map((s, i) => (
                <li key={`${trip.id}-${i}`}>
                  {s.flight_number} {s.origin} {localTime(s.departs_at)} → {s.dest} {localTime(s.arrives_at)}
                  {s.aircraft ? ` · ${s.aircraft}` : ""}
                  {s.fare_class ? ` · ${s.fare_class}` : ""}
                </li>
              ))}
            </ol>
          )}
        </li>
      ))}
    </ul>
  );
}

function RowCard({
  row,
  now,
  includeFiltered,
  onTripsLoaded,
}: {
  row: AvailabilityRow;
  now: number;
  includeFiltered: boolean;
  onTripsLoaded: (row: AvailabilityRow, result: TripsForUserResult) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [trips, setTrips] = useState<TripsState>({ status: "idle" });
  const link = resolveDeeplink(row);
  const tr = tier(row.computed_last_seen, now);

  async function load() {
    setTrips({ status: "loading" });
    const res = await apiTrips(row.source_id, row.cabin, includeFiltered);
    if (res.ok) {
      setTrips({ status: "ok", result: res.value });
      onTripsLoaded(row, res.value);
    } else {
      setTrips({ status: "error", failure: res });
    }
  }

  const bookingLinks = trips.status === "ok" ? trips.result.booking_links : [];

  return (
    <li className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-medium">{programDisplayName(row.program)}</span>
        <span className="font-mono text-xs text-muted-foreground">{row.program}</span>
        <span className="rounded bg-muted px-1 font-mono text-xs">{row.cabin}</span>
        <span className={cn("num ml-auto text-xs", TIER_TEXT[tr])} title={t(`grid.freshness.${tr}`)}>
          {FRESHNESS_GLYPH[tr]} {t("grid.freshness.updated", { age: formatAge(row.computed_last_seen, now, locale) })}
        </span>
      </div>
      <div className="num flex flex-wrap gap-x-3 text-xs">
        <span className="font-medium text-foreground">{formatMiles(row.miles)} {t("grid.cell.miles")}</span>
        <span>{formatFees(row.fees_cents, row.currency)} {t("grid.cell.fees")}</span>
        <span>{formatSeats(row.seats_left)} {t("grid.cell.seats")}</span>
        {row.direct && <span>{t("grid.cell.direct")}</span>}
        {row.airlines.length > 0 && (
          <span className="text-muted-foreground">
            {t("grid.sheet.airlines")}: {row.airlines.join(", ")}
          </span>
        )}
      </div>
      {row.fees_cents === null && trips.status !== "ok" && <p className="text-[11px] text-muted-foreground">{t("grid.sheet.fees_after_load")}</p>}
      <div className="flex flex-col gap-1 text-xs">
        {link.url ? (
          <a href={link.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline">
            <ExternalLinkIcon className="size-3" />
            {t("grid.open_in_program")}: {programDisplayName(row.program)}
          </a>
        ) : (
          <span className="text-muted-foreground">{t("grid.sheet.no_link")}</span>
        )}
        <span className="text-[11px] text-muted-foreground">{t("grid.deeplink_caveat")}</span>
        {bookingLinks.length > 0 && (
          <div className="mt-1 flex flex-col gap-0.5">
            <span className="font-medium">{t("grid.sheet.booking_links")}</span>
            {bookingLinks.map((l) => (
              <span key={l.link} className="flex flex-col">
                <a href={l.link} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline">
                  <ExternalLinkIcon className="size-3" />
                  {l.label}
                  {l.primary ? " ★" : ""}
                </a>
                <span className="text-[11px] text-muted-foreground">{t("grid.deeplink_caveat")}</span>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" size="xs" variant="outline" disabled={trips.status === "loading"} onClick={load}>
          {trips.status === "loading" ? t("grid.sheet.loading_trips") : t("grid.sheet.load_trips")}
        </Button>
        <span className="text-[11px] text-muted-foreground">{t("grid.sheet.load_trips_cost")}</span>
      </div>
      {trips.status === "error" && <p className="text-xs text-destructive">{failureText(t, locale, trips.failure)}</p>}
      {trips.status === "ok" && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">{t("grid.sheet.local_times")}</span>
          <TripList trips={trips.result.trips} />
        </div>
      )}
    </li>
  );
}

const SORT_LABEL: Record<SortBy, "grid.sort.miles_asc" | "grid.sort.fees_asc" | "grid.sort.seats_desc" | "grid.sort.date_asc"> = {
  miles_asc: "grid.sort.miles_asc",
  fees_asc: "grid.sort.fees_asc",
  seats_desc: "grid.sort.seats_desc",
  date_asc: "grid.sort.date_asc",
};

/** Cell drawer: every program's row for this pair/date, deeplinks with the caveat, Get Trips on demand. */
export function CellSheet({ cell, sortBy, includeFiltered, now, onClose, onTripsLoaded }: CellSheetProps) {
  const t = useT();
  return (
    <Sheet open={cell !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        {cell && (
          <>
            <SheetHeader>
              <SheetTitle className="num">{t("grid.sheet.title", { origin: cell.origin, dest: cell.dest, date: cell.date })}</SheetTitle>
              <SheetDescription>{t("grid.sheet.subtitle", { sort: t(SORT_LABEL[sortBy]) })}</SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-4">
              {cell.status === "unmonitored" && <p className="text-sm text-muted-foreground">{t("grid.cell.not_monitored")}</p>}
              {cell.status !== "unmonitored" && cell.all.length === 0 && <p className="text-sm text-muted-foreground">{t("grid.empty.no_results")}</p>}
              <ul className="flex flex-col gap-2">
                {cell.all.map((row) => (
                  <RowCard key={`${row.program}-${row.cabin}-${row.source_id}`} row={row} now={now} includeFiltered={includeFiltered} onTripsLoaded={onTripsLoaded} />
                ))}
              </ul>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
