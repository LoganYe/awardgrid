/**
 * Saved (UI/UX v1 T13; docs/04 S06; spec §16 "收藏快照"; acceptance A23).
 *
 * The list: each saved snapshot as a card — its query, when it was saved, how many options it showed, and the fixed
 * "Saved snapshot; availability may change." — with Open and Delete. How much of the store is used is shown, by count
 * and by size (either limit can be the one that fills). An empty list says what saving is for and offers "Go to
 * Search"; it never shows made-up saved items. A store that cannot be read says so instead of looking empty.
 *
 * Deleting takes effect at once and is said, with the way back: focus moves to Undo (the approved word), in a bar
 * above the tab bar, for 5 seconds — longer while focus or a pointer is in it. A restore that cannot be written keeps
 * the Undo offered and says the item is still deleted.
 *
 * A saved snapshot opened (`SavedScreen`) shows what the Search screen showed — the rows the query asked for, in its
 * order (core projectResults) — from this device, with the note and its coverage. Nothing is fetched or refreshed.
 * "Search again" shows the conditions (with the year) and what it sends, and runs only when confirmed; dates that
 * have all passed are said, with a way to change them instead; without a key it says so, with the way to add one.
 *
 * The OAuth flavour (release plan step 18b; AppServices.shortTermMs) keeps seats.aero's results for 24 hours at most.
 * An item past that keeps its search and a summary (core FavoriteV1.rowsRemoved): its card says so, "Open and search
 * again" names what opening does, and opening it searches its own query again (AppServices.refreshSaved) and shows the
 * fresh results — unless its dates have all passed, or no account is connected, which are said instead.
 */
import { projectResults } from "@awardgrid/core/workspace/projection";
import { copy, coverageNotices, dayLabel, feesLabel, formatMiles, programLabel, querySubline, routeLabel, seatsLabel } from "@awardgrid/core/workspace/present";
import { cabinName } from "@awardgrid/core/workspace/query-editor";
import type { Cabin } from "@awardgrid/core/query/schema";
import type { FavoriteV1 } from "@awardgrid/core/workspace/types";
import type { Locale } from "../app/locale";
import { useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate, useOutletContext, useParams } from "react-router";
import type { AppServices } from "../app/bootstrap";
import { WithTail } from "../app/WithTail";
import { CAN_CONNECT } from "../app/flags";
import { useFocusOnArrival } from "../app/focus";
import { langTag, useLocale } from "../app/locale";
import { TraySlot } from "../app/tray-slot";
import { shortDateTime } from "../app/when";
import { AvailabilityList } from "../components/results/AvailabilityList";
import { RESULTS } from "../components/results/copy";
import { Button, Icon, Notice, Sheet } from "../components/ui";
import { favoriteSnapshot, savedOptionIdentity } from "../store/favorites-store";
import { DEFAULT_PREFERENCES } from "../workspace/workspace-store";
import { FAVORITES } from "./favorites-copy";
import "./favorites.css";

/**
 * An option saved on its own (T22, U-057: core favoriteFromOption) holds one row, and its origin names the snapshot and
 * that row. Its card, its title and its Open and Delete names say which option it is (day, cabin, program, miles, fees,
 * seats, unknowns said as unknown), as the Web's Saved does; saved results keep their query's words (T22 review PROD-2).
 */
function savedOptionLine(item: FavoriteV1, locale: Locale): string | null {
  // An option whose row was removed (short-term caching) is still named: its day, cabin and program.
  if (item.rowsRemoved) {
    const option = savedOptionIdentity(item);
    return option ? [dayLabel(option.date, locale), cabinName(option.cabin as Cabin, locale), programLabel(option.program)].join(" · ") : null;
  }
  const row = item.rows.length === 1 && item.originalSnapshotId.includes("#") ? item.rows[0]! : null;
  if (!row) return null;
  const v = row.value;
  return [dayLabel(v.date, locale), cabinName(v.cabin, locale), programLabel(v.program), `${formatMiles(v.miles)} ${RESULTS[locale].milesUnit}`, feesLabel(v.fees_cents, v.currency, locale), seatsLabel(v.seats_left, locale)].join(" · ");
}

