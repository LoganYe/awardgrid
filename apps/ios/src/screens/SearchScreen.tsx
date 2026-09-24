/**
 * The search screen: the shown results, and the way to a new search (UI/UX v1 T07; docs/04 S01; reference
 * results-light.png / results-dark.png).
 *
 * With results, the page is the S01 stack at the 390 pt default — header 52 (title, AI assistance), query summary 64
 * (the SHOWN snapshot's query; it opens the editor), filters 44 (each opens the editor at its condition: changing a
 * query condition is always an explicit submit), result view 44 (List, Calendar or Matrix, and the sort), status 28 (how many options, how fresh, the data attribution), 12 gap — then the view, and after
 * it the actions (search again, watch, ask) and today's quota. Header and summary stay on screen while the list
 * scrolls. Without results it is a text search and the way into the editor.
 *
 * All three views read one projection of the shown snapshot (T08, core projection.ts): the same rows, the same local
 * filter and sort, one selection. Switching view, sort or calendar cabin is local — it never fetches.
 *
 * The honesty rules, which are not cosmetic:
 *
 *   - **No cancel button.** Phase 0 measured that `AbortSignal` does not cancel a native request
 *     (docs/PHASE0.md §3): a "Cancel" that implied the search had been called off would be a lie about the user's
 *     money, so a search is bounded by a native timeout and simply cannot be recalled.
 *   - **"Last checked", never "next check".** PIVOT §3: nothing here promises a cadence iOS cannot honour.
 *   - **Every value from the snapshot, unknown said as unknown** (core present.ts): fees not yet confirmed, seat count
 *     not provided, source time unknown — never free, sold out or "just now".
 *   - **A new search never takes the shown results away**: while it runs they stay, labelled; if it fails they stay,
 *     labelled, with why (docs/03 §3, copy run.inflight / run.old). The labels come from the workspace's run state.
 *   - **Coverage is said, not implied**: partial, unknown, empty and not monitored each have their own words.
 *
 * Searches run through the workspace (T05); the last search is its shown snapshot, which a relaunch shows with the
 * time it was saved, without running it. The screen marks itself with its language (the other screens are English
 * until T11).
 */
import { SortBy } from "@awardgrid/core/query/schema";
import { projectResults } from "@awardgrid/core/workspace/projection";
import { type Locale, ageLabel, copy, coverageNotices, moreConditionsCount, optionsCount, sortLabel, sortShortLabel } from "@awardgrid/core/workspace/present";
import { textReproducesQuery } from "@awardgrid/core/workspace/query-editor";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link, useLocation, useOutletContext } from "react-router";
import type { AppServices } from "../app/bootstrap";
import { langTag } from "../app/locale";
import { ASK_ABOUT_SEARCH } from "../ask/labels";
import type { ApiFailure, ApiResult, FindValue, QuotaSnapshotView } from "../search/search";
import type { LastSearchEntry } from "../search/last-search";
import { TextSearch } from "../components/query/TextSearch";
import { AvailabilityCalendar } from "../components/results/AvailabilityCalendar";
import { AvailabilityList } from "../components/results/AvailabilityList";
import { AvailabilityMatrix } from "../components/results/AvailabilityMatrix";
import { RESULTS } from "../components/results/copy";
import { QuerySummary } from "../components/results/QuerySummary";
import { Button, Icon, Notice, SegmentedControl } from "../components/ui";
import { RETURN_FOCUS } from "./QueryEditorScreen";

/**
 * Why a run failed, from the workspace's run state, for a run this screen did not start itself (the query editor)
 * or after the screen was left and opened again. A run this screen started shows the engine's own message instead.
 */
function runFailureText(code: string, locale: Locale): string {
  const texts = RESULTS[locale].runFailed;
  return code in texts ? texts[code as keyof typeof texts] : texts.other;
}

