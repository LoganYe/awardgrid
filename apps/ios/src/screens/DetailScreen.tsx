/**
 * An option's details (UI/UX v1 T10; docs/04 S04; reference itinerary-detail.png for its layout — its flight data is
 * fictional): a full-height page over the results, opened from a card's "View option" or a one-option matrix cell.
 *
 *   - **The aggregate first, and free.** Route, day, cabin, miles and fees, program, seats and source time come from
 *     the shown snapshot's row; opening the page sends nothing.
 *   - **"View flight itineraries" is the only thing that spends** — one Get Trips call through the app's own path
 *     (workspace/detail-service.ts) — and says so by being an explicit button. Itineraries loaded earlier in this run
 *     are shown again from this device, dated, without a call. A failure keeps the aggregate on screen.
 *   - **Itinerary times are airport-local** as seats.aero gives them; nothing is converted through the device's zone.
 *     Values it does not give are said as not provided; nothing is filled in.
 *   - **One way out to the program**, and only on a trusted link (core deeplinks/trusted.ts), with the approved
 *     caveat beside it; without one, "Copy search details". Never "book", "lock" or "ticketed".
 *   - **Back** — the button, Esc, the browser — closes the page; the results underneath were never unmounted, and
 *     focus returns to what opened it. A reference that is not one of the shown results is refused: nothing is sent.
 *   - **Sample mode** (release plan step 17): the banner at the top, "Sample data" for the source time, "Sample data ·
 *     on this device" for the data line, and no way out to a program: sample options have no booking or program
 *     links, and the page says so.
 */
import { detailLink } from "@awardgrid/core/grid/deeplinks/trusted";
import { cabinName } from "@awardgrid/core/workspace/query-editor";
import {
  ageLabel,
  copy,
  dayLabel,
  detailsCopyText,
  durationLabel,
  feesLabel,
  formatMiles,
  localTimeLabel,
  programLabel,
  seatsLabel,
  stopsLabel,
  timeLabel,
} from "@awardgrid/core/workspace/present";
import type { TripSummary } from "@awardgrid/core/seatsaero/trips";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useLocation, useNavigate, useOutletContext, useParams } from "react-router";
import type { AppServices } from "../app/bootstrap";
import { isSample } from "../app/data-source";
import { STORE } from "../app/flags";
import { langTag, useLocale } from "../app/locale";
import { ASK_SURFACES } from "../ask/ask-surface-copy";
import { RESULTS } from "../components/results/copy";
import { SeatsAttribution } from "../components/SeatsAttribution";
import { SampleBanner } from "../components/SampleBanner";
import { SAMPLE } from "../sample/sample-copy";
import { Button, Icon, IconButton, Notice } from "../components/ui";
import type { DetailLoaded } from "../workspace/detail-service";
import type { ApiFailure } from "../search/search";

