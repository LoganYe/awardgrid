"use client";
/**
 * One option's details beside the results (UI/UX v1 T19; docs/04 S10 "detail 400"; spec §15, §17): what the snapshot
 * already holds, opened without a request — miles, cabin, program, fees, seats, the source's own time — with the
 * caveats that apply. Loading the flight itineraries is a separate, explicit action: its cost is said before the
 * button, it goes through the account's own /api/trips (its key, cache and quota, on the server), and the header's
 * count re-reads afterwards. At ≥ 1280 it docks beside the results (400 wide, the main column 896); below, it
 * overlays them; below 768 it is a full-height page. Esc or Close returns focus to what opened it.
 */
import { useState } from "react";
import type { Locale } from "@awardgrid/core/i18n";
import { useLocale, useT } from "@awardgrid/core/i18n/client";
import { copy, dayLabel, detailsCopyText, feesLabel, formatMiles, programLabel, seatsLabel, timeLabel } from "@awardgrid/core/workspace/present";
import { cabinName } from "@awardgrid/core/workspace/query-editor";
import type { ResultSnapshot, WorkspaceRow } from "@awardgrid/core/workspace/types";
import { DrawerShell } from "@/components/drawers/drawer-shell";
import { apiTrips } from "@/components/grid/api";
import { FlightsList, type FlightsState } from "@/components/grid/cell-drawer/flights-list";
import { notifyUsageChanged } from "@/components/shell/quota-indicator";
import { SeatsAttribution } from "@/components/shell/seats-attribution";
import "@/components/grid/cell-drawer/cell-drawer.css";

export const DETAIL_PANEL_WIDTH = 400;

export interface DetailPanelProps {
  open: boolean;
  snapshot: ResultSnapshot | null;
  row: WorkspaceRow | null;
  now: string;
  container: HTMLElement | null;
  /** The control that opened it; focus goes back there on close. */
  opener: HTMLElement | null;
  saved: boolean;
  saveDisabled: boolean;
  onSave: () => void;
  onClose: () => void;
}

const safeLink = (url: string | null): string | null => {
  if (!url) return null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
};

export function DetailPanel({ open, snapshot, row, now, container, opener, saved, saveDisabled, onSave, onClose }: DetailPanelProps) {
  const t = useT();
  const locale = useLocale();
  const v = row?.value ?? null;
  const key = snapshot && row ? `${snapshot.id}#${row.key}` : "";
  const [flights, setFlights] = useState<{ key: string; state: FlightsState }>({ key: "", state: { status: "idle" } });
  const [copied, setCopied] = useState<{ key: string; ok: boolean } | null>(null);
  const trips = flights.key === key ? flights.state : ({ status: "idle" } as FlightsState);

  const load = async () => {
    if (!snapshot || !v) return;
    const forKey = key;
    setFlights({ key: forKey, state: { status: "loading" } });
    const result = await apiTrips(v.source_id, v.cabin, snapshot.query.include_filtered, snapshot.query.min_cabin_pct);
    // A request that went out may have spent a call, answered or not: the header re-reads the server's count.
    notifyUsageChanged();
    setFlights((current) => (current.key === forKey ? { key: forKey, state: result.ok ? { status: "ok", result: result.value } : { status: "error", failure: result } } : current));
  };

  const copyDetails = async () => {
    if (!v) return;
    try {
      await navigator.clipboard.writeText(detailsCopyText(v, locale));
      setCopied({ key, ok: true });
    } catch {
      setCopied({ key, ok: false });
    }
  };

  const booking = safeLink(v?.booking_url ?? null);
  const milesText = v ? milesWithUnit(v.miles, locale) : "";

  return (
    <DrawerShell
      open={open && v !== null}
      onClose={onClose}
      title={v ? `${v.origin} → ${v.dest}` : ""}
      subtitle={v ? <p className="t-meta text-fg-muted">{`${dayLabel(v.date, locale)} · ${cabinName(v.cabin, locale)}`}</p> : null}
      width={DETAIL_PANEL_WIDTH}
      mobile="sheet"
      container={container}
      opener={opener}
      openerKey={key}
      className="ag-ws-tokens"
      data-testid="detail-panel"
    >
      {v && row && snapshot ? (
        <div className="ag-ws-detail" data-row-key={row.key} data-snapshot-id={snapshot.id}>
          <p className="ag-ws-detail-miles tabular">{milesText}</p>
          <dl className="ag-ws-detail-facts">
            <div>
              <dt>{t("workspace.col.program")}</dt>
              <dd>
                {programLabel(v.program)}
                <span className="ag-ws-sub">{copy("help.program", locale)}</span>
              </dd>
            </div>
            <div>
              <dt>{t("workspace.col.cabin")}</dt>
              <dd>{cabinName(v.cabin, locale)}</dd>
            </div>
            <div>
              <dt>{t("workspace.col.fees")}</dt>
              <dd className="tabular">{feesLabel(v.fees_cents, v.currency, locale)}</dd>
            </div>
            <div>
              <dt>{t("workspace.col.seats")}</dt>
              <dd className="tabular">{seatsLabel(v.seats_left, locale)}</dd>
            </div>
            <div>
              <dt>{t("workspace.col.time")}</dt>
              <dd>{timeLabel(row.time, now, locale)}</dd>
            </div>
          </dl>
          {snapshot.query.min_cabin_pct < 100 ? <p className="ag-ws-note">{copy("help.mixed", locale)}</p> : null}
          <p className="ag-ws-note">{copy("details.external", locale)}</p>
          <div className="ag-ws-detail-actions">
            <button type="button" className="ag-ws-button" aria-pressed={saved} disabled={saveDisabled || saved} onClick={onSave}>
              {saved ? t("workspace.option_saved") : t("workspace.save_option")}
            </button>
            <button type="button" className="ag-ws-button ag-ws-button-quiet" onClick={() => void copyDetails()}>
              {copy("details.copy", locale)}
            </button>
            {booking ? (
              <a className="ag-ws-button ag-ws-button-quiet" href={booking} target="_blank" rel="noopener noreferrer">
                {t("workspace.detail.book")}
              </a>
            ) : null}
          </div>
          {copied && copied.key === key ? (
            <p role="status" className="ag-ws-note">
              {copied.ok ? t("workspace.detail.copied") : t("workspace.detail.copy_failed")}
            </p>
          ) : null}
          <section className="ag-ws-detail-trips" aria-labelledby="ag-ws-trips-title">
            <h3 id="ag-ws-trips-title" className="ag-ws-section-title">
              {copy("details.load", locale)}
            </h3>
            <p className="ag-ws-note" id="ag-ws-trips-cost">
              {t("workspace.detail.trips_cost")}
            </p>
            {trips.status === "idle" ? (
              <button type="button" className="ag-ws-button ag-ws-button-primary" aria-describedby="ag-ws-trips-cost" onClick={() => void load()}>
                {copy("details.load", locale)}
              </button>
            ) : null}
            <div aria-live="polite">
              <FlightsList state={trips} onRetry={() => void load()} />
            </div>
          </section>
          <SeatsAttribution className="ag-ws-note" />
        </div>
      ) : null}
    </DrawerShell>
  );
}

function milesWithUnit(miles: number, locale: Locale): string {
  return locale === "zh" ? `${formatMiles(miles)} 里程` : `${formatMiles(miles)} miles`;
}