/** An age on the app clock, or null when the time is missing or later than the clock. */
function ageSince(iso: string | null | undefined, now: Date, locale: Locale): string | null {
  if (!iso) return null;
  const ms = now.getTime() - Date.parse(iso);
  return Number.isFinite(ms) && ms >= 0 ? ageLabel(ms, locale) : null;
}

/**
 * How fresh the shown results are, for the status line: saved on this device (with its age when the clock allows),
 * from this device's cache (with the age of its oldest row), or how many calls a fresh answer cost.
 */
function freshness(shown: LastSearchEntry, now: Date, locale: Locale): string {
  const t = RESULTS[locale];
  if (shown.savedAt) {
    const age = ageSince(shown.savedAt, now, locale);
    return age ? t.saved(age) : t.savedNoAge;
  }
  if (shown.value.served_from_cache) return t.fromCache(ageSince(shown.value.fetched_at_min, now, locale));
  return shown.value.api_calls_used === null ? t.callsUnknown : t.calls(shown.value.api_calls_used);
}

/** Where focus goes back to when the editor closes: the control that opened it (U-027). */
const CHIP_IDS = { programs: "chip-programs", stops: "chip-stops", more: "chip-more" } as const;

export function SearchScreen() {
  const services = useOutletContext<AppServices>();
  const locale = services.locale;
  const t = RESULTS[locale];
  // What is shown follows the workspace: re-render when it changes, then read the shown snapshot's view.
  const workspace = useSyncExternalStore(services.workspace.subscribe, services.workspace.getState, services.workspace.getState);
  const shown = services.lastSearch.get();
  const snapshot = workspace.displayedSnapshot;
  const running = workspace.run.kind === "running";
  // Local only while this screen's own request is being prepared or saved; the run itself is the workspace's.
  const [busy, setBusy] = useState(false);
  // The last attempt's failure message, for an attempt made from this screen, with the revision it belongs to.
  const [attempt, setAttempt] = useState<{ error: ApiFailure; revision: number } | null>(null);
  const failure = attempt && attempt.revision === workspace.revision ? attempt.error : null;
  const location = useLocation();
  // Whether the shown search's words, read again, give that search (as read on the day it was made).
  const madeOn = snapshot?.createdAt.slice(0, 10) ?? null;
  const reproduces = useMemo(() => (shown && madeOn ? textReproducesQuery(shown.text, shown.value.query, madeOn) : false), [shown, madeOn]);
  const [quota, setQuota] = useState<QuotaSnapshotView | null>(null);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [watchMessage, setWatchMessage] = useState<string | null>(null);
  const now = services.now();
  const asking = useSyncExternalStore(services.ask.subscribe, services.ask.isRunning, services.ask.isRunning);

  useEffect(() => {
    void services.keys.get().then((k) => setHasKey(Boolean(k)));
    void services.engine.quotaView().then(setQuota);
  }, [services]);

  // A run that settles — from this screen or from the editor — may have spent calls: read the counter again.
  const settled = workspace.run.kind === "finished" || workspace.run.kind === "failed" ? workspace.run.runId : null;
  useEffect(() => {
    if (settled) void services.engine.quotaView().then(setQuota);
  }, [services, settled]);

  // Back from the editor: focus returns to what opened it (the summary, a filter chip, "Build a search").
  const returnFocus = (location.state as { focus?: string } | null)?.focus;
  useEffect(() => {
    if (returnFocus) document.getElementById(returnFocus)?.focus();
  }, [returnFocus]);

  /** Run a search from this screen: a typed one (no results yet), or the shown one again. */
  const runSearch = useCallback(
    async (start: () => Promise<ApiResult<FindValue>>) => {
      setBusy(true);
      setWatchMessage(null);
      try {
        const res = await start();
        setAttempt(res.ok ? null : { error: res, revision: services.workspace.getState().revision });
        // A search is the moment worth persisting: it is the only thing that spends quota.
        await services.persist();
      } finally {
        setBusy(false);
      }
    },
    [services],
  );

  // Search again: the words, when they reproduce the search (a rolling "next 30 days" rolls); else the search itself.
  const searchAgain = () => {
    if (!shown) return;
    const text = shown.text;
    void runSearch(() => (reproduces ? services.searchText(text) : services.rerunShown()));
  };

  /**
   * Watch the search on screen, as its text. The TEXT is stored, not the parsed dates, so "next 30 days" keeps
   * meaning the next 30 days — the fix for the web app's issue #47. A search whose text cannot hold it cannot be
   * watched as text yet (U-024; watches become structured in T14).
   */
  const shownText = shown?.text ?? null;
  const watchThis = useCallback(async () => {
    if (shownText === null) return;
    const trimmed = shownText.trim();
    const added = services.watches.add({
      id: crypto.randomUUID(),
      name: trimmed.length > 60 ? `${trimmed.slice(0, 59)}…` : trimmed,
      text: trimmed,
      lastCheckedAt: null,
      baseline: [],
      dropThresholdPct: 10,
      enabled: true,
      createdAt: new Date().toISOString(),
    });
    if (!added.ok) {
      setWatchMessage(added.reason === "duplicate" ? t.alreadyWatching : t.watchLimit);
      return;
    }
    setWatchMessage(t.watching);
    await services.persist();
    services.notifyWatchesChanged();
  }, [services, shownText, t]);

  const searching = busy || running;
  const value = shown?.value ?? null;
  const prefs = workspace.preferences;
  // One projection for every view: the filtered rows in the view's sort, the calendar's days, the matrix's cells.
  const projected = useMemo(() => (snapshot ? projectResults(snapshot, prefs) : null), [snapshot, prefs]);
  const rows = projected?.rows ?? [];
  // Coverage speaks for the search, so it counts the snapshot's rows, not the ones a view filter lets through.
  const coverage = snapshot && value ? coverageNotices(snapshot.coverage, snapshot.rows.length, locale) : [];
  // "Show all" takes its own button away: focus goes to the status line, and the change is announced.
  const [announcement, setAnnouncement] = useState("");
  const showAll = () => {
    services.workspace.setPreferences({ localFilter: {} });
    const total = services.workspace.getState().displayedSnapshot?.rows.length ?? 0;
    setAnnouncement(t.showingAll(total));
    window.requestAnimationFrame(() => document.getElementById("results-status")?.focus());
  };
  // The filter row scrolls sideways when its chips do not fit; it then shows that there is more.
  const filtersRef = useRef<HTMLDivElement>(null);
  // The sticky header and summary's real height (it grows with a long route or larger text; 0 when landscape makes
  // it static), for the page's scroll padding and the matrix's height (results.css --results-sticky-h).
  const stickyRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = stickyRef.current;
    const main = el?.closest<HTMLElement>(".app-main");
    if (!el || !main) return;
    const measure = () => main.style.setProperty("--results-sticky-h", `${getComputedStyle(el).position === "sticky" ? el.offsetHeight : 0}px`);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      main.style.removeProperty("--results-sticky-h");
    };
  }, []);
  const [filtersOverflow, setFiltersOverflow] = useState(false);
  useLayoutEffect(() => {
    const el = filtersRef.current;
    if (!el) return;
    const measure = () => setFiltersOverflow(el.scrollWidth > el.clientWidth + 1);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [snapshot?.id, locale]);
  const selected = new Set(workspace.selected.filter((r) => r.snapshotId === snapshot?.id).map((r) => r.rowKey));
  const snapshotId = snapshot?.id ?? null;
  const toggleRow = useCallback(
    (rowKey: string, on: boolean) => {
      if (snapshotId) services.workspace.setSelected({ snapshotId, rowKey }, on);
    },
    [services, snapshotId],
  );
  const programs = value?.query.programs?.length ?? 0;

  // The engine's own messages and run warnings are English (core); they say so on a Chinese screen.
  const english = locale === "en" ? undefined : "en";
  const keyCallout =
    hasKey === false ? (
      <Callout tone="danger">
        {t.noKey.before}
        <strong>{t.noKey.settings}</strong>
        {t.noKey.after}
      </Callout>
    ) : null;
  const failureCallout = failure ? (
    <Callout tone="danger" lang={english}>
      {failure.message ?? failure.error}
    </Callout>
  ) : workspace.run.kind === "failed" ? (
    // A run this screen did not start (the editor), or one from before the screen was opened again.
    <Callout tone="danger">{runFailureText(workspace.run.code, locale)}</Callout>
  ) : null;

  return (
    <div className="ag-results" lang={langTag(locale)} data-run={workspace.run.kind} data-busy={String(searching)} data-revision={workspace.revision}>
      <div className="ag-results-sticky" ref={stickyRef}>
        <header className="ag-results-header" data-testid="results-header">
          <h1 className="ag-results-title">{t.title}</h1>
          <Link to="/ask" className="ag-results-ai">
            <Icon name="sparkle" />
            <span>{asking ? t.aiWorking : t.ai}</span>
          </Link>
        </header>
        {snapshot && value ? <QuerySummary id={RETURN_FOCUS} query={value.query} locale={locale} waitNote={running ? t.editWhileRunning : null} /> : null}
      </div>

      {snapshot && value ? (
        <>
          <div
            ref={filtersRef}
            className="ag-results-filters"
            data-testid="results-filters"
            data-overflow={filtersOverflow || undefined}
            inert={running || undefined}
          >
            <Link id={CHIP_IDS.programs} to="/edit?section=programs" state={{ from: CHIP_IDS.programs }} className="ag-chip">
              <span className="ag-chip-face">
                {t.programs(programs)}
                <Icon name="chevron-down" size={16} />
              </span>
            </Link>
            <Link id={CHIP_IDS.stops} to="/edit?section=stops" state={{ from: CHIP_IDS.stops }} className="ag-chip">
              <span className="ag-chip-face">
                {value.query.direct_only ? t.stopsNonstop : t.stopsAny}
                <Icon name="chevron-down" size={16} />
              </span>
            </Link>
            <Link id={CHIP_IDS.more} to="/edit?section=more" state={{ from: CHIP_IDS.more }} className="ag-chip">
              <span className="ag-chip-face">
                {t.moreFilters(moreConditionsCount(value.query))}
                <Icon name="filter" size={16} />
              </span>
            </Link>
          </div>
          <div className="ag-results-view" data-testid="results-view">
            <SegmentedControl<"list" | "calendar" | "matrix">
              label={t.view}
              className="ag-results-segmented"
              value={prefs.kind}
              onChange={(kind) => services.workspace.setPreferences({ kind })}
              options={[
                { value: "list", label: t.list },
                { value: "calendar", label: t.calendar },
                { value: "matrix", label: t.matrix },
              ]}
            />
            {/* A native picker under the visible label: the phone's own list, one control, named "Sort". */}
            <label className="ag-results-sort">
              <span className="ag-results-sort-text" aria-hidden="true">
                {sortShortLabel(prefs.sort, locale)}
                <Icon name="chevron-down" />
              </span>
              <select aria-label={t.sort} value={prefs.sort} onChange={(e) => services.workspace.setPreferences({ sort: SortBy.parse(e.target.value) })}>
                {SortBy.options.map((option) => (
                  <option key={option} value={option}>
                    {sortLabel(option, locale)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="ag-results-status" data-testid="results-status" id="results-status" tabIndex={-1}>
            <span>
              {optionsCount(rows.length, locale)}
              {shown ? ` · ${freshness(shown, now, locale)}` : ""}
            </span>
            <span>{copy("data.source", locale)}</span>
          </div>

          <p className="sr-only" role="status">
            {announcement}
          </p>
          <div className="ag-results-notes">
            {running ? (
              <Notice tone="info" live>
                {copy("run.inflight", locale)}
              </Notice>
            ) : null}
            {workspace.run.kind === "failed" ? (
              <Notice tone="warning" live>
                {copy("run.old", locale)}
              </Notice>
            ) : null}
            {failureCallout}
            {coverage.map((notice) => (
              <Notice key={notice.kind} tone={notice.kind === "none" ? "info" : "warning"}>
                {notice.text}
              </Notice>
            ))}
            {value.warnings.map((w) => (
              <Callout key={w} tone="warn" lang={english}>
                {w}
              </Callout>
            ))}
            {projected && projected.dynamicNotShown > 0 ? <Notice tone="info">{t.dynamicNotShown(projected.dynamicNotShown)}</Notice> : null}
            {projected && projected.hiddenByFilter > 0 ? (
              <Notice tone="info">
                {t.hiddenByFilter(projected.hiddenByFilter)}{" "}
                <button type="button" className="ag-link-button" onClick={showAll}>
                  {t.showAll}
                </button>
              </Notice>
            ) : null}
          </div>

          {prefs.kind === "matrix" && projected ? (
            <AvailabilityMatrix
              snapshot={snapshot}
              projected={projected}
              sort={prefs.sort}
              selected={selected}
              onToggle={toggleRow}
              now={now.toISOString()}
              locale={locale}
            />
          ) : prefs.kind === "calendar" && projected ? (
            <AvailabilityCalendar
              key={snapshot.id}
              query={value.query}
              days={projected.days}
              rows={rows}
              sort={prefs.sort}
              onCabin={(calendarCabin) => services.workspace.setPreferences({ calendarCabin })}
              snapshotId={snapshot.id}
              selected={selected}
              onToggle={toggleRow}
              now={now.toISOString()}
              locale={locale}
            />
          ) : rows.length > 0 ? (
            <AvailabilityList rows={rows} sort={prefs.sort} snapshotId={snapshot.id} selected={selected} onToggle={toggleRow} now={now.toISOString()} locale={locale} />
          ) : null}

          <div className="ag-results-actions">
            <Button onClick={searchAgain} disabled={hasKey === false} loading={searching} loadingLabel={t.searching}>
              {t.searchAgain}
            </Button>
            <Button onClick={() => void watchThis()} disabled={!reproduces} disabledReason={reproduces ? null : t.watchNeedsText}>
              {t.watch}
            </Button>
            <Link to="/ask" className="ag-button">
              {t.askAbout ?? ASK_ABOUT_SEARCH}
            </Link>
          </div>
          {watchMessage ? (
            <p role="status" className="ag-results-meta">
              {watchMessage}
            </p>
          ) : null}
          {keyCallout}
          {quota ? <p className="ag-results-meta tabular">{t.quota(quota.used, quota.softLimit)}</p> : null}
        </>
      ) : (
        <div className="ag-results-empty">
          <p className="ag-results-meta">{t.emptyIntro}</p>
          {/* The parser reads English and Chinese, but this box's labels and examples are English until T11. */}
          <TextSearch lang={english} busy={searching} disabled={hasKey === false} onSearch={(text) => void runSearch(() => services.searchText(text))} />
          {searching ? (
            // T06: the editor would show nothing to edit yet and would supersede the search in flight.
            <Button disabled disabledReason={t.editWhileRunning}>
              {t.newSearch}
            </Button>
          ) : (
            <Link id={RETURN_FOCUS} to="/edit" className="ag-button">
              {t.newSearch}
            </Link>
          )}
          {keyCallout}
          {failureCallout}
          {quota ? <p className="ag-results-meta tabular">{t.quota(quota.used, quota.softLimit)}</p> : null}
        </div>
      )}
    </div>
  );
}

function Callout({ tone, children, lang }: { tone: "warn" | "danger"; children: ReactNode; lang?: string }) {
  return (
    <p role={tone === "danger" ? "alert" : undefined} className={`ag-callout ag-callout-${tone}`} lang={lang}>
      {children}
    </p>
  );
}
