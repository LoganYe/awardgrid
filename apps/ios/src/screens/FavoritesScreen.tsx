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
 * Trip plans (release plan step 18) come first when there are any (components/plan/SavedPlans.tsx): searches typed into
 * the planner and kept without being run, each with the way to run it. Deleting one works the same way, with Undo.
 *
 * A saved snapshot opened (`SavedScreen`) shows what the Search screen showed — the rows the query asked for, in its
 * order (core projectResults) — from this device, with the note and its coverage. Nothing is fetched or refreshed.
 * "Search again" shows the conditions (with the year) and what it sends, and runs only when confirmed; dates that
 * have all passed are said, with a way to change them instead; without a key it says so, with the way to add one.
 */
import { projectResults } from "@awardgrid/core/workspace/projection";
import { copy, coverageNotices, dayLabel, feesLabel, formatMiles, programLabel, querySubline, routeLabel, seatsLabel } from "@awardgrid/core/workspace/present";
import { cabinName } from "@awardgrid/core/workspace/query-editor";
import type { FavoriteV1 } from "@awardgrid/core/workspace/types";
import type { Locale } from "../app/locale";
import { useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate, useOutletContext, useParams } from "react-router";
import type { AppServices } from "../app/bootstrap";
import { WithTail } from "../app/WithTail";
import { isSample } from "../app/data-source";
import { CAN_CONNECT } from "../app/flags";
import { useFocusOnArrival } from "../app/focus";
import { langTag, useLocale } from "../app/locale";
import { TraySlot } from "../app/tray-slot";
import { shortDateTime } from "../app/when";
import { SavedPlans, planTitleId } from "../components/plan/SavedPlans";
import { AvailabilityList } from "../components/results/AvailabilityList";
import { RESULTS } from "../components/results/copy";
import { Button, Icon, Notice, Sheet } from "../components/ui";
import { favoriteSnapshot } from "../store/favorites-store";
import type { PlanV1 } from "../store/plans-store";
import { DEFAULT_PREFERENCES } from "../workspace/workspace-store";
import { SAMPLE } from "../sample/sample-copy";
import { PLAN } from "../components/plan/plan-copy";
import { FAVORITES } from "./favorites-copy";
import "./favorites.css";

/**
 * An option saved on its own (T22, U-057: core favoriteFromOption) holds one row, and its origin names the snapshot and
 * that row. Its card, its title and its Open and Delete names say which option it is (day, cabin, program, miles, fees,
 * seats, unknowns said as unknown), as the Web's Saved does; saved results keep their query's words (T22 review PROD-2).
 */
