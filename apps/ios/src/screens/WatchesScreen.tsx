/**
 * Watches (UI/UX v1 T14; docs/04 S07; spec §16 "关注查询"; acceptance A24, A25).
 *
 * Every sentence on this screen is constrained by one rule from `docs/PIVOT.md` §3: "Promising a cadence the OS will
 * not honour is the one lie this product must not tell." So this screen says when a watch was last checked, never when
 * it will be; it says what the platform does (the approved "Checked when you open or return to the app. No checks or
 * push alerts while closed.", from ../watch/capabilities.ts, never guessed from the screen size); and it says there is
 * no background check, because there is none. Its words, in English and Chinese, are in ./watches-copy.ts;
 * `honesty.test.ts` fails CI on any string there that promises a cadence or claims a background check.
 *
 * Each watch is a card (S07: at least 148 tall, 16 padding, 12 apart): its name; its conditions (the structured
 * query it runs, as the results summary says them, or, for a watch still checked by its words, those words); what
 * changed since you last looked, with old and new values over the dates both checks covered; and its last state —
 * baseline saved, checked, skipped while cached results are still valid, deferred for low quota, key refused, failed
 * with the previous baseline kept, dates passed — each said as what happened, never as "no new seats". A watch whose
 * conditions need confirming says so, with Edit.
 *
 * Changes accumulate until this screen is opened, then are marked seen (they stay listed on this visit). The switch
 * pauses and resumes (44 pt, labelled); Edit opens the query editor on the watch's own conditions and saves them
 * (T14: all structured fields and the date rule); Stop watching asks first, in the app.
 */
import { copy, dayLabel, formatMiles, programShortLabel, querySubline, rangeLabel, routeLabel } from "@awardgrid/core/workspace/present";
import { cabinName, resolveDraft } from "@awardgrid/core/workspace/query-editor";
import { type Watch, type WatchChange, parseCellKey, sinceLastCheck } from "@awardgrid/core/watch";
import type { Cabin } from "@awardgrid/core/query/schema";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useOutletContext } from "react-router";
import type { AppServices } from "../app/bootstrap";
import { WithTail } from "../app/WithTail";
import { type Locale, langTag, useLocale } from "../app/locale";
import { EDITOR_COPY } from "../components/query/labels";
import { RESULTS } from "../components/results/copy";
import { Button, Notice, Sheet, Switch } from "../components/ui";
import { WATCH_CHECKS } from "../watch/capabilities";
import type { WatchCheckResult } from "../watch/runner";
import { WATCHES, type WatchesCopy } from "./watches-copy";
import "./watches.css";

function ago(iso: string, now: Date, w: WatchesCopy): string {
  const s = sinceLastCheck(iso, now);
  if (!s || (s.unit === "minute" && s.value < 1)) return w.justNow;
  return w.ago(s.value, s.unit === "minute" ? "minute" : s.unit === "hour" ? "hour" : "day");
}

/** Whether a structured watch's own dates, as saved now, have all passed. */
function datesPassed(watch: Watch, today: string): boolean {
  if (!watch.draft || watch.review) return false;
  try {
    return resolveDraft(watch.draft, today).date_to < today;
  } catch {
    return false;
  }
}

/** The last state, and the engine's own (English) message it ends with, if any. */
export function statusLine(watch: Watch, now: Date, w: WatchesCopy, run: WatchCheckResult["outcome"] | undefined, locale: Locale): { text: string; tail?: string } {
  if (!watch.enabled) return { text: w.paused };
  const r = watch.lastResult;
  // A failure newer than the last success. When it held this run's check back (the attempt clock), it is still the news.
  const failure = r?.status === "failed" && (!watch.lastCheckedAt || r.at > watch.lastCheckedAt) ? r : null;
  // A skip in this run is the freshest news about this watch: said as what happened, while it is still true.
  if (run?.status === "skipped") {
    if (run.reason === "checked_recently" && watch.lastCheckedAt && !failure) return { text: w.skipCached(ago(watch.lastCheckedAt, now, w)) };
    if (run.reason === "quota_low") return { text: w.skipQuota(copy("watch.quota", locale)) };
    if (run.reason === "no_key") return { text: w.skipNoKey };
    // Not after the dates were edited: the run's outcome is older than the watch's conditions.
    if (run.reason === "dates_passed" && datesPassed(watch, now.toISOString().slice(0, 10))) return { text: w.skipDatesPassed };
  }
  if (failure) {
    if (failure.unresolved) return { text: w.unresolved };
    // A baseline is said to be kept only when there was one.
    const kept = !failure.firstCheck;
    if (failure.refused) return { text: kept ? w.refused : w.refusedNoBaseline };
    const at = ago(failure.at, now, w);
    const say = kept ? w.failedWith : w.failed;
    return failure.message ? { text: say(at, failure.message), tail: failure.message } : { text: say(at, w.unknownError) };
  }
  if (!watch.lastCheckedAt) return { text: w.notChecked };
  if (r?.status === "checked" && r.firstCheck) return { text: w.baseline(ago(watch.lastCheckedAt, now, w)) };
  return { text: w.lastChecked(ago(watch.lastCheckedAt, now, w)) };
}