const UNDO_MS = 5000;
const NO_SELECTION: ReadonlySet<string> = new Set();
/** The Saved title's id: where focus lands when a link that unmounts brings the person here. */
export const SAVED_TITLE = "saved-title";

function useFavorites(services: AppServices): readonly FavoriteV1[] {
  return useSyncExternalStore(services.favorites.subscribe, services.favorites.all, services.favorites.all);
}

/** What the Search screen showed of a saved snapshot: the rows its query asked for, in its order. */
function shown(item: FavoriteV1) {
  return projectResults(favoriteSnapshot(item), { ...DEFAULT_PREFERENCES, sort: item.query.sort_by, localFilter: {} });
}

const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

/** How many options an item showed: counted now, or, once its rows were removed, as recorded then. */
function optionCount(item: FavoriteV1): number {
  return item.rowsRemoved ? item.rowsRemoved.options : shown(item).rows.length;
}

/** The Saved tab. */
export function FavoritesScreen() {
  const services = useOutletContext<AppServices>();
  const locale = useLocale(services);
  const f = FAVORITES[locale];
  const items = useFavorites(services);
  const usage = services.favorites.usage();
  const readOnly = services.favorites.isReadOnly();
  const unreadable = services.favorites.unreadableCount();
  const [status, setStatus] = useState<{ text: string; tail?: string; ok: boolean } | null>(null);
  const [undo, setUndo] = useState<{ token: string; id: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const undoButton = useRef<HTMLButtonElement>(null);
  const traySlot = useContext(TraySlot);
  const english = locale === "en" ? undefined : "en";

  // Arrived from a link that unmounts (Back from a snapshot, "View in Saved"): focus goes where it asks.
  const returnTo = (useLocation().state as { focus?: string } | null)?.focus ?? null;
  useEffect(() => {
    if (returnTo) document.getElementById(returnTo)?.focus();
  }, [returnTo]);

  // The undo: offered for 5 seconds, held while focus or a pointer is in its bar; forgotten when it closes or the
  // screen is left, and focus is not left on nothing when it closes.
  const [held, setHeld] = useState(false);
  const pending = useRef<string | null>(null);
  // A closed bar holds nothing.
  if (!undo && held) setHeld(false);
  useEffect(() => {
    if (!undo || held) return;
    const timer = window.setTimeout(() => {
      const hadFocus = bar.current?.contains(document.activeElement) ?? false;
      services.favorites.forget(undo.token);
      pending.current = null;
      setUndo(null);
      if (hadFocus) window.requestAnimationFrame(() => title.current?.focus());
    }, UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [undo, held, services]);
  useEffect(
    () => () => {
      if (pending.current) services.favorites.forget(pending.current);
    },
    [services],
  );

  const name = (item: FavoriteV1) => `${routeLabel(item.query, locale)}, ${savedOptionLine(item, locale) ?? querySubline(item.query, locale)}`;

  const remove = async (item: FavoriteV1) => {
    if (busy) return;
    setBusy(item.id);
    setStatus(null);
    const result = await services.favorites.remove(item.id);
    setBusy(null);
    if (!result.ok) {
      // Already gone (a second press): nothing to say.
      if (result.reason === "unknown") return;
      setStatus(result.reason === "write_failed" ? { text: f.removeFailed(result.message), tail: result.message, ok: false } : { text: f.readOnly, ok: false });
      return;
    }
    // An earlier undo still offered is replaced: forget it.
    if (pending.current) services.favorites.forget(pending.current);
    pending.current = result.undo;
    setUndo({ token: result.undo, id: item.id });
    // Said, with the way back; focus goes to Undo, so the way back is one action away.
    window.requestAnimationFrame(() => {
      setStatus({ text: f.removedUndo, ok: true });
      undoButton.current?.focus();
    });
  };

  const restore = async () => {
    if (!undo) return;
    const { token, id } = undo;
    const result = await services.favorites.undo(token);
    if (result.ok) {
      pending.current = null;
      setUndo(null);
      setStatus({ text: f.undone, ok: true });
      window.requestAnimationFrame(() => document.getElementById(`saved-open-${id}`)?.focus());
      return;
    }
    if (result.reason === "write_failed") {
      // Still deleted, and still offered: said so, with the time to try again.
      setUndo({ token, id });
      setStatus({ text: f.undoFailed(result.message), tail: result.message, ok: false });
      return;
    }
    pending.current = null;
    setUndo(null);
    setStatus({ text: result.reason === "capacity" ? f.undoFull : f.gone, ok: false });
    window.requestAnimationFrame(() => title.current?.focus());
  };

  const undoBar = undo ? (
    <div
      ref={bar}
      className="ag-undo-bar"
      data-testid="undo-bar"
      lang={langTag(locale)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false);
      }}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
    >
      <p className="ag-undo-text">{f.removed}</p>
      <button ref={undoButton} type="button" className="ag-button" onClick={() => void restore()}>
        {copy("favorite.undo", locale)}
      </button>
    </div>
  ) : null;

  return (
    <div className="ag-saved" lang={langTag(locale)}>
      <h1 ref={title} id={SAVED_TITLE} tabIndex={-1} className="ag-saved-title">
        {f.title}
      </h1>
      <p className="ag-saved-intro">{services.shortTermMs != null ? f.shortTerm.intro : f.intro}</p>
      {readOnly ? <Notice tone="warning">{f.readOnly}</Notice> : null}
      {unreadable > 0 ? <Notice tone="warning">{f.unreadable(unreadable)}</Notice> : null}
      {usage.count > 0 ? <p className="ag-saved-usage tabular">{f.usage(usage.count, usage.maxItems, mb(usage.bytes), mb(usage.maxBytes))}</p> : null}
      {usage.count >= usage.maxItems || usage.bytes >= usage.maxBytes * 0.98 ? <Notice tone="warning">{copy("favorite.limit", locale)}</Notice> : null}
      {/* Always in the tree, so a deletion, a restore or a failure is announced. */}
      <p role="status" className={status?.ok === false ? "ag-saved-status ag-saved-fail" : "ag-saved-status"}>
        {status ? <WithTail text={status.text} tail={status.tail} tailLang={english} /> : ""}
      </p>

      {items.length === 0 ? (
        // A store that cannot be read is not an empty one: the notice above says so, and nothing here invites saving.
        readOnly ? null : (
          <div className="ag-saved-empty">
            <h2 className="ag-saved-empty-title">{f.emptyTitle}</h2>
            <p className="ag-saved-intro">{f.emptyBody}</p>
            <Link to="/" state={{ focus: "search-title" }} className="ag-button ag-button-primary ag-button-block">
              {f.goSearch}
            </Link>
          </div>
        )
      ) : (
        <ul className="ag-saved-list">
          {items.map((item) => (
            <li key={item.id}>
              <article className="ag-saved-card" aria-labelledby={`saved-title-${item.id}`} data-testid="favorite-card">
                <h2 id={`saved-title-${item.id}`} className="ag-saved-card-title">
                  {routeLabel(item.query, locale)}
                </h2>
                <p className="ag-saved-card-sub">{querySubline(item.query, locale)}</p>
                {savedOptionLine(item, locale) ? <p className="ag-saved-card-option tabular">{savedOptionLine(item, locale)}</p> : null}
                <p className="ag-saved-card-meta tabular">
                  {f.savedAt(shortDateTime(item.savedAt, locale))} · {f.options(optionCount(item))}
                </p>
                <p className="ag-saved-card-note">{item.rowsRemoved ? f.shortTerm.removedNote : copy("favorite.snapshot", locale)}</p>
                <div className="ag-saved-card-actions">
                  <Link
                    id={`saved-open-${item.id}`}
                    to={`/saved/${encodeURIComponent(item.id)}`}
                    className="ag-button ag-saved-open"
                    aria-label={item.rowsRemoved ? f.shortTerm.openName(name(item)) : f.openName(name(item))}
                  >
                    {item.rowsRemoved ? f.shortTerm.open : f.open}
                  </Link>
                  <Button variant="danger" aria-label={f.removeName(name(item))} loading={busy === item.id} onClick={() => void remove(item)}>
                    {f.remove}
                  </Button>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
      {undoBar && traySlot ? createPortal(undoBar, traySlot) : null}
    </div>
  );
}

/** One saved snapshot, as it was saved: read from this device, nothing fetched. */
export function SavedScreen() {
  const services = useOutletContext<AppServices>();
  const locale = useLocale(services);
  const f = FAVORITES[locale];
  const navigate = useNavigate();
  const { id = "" } = useParams();
  useFavorites(services);
  const item = services.favorites.get(id);
  const title = useRef<HTMLHeadingElement>(null);
  useFocusOnArrival(title);
  const [confirming, setConfirming] = useState(false);
  const [now] = useState(() => services.now());
  // The OAuth flavour: an item whose results passed 24 hours is searched again when opened (once per visit).
  const [refresh, setRefresh] = useState<{ state: "searching" | "searched" } | { state: "failed"; message: string } | null>(null);
  const refreshed = useRef(false);
  // Whether there is a key to search with: read once, sending nothing; unknown until the Keychain answers.
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void services.keys
      .get()
      .then((key) => live && setHasKey(Boolean(key)))
      .catch(() => live && setHasKey(false));
    return () => {
      live = false;
    };
  }, [services]);

  const searchAgainNow = async () => {
    setRefresh({ state: "searching" });
    const outcome = await services.refreshSaved(id);
    if (outcome.ok) setRefresh({ state: "searched" });
    else if (outcome.reason === "search") setRefresh({ state: "failed", message: outcome.error.message ?? outcome.error.error });
    else if (outcome.reason === "write") setRefresh({ state: "failed", message: outcome.detail.reason === "write_failed" ? outcome.detail.message : outcome.detail.reason });
    else setRefresh(null);
  };
  const stale = Boolean(item?.rowsRemoved);
  const pastNow = item ? item.query.date_to < now.toISOString().slice(0, 10) : false;
  useEffect(() => {
    if (!stale || pastNow || hasKey !== true || refreshed.current) return;
    refreshed.current = true;
    void searchAgainNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per visit, when the key is known
  }, [stale, pastNow, hasKey]);

  const back = (
    <Link to="/saved" state={{ focus: `saved-open-${id}` }} className="ag-saved-back">
      <Icon name="chevron-left" />
      <span>{f.back}</span>
    </Link>
  );

  if (!item) {
    return (
      <div className="ag-saved" lang={langTag(locale)}>
        {back}
        <h1 ref={title} tabIndex={-1} className="ag-saved-title">
          {f.title}
        </h1>
        <p className="ag-saved-intro">{f.gone}</p>
      </div>
    );
  }

  const projected = shown(item);
  // The saved dates against today (UTC, the query's own clock): all past, or partly.
  const today = now.toISOString().slice(0, 10);
  const allPast = item.query.date_to < today;
  const somePast = !allPast && item.query.date_from < today;
  const removed = item.rowsRemoved ?? null;

  const run = () => {
    setConfirming(false);
    // The saved snapshot is not touched: a new search, on the Search screen, as any other.
    void services.workspace.run(item.query).then(() => services.persist());
    navigate("/", { state: { focus: "search-title" } });
  };

  return (
    <div className="ag-saved" lang={langTag(locale)} data-testid="saved-snapshot">
      {back}
      <h1 ref={title} tabIndex={-1} className="ag-saved-title">
        {routeLabel(item.query, locale)}
      </h1>
      <p className="ag-saved-card-sub">{querySubline(item.query, locale)}</p>
      {savedOptionLine(item, locale) ? <p className="ag-saved-card-option tabular">{savedOptionLine(item, locale)}</p> : null}
      <p className="ag-saved-card-meta tabular">
        {f.savedAt(shortDateTime(item.savedAt, locale))} · {f.options(optionCount(item))}
      </p>
      {/* Said as it happens: the search again that opening an item past 24 hours starts, and how it went. */}
      <p role="status" className="ag-saved-status">
        {refresh?.state === "searching" ? f.shortTerm.searching : refresh?.state === "searched" ? f.shortTerm.searched : ""}
      </p>
      {refresh?.state === "failed" ? (
        <p role="alert" className="ag-saved-status ag-saved-fail">
          <WithTail text={f.shortTerm.failed(refresh.message)} tail={refresh.message} tailLang={locale === "en" ? undefined : "en"} />
        </p>
      ) : null}
      {removed ? <Notice tone="info">{f.shortTerm.removedNote}</Notice> : <Notice tone="warning">{copy("favorite.snapshot", locale)}</Notice>}
      {removed && allPast ? <p className="ag-saved-confirm ag-saved-fail">{f.pastAll}</p> : null}
      {removed ? null : coverageNotices(item.coverage, projected.rows.length, locale).map((notice) => (
        <Notice key={notice.text} tone={notice.kind === "none" ? "info" : "warning"}>
          {notice.text}
        </Notice>
      ))}
      {projected.dynamicNotShown > 0 ? (
        <Notice tone="info">{RESULTS[locale].dynamicNotShown(projected.dynamicNotShown)}</Notice>
      ) : null}
      {removed ? null : (
        <AvailabilityList rows={projected.rows} sort={item.query.sort_by} snapshotId={item.originalSnapshotId} selected={NO_SELECTION} now={now.toISOString()} locale={locale} testId="saved-list" />
      )}
      {hasKey === false ? (
        <p className="ag-saved-intro">
          {f.noKey}
          {/* The way to connect one, unless this build has none (VITE_AG_CONNECT=0, app/flags.ts). */}
          {CAN_CONNECT ? (
            <>
              {" "}
              <Link to="/settings/seats" className="ag-saved-inline-link">
                {f.goSettings}
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      {removed ? (
        // Opening searched again already; after a failure, the way to try once more. Changing past dates is above.
        refresh?.state === "failed" ? (
          <Button onClick={() => void searchAgainNow()} disabled={hasKey !== true} disabledReason={hasKey === false ? f.noKey : null}>
            {f.searchAgain}
          </Button>
        ) : allPast ? (
          <Button onClick={() => navigate("/edit", { state: { query: item.query, from: "search-title" } })}>{f.editDates}</Button>
        ) : null
      ) : (
        <Button onClick={() => setConfirming(true)} disabled={hasKey !== true} disabledReason={hasKey === false ? f.noKey : null}>
          {f.searchAgain}
        </Button>
      )}
      <Sheet open={confirming} title={f.confirmTitle} closeLabel={f.close} onClose={() => setConfirming(false)}>
        <p className="ag-saved-confirm">
          <strong>{routeLabel(item.query, locale)}</strong>
          <br />
          {querySubline(item.query, locale)}
          <br />
          <span className="tabular">{f.dates(item.query.date_from, item.query.date_to)}</span>
        </p>
        {allPast ? (
          <>
            <p className="ag-saved-confirm ag-saved-fail">{f.pastAll}</p>
            <div className="ag-saved-card-actions">
              <Button variant="primary" onClick={() => navigate("/edit", { state: { query: item.query, from: "search-title" } })}>
                {f.editDates}
              </Button>
              <Button onClick={() => setConfirming(false)}>{f.confirmKeep}</Button>
            </div>
          </>
        ) : (
          <>
            {somePast ? <p className="ag-saved-confirm">{f.pastSome}</p> : null}
            <p className="ag-saved-confirm">{f.confirmBody}</p>
            <p className="ag-saved-confirm">{f.confirmSends}</p>
            <div className="ag-saved-card-actions">
              <Button variant="primary" onClick={run}>
                {f.confirmRun}
              </Button>
              <Button onClick={() => setConfirming(false)}>{f.confirmKeep}</Button>
            </div>
          </>
        )}
      </Sheet>
    </div>
  );
}