function savedOptionLine(item: FavoriteV1, locale: Locale): string | null {
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

/** The Saved tab. */
export function FavoritesScreen() {
  const services = useOutletContext<AppServices>();
  const locale = useLocale(services);
  const f = FAVORITES[locale];
  const items = useFavorites(services);
  const plans = useSyncExternalStore(services.plans.subscribe, services.plans.all, services.plans.all);
  const usage = services.favorites.usage();
  const readOnly = services.favorites.isReadOnly();
  const unreadable = services.favorites.unreadableCount();
  const [status, setStatus] = useState<{ text: string; tail?: string; ok: boolean } | null>(null);
  // A deleted saved result or trip plan, with the token that puts it back.
  const [undo, setUndo] = useState<{ token: string; id: string; kind: "result" | "plan" } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const undoButton = useRef<HTMLButtonElement>(null);
  const traySlot = useContext(TraySlot);
  const english = locale === "en" ? undefined : "en";
  // Whether a data source is connected, for the trip plans' action: read once, sending nothing; unknown until the
  // Keychain answers.
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

  // Arrived from a link that unmounts (Back from a snapshot, "View in Saved"): focus goes where it asks.
  const returnTo = (useLocation().state as { focus?: string } | null)?.focus ?? null;
  useEffect(() => {
    if (returnTo) document.getElementById(returnTo)?.focus();
  }, [returnTo]);

  // The undo: offered for 5 seconds, held while focus or a pointer is in its bar; forgotten when it closes or the
  // screen is left, and focus is not left on nothing when it closes.
  const [held, setHeld] = useState(false);
  const pending = useRef<{ token: string; kind: "result" | "plan" } | null>(null);
  const forget = useCallback(
    (offered: { token: string; kind: "result" | "plan" }) => (offered.kind === "plan" ? services.plans : services.favorites).forget(offered.token),
    [services],
  );
  // A closed bar holds nothing.
  if (!undo && held) setHeld(false);
  useEffect(() => {
    if (!undo || held) return;
    const timer = window.setTimeout(() => {
      const hadFocus = bar.current?.contains(document.activeElement) ?? false;
      forget(undo);
      pending.current = null;
      setUndo(null);
      if (hadFocus) window.requestAnimationFrame(() => title.current?.focus());
    }, UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [undo, held, forget]);
  useEffect(
    () => () => {
      if (pending.current) forget(pending.current);
    },
    [forget],
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
    if (pending.current) forget(pending.current);
    pending.current = { token: result.undo, kind: "result" };
    setUndo({ token: result.undo, id: item.id, kind: "result" });
    // Said, with the way back; focus goes to Undo, so the way back is one action away.
    window.requestAnimationFrame(() => {
      setStatus({ text: f.removedUndo, ok: true });
      undoButton.current?.focus();
    });
  };

  /** Delete a trip plan, the same way: at once, said, with Undo for 5 seconds. */
  const removePlan = async (plan: PlanV1) => {
    if (busy) return;
    setBusy(plan.id);
    setStatus(null);
    const result = await services.plans.remove(plan.id);
    setBusy(null);
    if (!result.ok) {
      if (result.reason === "unknown") return;
      setStatus(result.reason === "write_failed" ? { text: f.removeFailed(result.message), tail: result.message, ok: false } : { text: PLAN[locale].readOnly, ok: false });
      return;
    }
    if (pending.current) forget(pending.current);
    pending.current = { token: result.undo, kind: "plan" };
    setUndo({ token: result.undo, id: plan.id, kind: "plan" });
    window.requestAnimationFrame(() => {
      setStatus({ text: f.removedUndo, ok: true });
      undoButton.current?.focus();
    });
  };

  const restore = async () => {
    if (!undo) return;
    const { token, id, kind } = undo;
    const result = await (kind === "plan" ? services.plans : services.favorites).undo(token);
    if (result.ok) {
      pending.current = null;
      setUndo(null);
      setStatus({ text: f.undone, ok: true });
      window.requestAnimationFrame(() => document.getElementById(kind === "plan" ? planTitleId(id) : `saved-open-${id}`)?.focus());
      return;
    }
    if (result.reason === "write_failed") {
      // Still deleted, and still offered: said so, with the time to try again.
      setUndo({ token, id, kind });
      setStatus({ text: f.undoFailed(result.message), tail: result.message, ok: false });
      return;
    }
    pending.current = null;
    setUndo(null);
    setStatus({ text: result.reason === "capacity" ? f.undoFull : kind === "plan" ? PLAN[locale].gone : f.gone, ok: false });
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
      <p className="ag-saved-intro">{f.intro}</p>
      {readOnly ? <Notice tone="warning">{f.readOnly}</Notice> : null}
      {unreadable > 0 ? <Notice tone="warning">{f.unreadable(unreadable)}</Notice> : null}
      {usage.count > 0 ? <p className="ag-saved-usage tabular">{f.usage(usage.count, usage.maxItems, mb(usage.bytes), mb(usage.maxBytes))}</p> : null}
      {usage.count >= usage.maxItems || usage.bytes >= usage.maxBytes * 0.98 ? <Notice tone="warning">{copy("favorite.limit", locale)}</Notice> : null}
      {/* Always in the tree, so a deletion, a restore or a failure is announced. */}
      <p role="status" className={status?.ok === false ? "ag-saved-status ag-saved-fail" : "ag-saved-status"}>
        {status ? <WithTail text={status.text} tail={status.tail} tailLang={english} /> : ""}
      </p>

      <SavedPlans services={services} locale={locale} hasKey={hasKey} busy={busy} onRemove={(plan) => void removePlan(plan)} />

      {items.length === 0 ? (
        // A store that cannot be read is not an empty one: the notice above says so, and nothing here invites saving.
        // Kept trip plans are not results either, but they are something saved: no "Nothing saved yet" over them.
        readOnly || plans.length > 0 ? null : (
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
                  {f.savedAt(shortDateTime(item.savedAt, locale))} · {f.options(shown(item).rows.length)}
                </p>
                <p className="ag-saved-card-note">{copy("favorite.snapshot", locale)}</p>
                <div className="ag-saved-card-actions">
                  <Link id={`saved-open-${item.id}`} to={`/saved/${encodeURIComponent(item.id)}`} className="ag-button ag-saved-open" aria-label={f.openName(name(item))}>
                    {f.open}
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
        {f.savedAt(shortDateTime(item.savedAt, locale))} · {f.options(projected.rows.length)}
      </p>
      <Notice tone="warning">{copy("favorite.snapshot", locale)}</Notice>
      {coverageNotices(item.coverage, projected.rows.length, locale).map((notice) => (
        <Notice key={notice.text} tone={notice.kind === "none" ? "info" : "warning"}>
          {notice.text}
        </Notice>
      ))}
      {projected.dynamicNotShown > 0 ? (
        <Notice tone="info">{RESULTS[locale].dynamicNotShown(projected.dynamicNotShown)}</Notice>
      ) : null}
      <AvailabilityList rows={projected.rows} sort={item.query.sort_by} snapshotId={item.originalSnapshotId} selected={NO_SELECTION} now={now.toISOString()} locale={locale} testId="saved-list" />
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
      <Button onClick={() => setConfirming(true)} disabled={hasKey !== true} disabledReason={hasKey === false ? f.noKey : null}>
        {f.searchAgain}
      </Button>
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
            {/* Over sample data nothing is sent: the live sentence is about seats.aero requests and today's calls. */}
            <p className="ag-saved-confirm">{isSample(services) ? SAMPLE[locale].savedSearchAgain : f.confirmSends}</p>
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