/** Put text on the clipboard: the async API where the page may use it, else a selected textarea. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const done = document.execCommand("copy");
    area.remove();
    return done;
  }
}

export function DetailScreen() {
  const services = useOutletContext<AppServices>();
  const locale = useLocale(services);
  const t = RESULTS[locale];
  const d = t.detail;
  const params = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const ref = { snapshotId: params.snapshotId ?? "", rowKey: params.rowKey ?? "" };
  const found = services.details.resolve(ref);
  const [loaded, setLoaded] = useState<DetailLoaded | null>(() => services.details.peek(ref));
  // A load of this option may still be running (the page was closed and opened again): join it, never send another.
  const [busy, setBusy] = useState(() => services.details.pending(ref) !== null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  // Focus arrives on the page's heading, and goes back to what opened the page when it closes, however it closes —
  // or, when that is gone (a details link opened directly), to the results' status line or title.
  const returnFocus = useRef((location.state as { returnFocus?: string } | null)?.returnFocus ?? null);
  // Opened from an AI answer's reference (T15): Back returns there, and says so.
  const [fromAsk] = useState(() => (location.state as { from?: string } | null)?.from === "ask");
  useEffect(() => {
    heading.current?.focus();
    const back = returnFocus.current;
    return () => {
      window.requestAnimationFrame(() => {
        const target = (back ? document.getElementById(back) : null) ?? document.getElementById("results-status") ?? document.getElementById("search-title");
        target?.focus();
      });
    };
  }, []);
  useEffect(() => {
    const running = services.details.pending(ref);
    if (!running) return;
    let live = true;
    void running.then((outcome) => {
      if (!live) return;
      if (outcome.kind === "loaded") setLoaded(outcome.value);
      else if (outcome.kind === "failed") setFailure(outcome.error);
      setBusy(false);
    });
    return () => {
      live = false;
    };
    // Once, on opening: the option does not change while the page is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => {
    // Back to the results entry when the page was opened from inside the app; else to the results themselves.
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate("/", { replace: true });
  };
  // Esc is Back wherever focus is on the page (a button the page replaced leaves it on <body>), unless something
  // inside already used it or an input method is composing.
  const onEscape = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
    event.preventDefault();
    close();
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onEscape(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);
  const tripsHeading = useRef<HTMLHeadingElement>(null);

  const load = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const outcome = await services.details.load(ref);
      if (outcome.kind === "loaded") {
        setLoaded(outcome.value);
        // The button that was pressed is gone: focus goes to what it loaded.
        window.requestAnimationFrame(() => tripsHeading.current?.focus());
      } else if (outcome.kind === "failed") {
        setFailure(outcome.error);
      }
      // The fee a load learns is written to the cache; the quota it spent is saved with everything else.
      await services.persist();
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <header className="ag-detail-header">
      <IconButton icon="chevron-left" label={!STORE && fromAsk ? ASK_SURFACES[locale].search.backFromAnswer : d.back} onClick={close} />
      <h1 className="ag-detail-title" tabIndex={-1} ref={heading}>
        {d.title}
      </h1>
    </header>
  );

  if (!found) {
    return (
      <div className="ag-detail" data-testid="detail-screen" lang={langTag(locale)} role="dialog" aria-modal="true" aria-labelledby="detail-title">
        {header}
        <div className="ag-detail-body" id="detail-title">
          <Notice tone="warning">{d.notInResults}</Notice>
        </div>
      </div>
    );
  }

  const row = found.row.value;
  const now = services.now();
  const sample = isSample(services);
  // Sample options have no booking or program links (release plan D10): none is offered, whatever the row would allow.
  const link = sample ? null : (loaded?.link ?? detailLink(row, []));
  const fees = feesLabel(row.fees_cents, row.currency, locale);

  const trip = (trip: TripSummary, i: number) => {
    const from = localTimeLabel(trip.departs_at, locale);
    const to = localTimeLabel(trip.arrives_at, locale);
    const first = trip.segments[0];
    const last = trip.segments.at(-1);
    // seats.aero's MixedCabinPct is the share flown below the cabin, 1–100 when there is any: always worth saying.
    const mixed = trip.mixed_cabin_pct !== null && trip.mixed_cabin_pct > 0 ? trip.mixed_cabin_pct : null;
    return (
      <article key={trip.id} className="ag-trip" data-testid="trip-card" aria-labelledby={`trip-${i}`}>
        <div className="ag-trip-head">
          <h3 id={`trip-${i}`} className="ag-trip-title">
            {d.itinerary(i + 1)}
          </h3>
          <span className="ag-trip-meta">
            {stopsLabel(trip.stops, locale)} · {durationLabel(trip.duration, locale)}
          </span>
        </div>
        <div className="ag-trip-times">
          <div>
            <p className="ag-trip-time">{from.time ?? "—"}</p>
            <p className="ag-trip-airport">{first?.origin ?? row.origin}</p>
            <p className="ag-trip-day">{from.day}</p>
          </div>
          <span className="ag-trip-arrow" aria-hidden="true">
            →
          </span>
          <div className="ag-trip-end">
            <p className="ag-trip-time">{to.time ?? "—"}</p>
            <p className="ag-trip-airport">{last?.dest ?? row.dest}</p>
            <p className="ag-trip-day">{to.day}</p>
          </div>
        </div>
        <dl className="ag-trip-facts">
          <div>
            <dt>{d.miles}</dt>
            <dd>
              <span className="tabular">{formatMiles(trip.miles)}</span> {t.milesUnit}
            </dd>
          </div>
          <div>
            <dt>{d.carrierFlight}</dt>
            <dd>
              {trip.carriers || d.notProvided} · {trip.flight_numbers || d.notProvided}
            </dd>
          </div>
          <div>
            <dt>{d.cabin}</dt>
            <dd>
              {cabinName(row.cabin, locale)}
              {mixed !== null ? ` · ${d.mixedCabin(mixed)}` : ""}
            </dd>
          </div>
          <div>
            <dt>{d.fees}</dt>
            <dd>{feesLabel(trip.fees_cents, trip.currency, locale)}</dd>
          </div>
          <div>
            <dt>{d.seats}</dt>
            <dd>{seatsLabel(trip.seats, locale)}</dd>
          </div>
          <div>
            <dt>{d.times}</dt>
            <dd>{d.localTimes}</dd>
          </div>
        </dl>
        {mixed !== null ? <p className="ag-trip-note">{copy("help.mixed", locale)}</p> : null}
        {trip.segments.length > 1 ? (
          <div className="ag-trip-segments">
            <p className="ag-trip-segments-title">{d.segments}</p>
            <ol>
              {trip.segments.map((s, n) => {
                const a = localTimeLabel(s.departs_at, locale);
                const b = localTimeLabel(s.arrives_at, locale);
                // Each end's airport-local date and time, so a day change shows (docs/04 S04).
                const end = (x: ReturnType<typeof localTimeLabel>) => (x.time && x.date ? `${x.date} ${x.time}` : x.day);
                return (
                  <li key={`${s.flight_number}-${n}`}>
                    {s.flight_number || d.notProvided} · {s.origin} {end(a)} → {s.dest} {end(b)}
                  </li>
                );
              })}
            </ol>
          </div>
        ) : null}
      </article>
    );
  };

  return (
    <div className="ag-detail" data-testid="detail-screen" lang={langTag(locale)} role="dialog" aria-modal="true" aria-labelledby="detail-summary-title">
      {header}
      <div className="ag-detail-body">
        <SampleBanner services={services} locale={locale} />
        <section className="ag-detail-summary" aria-labelledby="detail-summary-title">
          <p className="ag-detail-when">
            {dayLabel(row.date, locale)} · {cabinName(row.cabin, locale)}
          </p>
          <h2 className="ag-detail-route" id="detail-summary-title">
            {row.origin} → {row.dest}
          </h2>
          <p className="ag-detail-price">
            <span className="ag-detail-miles">{formatMiles(row.miles)}</span> {t.milesUnit} · {fees}
          </p>
          <p className="ag-detail-program">{d.via(programLabel(row.program))}</p>
          <p className="ag-detail-seats">{seatsLabel(row.seats_left, locale)}</p>
        </section>

        <section className="ag-detail-section" aria-labelledby="detail-trips">
          <h2 className="ag-detail-section-title" id="detail-trips" tabIndex={-1} ref={tripsHeading}>
            {d.itineraries}
          </h2>
          {loaded ? (
            loaded.trips.length > 0 ? (
              loaded.trips.map(trip)
            ) : (
              <p className="ag-detail-meta">{d.noItineraries}</p>
            )
          ) : (
            <Button variant="primary" block onClick={() => void load()} loading={busy} loadingLabel={d.loading}>
              {copy("details.load", locale)}
            </Button>
          )}
          {failure ? (
            <Notice tone="danger" live>
              <span lang={locale === "en" ? undefined : "en"}>{failure.message ?? failure.error}</span>
            </Notice>
          ) : null}
        </section>

        <section className="ag-detail-section" aria-labelledby="detail-data">
          <h2 className="ag-detail-section-title" id="detail-data">
            {d.dataHeading}
          </h2>
          <p className="ag-detail-meta">{timeLabel(found.row.time, now.toISOString(), locale, { sample })}</p>
          {loaded ? <p className="ag-detail-meta">{d.loadedOnDevice(ageLabel(Math.max(0, now.getTime() - Date.parse(loaded.loadedAt)), locale))}</p> : null}
          <p className="ag-detail-meta">{copy("help.program", locale)}</p>
          {sample ? (
            <p className="ag-detail-meta ag-sample-source">{SAMPLE[locale].attribution}</p>
          ) : (
            <SeatsAttribution className="ag-detail-meta" text={copy("data.source", locale)} locale={locale} />
          )}
        </section>
      </div>

      <footer className="ag-detail-actions" data-links={link ? "2" : "1"}>
        {/* The approved caveat stands above the way out whenever there is one, loaded or not. Sample options have none. */}
        {link ? <p className="ag-detail-caveat">{copy("details.external", locale)}</p> : null}
        {sample ? <p className="ag-detail-caveat">{SAMPLE[locale].noLinks}</p> : null}
        <Button
          onClick={() => {
            // Cleared first, so a second copy is announced again; cleared after a while so it does not linger.
            setCopied(null);
            void copyText(detailsCopyText(row, locale)).then((ok) => {
              window.requestAnimationFrame(() => setCopied(ok ? d.copied : d.copyFailed));
              window.setTimeout(() => setCopied(null), 4000);
            });
          }}
        >
          {copy("details.copy", locale)}
        </Button>
        {link ? (
          // One primary at a time: before itineraries are loaded, loading them is the main action.
          <a
            className={`ag-button ${loaded ? "ag-button-primary" : ""} ag-detail-out`}
            href={link.url}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`${d.openProgram} (${link.host})`}
          >
            <span>{d.openProgram}</span>
            <Icon name="external" />
          </a>
        ) : null}
        <p className="ag-detail-status" role="status">
          {copied ?? ""}
        </p>
      </footer>
    </div>
  );
}