/** A change, said with its place and its old and new values. */
function changeText(change: WatchChange, w: WatchesCopy, locale: Locale, milesUnit: string): string {
  const cell = parseCellKey(change.key);
  const what = cell
    ? [dayLabel(cell.date, locale), cabinName(cell.cabin as Cabin, locale), `${cell.origin} → ${cell.dest}`, programShortLabel(cell.program)].join(" · ")
    : change.key;
  const miles = (v: { miles: number } | null) => (v ? `${formatMiles(v.miles)} ${milesUnit}` : "");
  if (change.kind === "new") return w.changeNew(what, miles(change.after));
  if (change.kind === "gone") return w.changeGone(what, miles(change.before));
  return w.changeCheaper(what, miles(change.before), miles(change.after));
}

export function WatchesScreen() {
  const services = useOutletContext<AppServices>();
  const locale = useLocale(services);
  const t = WATCHES[locale];
  const r = RESULTS[locale];
  const read = useCallback(() => services.watches.all().map((w) => ({ ...w })), [services]);
  const [watches, setWatches] = useState<Watch[]>(read);
  // What was unseen when the screen opened, kept for display after it is marked seen below.
  const [openedWith] = useState(() => new Map(services.watches.all().map((w) => [w.id, { counts: w.unseen ?? null, changes: w.unseenChanges ?? null }])));
  const [now] = useState(() => services.now());
  const english = locale === "en" ? undefined : "en";
  const title = useRef<HTMLHeadingElement>(null);

  // Back from editing a watch: focus returns to its Edit, and what happened is said, once. The region is empty when
  // it mounts and the words arrive after, so they are announced as a change; the history entry then forgets them, so
  // coming back to it does not say them again.
  const location = useLocation();
  const navigate = useNavigate();
  const [arrived] = useState(() => (location.state as { focus?: string; said?: string } | null) ?? null);
  const [said, setSaid] = useState("");
  useEffect(() => {
    if (!arrived) return;
    if (arrived.focus) document.getElementById(arrived.focus)?.focus();
    if (location.state) navigate(location.pathname, { replace: true, state: null });
    if (!arrived.said) return;
    const timer = window.setTimeout(() => setSaid(arrived.said ?? ""), 150);
    return () => window.clearTimeout(timer);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrived]);

  useEffect(() => {
    let cleared = false;
    for (const w of services.watches.all()) {
      if (w.unseen || w.unseenChanges) {
        services.watches.update(w.id, { unseen: null, unseenChanges: null });
        cleared = true;
      }
    }
    if (cleared) {
      void services.persist();
      services.notifyWatchesChanged();
    }
    return services.onWatchesChanged(() => setWatches(read()));
  }, [services, read]);

  const toggle = useCallback(
    async (w: Watch) => {
      services.watches.update(w.id, { enabled: !w.enabled });
      await services.persist();
      services.notifyWatchesChanged();
    },
    [services],
  );

  // Stopping asks first, in the screen's language (a native confirm's buttons are always English).
  const [stopping, setStopping] = useState<Watch | null>(null);
  const remove = useCallback(
    async (w: Watch) => {
      setStopping(null);
      services.watches.remove(w.id);
      await services.persist();
      services.notifyWatchesChanged();
      // Its card, and the button that asked, are gone: focus goes to the page title.
      window.requestAnimationFrame(() => title.current?.focus());
    },
    [services, setStopping],
  );

  const lastRun = services.lastWatchRun();
  const today = now.toISOString().slice(0, 10);

  /**
   * The watch's heading and conditions, in the screen's language: for a structured watch, its route, then what it
   * runs today as the results summary says a search ("Next 30 days" first when its dates move with the day); for one
   * still checked by its words, its name and those words. Never a stored sentence cut short.
   */
  const describe = (w: Watch): { title: string; conditions: string } => {
    if (w.draft && !w.review) {
      let q = w.draft.query;
      try {
        q = resolveDraft(w.draft, today);
      } catch {
        // Shown as saved.
      }
      const rolling = w.draft.dates.kind === "relative_days" ? `${EDITOR_COPY[locale].nextDays(w.draft.dates.days)} · ` : "";
      // The programs by name, not a count: two watches of one route can differ in nothing else.
      const programs = q.programs?.length ? ` · ${q.programs.map(programShortLabel).join(locale === "zh" ? "、" : ", ")}` : "";
      return { title: routeLabel(q, locale), conditions: `${rolling}${querySubline({ ...q, programs: undefined }, locale)}${programs}` };
    }
    return { title: w.name, conditions: t.byText(w.text) };
  };

  return (
    <div className="ag-watches" lang={langTag(locale)}>
      <h1 ref={title} tabIndex={-1} className="ag-watches-title">
        {t.title}
      </h1>
      <div className="ag-watches-info">
        {/* What the platform does, from its capabilities: on iOS, checks on open and return only. */}
        <p>{WATCH_CHECKS.inBackground ? copy("watch.foreground_only", locale) : copy("watch.ios", locale)}</p>
        {WATCH_CHECKS.inBackground ? null : <p>{t.noBackground}</p>}
        <p>{t.skipSoon}</p>
      </div>
      <p role="status" className="ag-watches-status">
        {said}
      </p>
      {/* The person's own watches that this version cannot use: said, and kept (T14). */}
      {services.watches.hold ? <Notice tone="warning">{services.watches.hold === "newer" ? t.heldNewer : t.heldUnreadable}</Notice> : null}
      {services.watches.keptAside ? <Notice tone="warning">{t.keptAside(services.watches.keptAside)}</Notice> : null}
      {services.watches.carried > 0 ? <Notice tone="warning">{t.carried(services.watches.carried)}</Notice> : null}

      {watches.length === 0 && !services.watches.hold ? (
        <p className="ag-watches-empty">
          {t.empty.before}
          <strong>{t.empty.action}</strong>
          {t.empty.after}
        </p>
      ) : (
        <ul className="ag-watches-list">
          {watches.map((w) => {
            const opened = openedWith.get(w.id);
            const unseen = w.unseen ?? opened?.counts ?? null;
            const changes = w.unseenChanges ?? opened?.changes ?? null;
            const run = lastRun.find((x) => x.watchId === w.id)?.outcome;
            const status = statusLine(w, now, t, run, locale);
            const shownChanges = changes ?? [];
            const total = unseen ? unseen.new + unseen.dropped + unseen.cheaper : 0;
            // Null: this check could not compare. Absent (a result from before T14): unknown, and nothing is said.
            const lr = w.lastResult;
            const compared = lr?.status === "checked" && !lr.firstCheck && lr.compared !== undefined ? lr.compared : undefined;
            const named = describe(w);
            const fullName = `${named.title}, ${named.conditions}`;
            return (
              <li key={w.id}>
                <article className="ag-watch-card" aria-labelledby={`watch-title-${w.id}`} data-testid="watch-card">
                  <h2 id={`watch-title-${w.id}`} className="ag-watch-title">
                    {named.title}
                  </h2>
                  <p id={`watch-conditions-${w.id}`} className="ag-watch-conditions">
                    {named.conditions}
                  </p>
                  {w.review ? <p className="ag-watch-review">{w.review === "dates" ? t.reviewDates : t.reviewUnparsed}</p> : null}
                  {unseen ? <p className="ag-watch-change tabular">{t.unseen(unseen)}</p> : null}
                  {shownChanges.length > 0 ? (
                    <details className="ag-watch-details">
                      <summary>{t.changesTitle}</summary>
                      <ul>
                        {shownChanges.map((c) => (
                          <li key={`${c.kind}-${c.key}-${c.at}`}>{changeText(c, t, locale, r.milesUnit)}</li>
                        ))}
                        {total > shownChanges.length ? <li>{t.moreChanges(total - shownChanges.length)}</li> : null}
                      </ul>
                    </details>
                  ) : null}
                  {compared ? <p className="ag-watch-last">{t.comparedOver(rangeLabel(compared.date_from, compared.date_to, locale))}</p> : null}
                  {compared === null ? <p className="ag-watch-last">{t.notCompared}</p> : null}
                  <p className="ag-watch-last tabular">
                    <WithTail text={status.text} tail={status.tail} tailLang={english} />
                  </p>
                  <div className="ag-watch-actions">
                    <span className="ag-watch-toggle">
                      <span id={`watch-on-label-${w.id}`}>{t.watching}</span>
                      <Switch id={`watch-on-${w.id}`} aria-labelledby={`watch-on-label-${w.id} watch-title-${w.id} watch-conditions-${w.id}`} checked={w.enabled} onChange={() => void toggle(w)} />
                    </span>
                    <Link id={`watch-edit-${w.id}`} to="/edit" state={{ watchId: w.id, from: `watch-edit-${w.id}` }} className="ag-button" aria-label={t.editName(fullName)}>
                      {t.edit}
                    </Link>
                    <Button variant="danger" aria-label={t.stopName(fullName)} onClick={() => setStopping(w)}>
                      {t.stop}
                    </Button>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
      <Sheet open={stopping !== null} title={stopping ? t.confirmStop(describe(stopping).title) : ""} closeLabel={t.close} onClose={() => setStopping(null)}>
        {/* Which watch, in full: two on one route share a title. */}
        {stopping ? <p className="ag-watch-conditions">{describe(stopping).conditions}</p> : null}
        <p style={{ margin: 0 }}>{t.confirmStopBody}</p>
        <div className="ag-watch-actions">
          <Button variant="danger" onClick={() => stopping && void remove(stopping)}>
            {t.stop}
          </Button>
          <Button onClick={() => setStopping(null)}>{t.keepWatching}</Button>
        </div>
      </Sheet>
    </div>
  );
}
