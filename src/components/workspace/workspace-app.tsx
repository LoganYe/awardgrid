"use client";
/**
 * The Web professional workspace (UI/UX v1 T18 ports, T19 layout; docs/04 S10; spec §17; acceptance A31, A32).
 *
 *   - One trusted snapshot, drawn by every view (list, calendar, matrix) through the same projection
 *     (core workspace/projection.ts). The view and sort are local: they redraw that snapshot and send nothing. The
 *     matrix is the default for a search of more than one route; a view chosen by hand is kept for the account.
 *   - The query bar and the conditions toolbar edit one draft; a search runs only from Find (or Cmd/Ctrl+Enter inside
 *     the query), so no hard condition changes without that confirmation, and nothing here calls AI.
 *   - One side panel at a time (./panel-state.ts): the assistant (360) or an option's details (400). At ≥ 1280 it
 *     docks in its own column (main 936 or 896); below it overlays the results without squeezing them; below 768 it
 *     is a full-height page. Opening and closing keep the view, selection, scroll and conditions.
 *   - Keyboard (./keyboard.ts): "/" the query, Cmd/Ctrl+K the command palette, Cmd/Ctrl+Enter Find, Esc the top-most
 *     layer. Each has a visible control, none takes a key being typed or composed, and they can be turned off.
 *
 * A search given in the address (?q=, as the grid's shared links) runs once; a restored workspace runs nothing.
 * Everything belongs to the signed-in account: its stores are made for its id (./services.ts).
 */
import { useCallback, useEffect, useEffectEvent, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useT } from "@awardgrid/core/i18n/client";
import type { Cabin, QueryObject } from "@awardgrid/core/query/schema";
import { favoriteFromOption, optionOrigin } from "@awardgrid/core/workspace/favorites-store";
import { projectResults } from "@awardgrid/core/workspace/projection";
import { copy, coverageNotices, optionsCount } from "@awardgrid/core/workspace/present";
import { describeQuery, draftFromQuery, resolveDraft, sameDraft, type QueryDraft } from "@awardgrid/core/workspace/query-editor";
import { AskDrawer } from "@/components/ask/ask-drawer";
import { cellContextFromRow } from "@/components/ask/context";
import { encodeQueryParam } from "@/components/grid/state";
import { notifyUsageChanged } from "@/components/shell/quota-indicator";
import { SeatsAttribution } from "@/components/shell/seats-attribution";
import { CalendarView } from "./calendar-view";
import { CommandPalette } from "./command-palette";
import type { CommandId, WorkspaceCommand } from "./commands";
import { DetailPanel } from "./detail-panel";
import { chordLabel, shortcutFor } from "./keyboard";
import { ListView } from "./list-view";
import { MatrixView } from "./matrix-view";
import { NO_PANEL, panelReducer } from "./panel-state";
import { effectiveView, readShortcutsOn, readViewChoice, writeShortcutsOn, writeViewChoice, type WorkspaceView } from "./prefs";
import { QueryBar, type QueryBarHandle } from "./query-bar";
import { blankDraft, localToday, queryErrors, type DraftTexts, type QueryError } from "./query-draft";
import { ResultsToolbar } from "./results-toolbar";
import { useWorkspaceServices } from "./services";

export interface WorkspaceAppProps {
  /** The signed-in account, from the server's session. */
  userId: string;
  initialQuery: QueryObject | null;
  /** Whether the account has connected seats.aero (Login with Seats.aero); the name predates the connection. */
  hasKey: boolean;
  /** The account's pasted key was removed by the move to Login with Seats.aero: say so once, until it connects. */
  seatsNotice?: boolean;
}

export const ASSISTANT_PANEL_WIDTH = 360;

interface DraftState {
  source: string;
  draft: QueryDraft;
  texts: DraftTexts;
  errors: QueryError[];
  /** What the draft was made from, or last ran: edits are measured against it. */
  base: QueryDraft;
  /** The draft the running search was started with, if one is running. */
  submitted: QueryDraft | null;
}

const textsOf = (query: QueryObject): DraftTexts => ({ origins: query.origins.join(", "), destinations: query.destinations.join(", ") });

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function WorkspaceApp({ userId, initialQuery, hasKey, seatsNotice = false }: WorkspaceAppProps) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const { services, ready } = useWorkspaceServices(userId, hasKey);
  const { workspace, favorites } = services;
  const state = useSyncExternalStore(workspace.subscribe, workspace.getState, workspace.getState);
  const saved = useSyncExternalStore(favorites.subscribe, favorites.all, favorites.all);
  const [saving, setSaving] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [panel, dispatch] = useReducer(panelReducer, NO_PANEL);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  // The docked panel fits the viewport from where its column starts, at any scroll (T19 review LAY-11): the column's
  // top is published to CSS, which sizes the sticky slot from it.
  useEffect(() => {
    if (!slot) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const column = slot.parentElement;
      if (!column) return;
      slot.style.setProperty("--ag-ws-slot-top", `${Math.max(Math.round(column.getBoundingClientRect().top), 16)}px`);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(document.body);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [slot]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [viewChoice, setViewChoice] = useState<{ userId: string; view: WorkspaceView | null } | null>(null);
  const [shortcuts, setShortcuts] = useState<{ userId: string; on: boolean } | null>(null);
  const [mac, setMac] = useState(false);
  // What opened the panel now on screen, so closing it hands focus back there (T19 review LAY-4).
  const [panelOpener, setPanelOpener] = useState<HTMLElement | null>(null);

  // Per-account conveniences, read once the page is in the browser.
  useEffect(() => {
    const id = window.setTimeout(() => {
      setViewChoice({ userId, view: readViewChoice(userId) });
      setShortcuts({ userId, on: readShortcutsOn(userId) });
      setMac(isMac());
    }, 0);
    return () => window.clearTimeout(id);
  }, [userId]);
  const shortcutsOn = shortcuts?.userId === userId ? shortcuts.on : true;
  const chosenView = viewChoice?.userId === userId ? viewChoice.view : null;

  const snapshot = state.displayedSnapshot;
  const projected = useMemo(() => (snapshot ? projectResults(snapshot, state.preferences) : null), [snapshot, state.preferences]);
  const view = effectiveView(chosenView, snapshot?.query ?? initialQuery);
  const now = new Date().toISOString();
  const savedOrigins = useMemo(() => new Set(saved.map((f) => f.originalSnapshotId)), [saved]);
  const running = state.run.kind === "running";
  const bar = useRef<QueryBarHandle>(null);

  // The draft follows the search on screen: a new snapshot (or the address's search, before one) resets it, unless the
  // person has edited it since it was made or last run — then the edits stay, and are said to differ (T19 review
  // PRD-5). `base` is what the draft was made from or last ran; `submitted` is the draft a search is running for.
  const shownQuery = snapshot?.query ?? initialQuery;
  const draftSource = snapshot ? `snapshot:${snapshot.id}` : initialQuery ? "address" : "blank";
  const [draftState, setDraftState] = useState<DraftState | null>(null);
  let current: DraftState;
  if (draftState && draftState.source === draftSource) current = draftState;
  else {
    const fresh = shownQuery ? draftFromQuery({ ...shownQuery, sort_by: state.preferences.sort }) : blankDraft(localToday(), state.preferences.sort);
    current =
      draftState && !sameDraft(draftState.draft, draftState.base)
        ? { ...draftState, source: draftSource, base: fresh, submitted: null }
        : { source: draftSource, draft: fresh, texts: shownQuery ? textsOf(shownQuery) : { origins: "", destinations: "" }, errors: [], base: fresh, submitted: null };
    setDraftState(current);
  }
  const { draft, texts, errors, submitted } = current;
  const shownDraft = shownQuery ? draftFromQuery({ ...shownQuery, sort_by: draft.query.sort_by }) : null;
  // While a search runs, the draft is compared with what it runs for: its own conditions are not "changed" (PRD-6).
  const modified = running && submitted ? !sameDraft(draft, submitted) : shownDraft !== null && !sameDraft(draft, shownDraft);
  const setDraft = (next: QueryDraft) => setDraftState((s) => (s ? { ...s, draft: next, errors: [] } : s));
  const setTexts = (nextTexts: DraftTexts, next: QueryDraft) => setDraftState((s) => (s ? { ...s, texts: nextTexts, draft: next, errors: [] } : s));
  const discard = () =>
    setDraftState((s) => {
      if (!s) return s;
      const back = running && s.submitted ? s.submitted : shownDraft;
      return back ? { ...s, draft: back, texts: textsOf(back.query), errors: [] } : null;
    });

  // The panels belong to the snapshot they were opened on (T10): a new one closes an option's details.
  const snapshotId = snapshot?.id ?? null;
  const [panelFor, setPanelFor] = useState<string | null>(snapshotId);
  if (panelFor !== snapshotId) {
    setPanelFor(snapshotId);
    if (panel.kind === "detail" && panel.option.snapshotId !== snapshotId) setNotice(t("workspace.snapshot_changed"));
    dispatch({ type: "snapshot", snapshotId });
  }

  const afterRun = useCallback(async () => {
    // The header's count re-reads the server's, now: a search may have spent a call, answered or not.
    notifyUsageChanged();
    await workspace.persist();
  }, [workspace]);

  // The address's search runs once, when this account's stored workspace has been read.
  const ran = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !initialQuery || !hasKey || ran.current === userId) return;
    ran.current = userId;
    void workspace.run(initialQuery).then(afterRun);
  }, [ready, initialQuery, hasKey, userId, workspace, afterRun]);

  // Focus a query field, over any panel that is modal at this width: the panel closes first (T19 review LAY-3), and
  // the field takes focus after the panel has handed focus back to its opener.
  const focusQuery = (field?: QueryError["field"]) => {
    if (document.querySelector('.ag-drawer[aria-modal="true"]')) dispatch({ type: "close" });
    window.setTimeout(() => (field ? bar.current?.focusField(field) : bar.current?.focus()), 0);
  };

  const submit = () => {
    if (!hasKey || running) return;
    const today = localToday();
    const found = queryErrors(draft, texts, today);
    if (found.length > 0) {
      setDraftState((s) => (s ? { ...s, errors: found } : s));
      focusQuery(found[0]!.field);
      return;
    }
    let query: QueryObject;
    try {
      // The view's sort, not the one the draft was made with (U-030; T19 review PRD-8).
      const resolved = resolveDraft({ ...draft, query: { ...draft.query, sort_by: state.preferences.sort } }, today);
      // As the iOS editor does: the query's text is its own description, never something typed to a model.
      query = { ...resolved, raw_text: describeQuery(resolved, draft.dates), language: "en" };
    } catch {
      setDraftState((s) => (s ? { ...s, errors: [{ field: "dates", key: "workspace.q.err.invalid_calendar_date" }] } : s));
      return;
    }
    // The address names the search on screen, so a reload or a shared link shows the same one.
    window.history.replaceState(window.history.state, "", `/workspace?q=${encodeQueryParam(query)}`);
    setDraftState((s) => (s ? { ...s, base: s.draft, submitted: s.draft } : s));
    void workspace.run(query).then(afterRun);
  };

  const save = async (rowKey: string) => {
    if (!snapshot) return;
    const item = favoriteFromOption(snapshot, rowKey, new Date().toISOString(), crypto.randomUUID());
    if (!item) return;
    setSaving(rowKey);
    const written = await favorites.save(item);
    setSaving(null);
    setNotice(written.ok ? null : written.reason === "capacity" ? t("workspace.save_full") : t("workspace.save_failed"));
  };

  const chooseView = (next: WorkspaceView) => {
    setViewChoice({ userId, view: next });
    writeViewChoice(userId, next);
  };
  const chooseSort = (sort: QueryObject["sort_by"]) => {
    workspace.setPreferences({ sort });
    void workspace.persist();
  };
  const chooseCabin = (cabin: Cabin) => {
    workspace.setPreferences({ calendarCabin: cabin });
    void workspace.persist();
  };
  const toggleShortcuts = () => {
    const on = !shortcutsOn;
    setShortcuts({ userId, on });
    writeShortcutsOn(userId, on);
    setNotice(on ? t("workspace.shortcuts_on") : t("workspace.shortcuts_off"));
  };
  const openOption = (rowKey: string, opener?: HTMLElement) => {
    if (!snapshot) return;
    setNotice(null);
    setPanelOpener(opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null));
    dispatch({ type: "detail", option: { snapshotId: snapshot.id, rowKey } });
  };
  const openAssistant = (opener?: HTMLElement) => {
    setPanelOpener(opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null));
    dispatch({ type: "assistant" });
  };

  const rowOf = useMemo(() => new Map((snapshot?.rows ?? []).map((r) => [r.key, r])), [snapshot]);
  const detailRow = panel.kind === "detail" ? (rowOf.get(panel.option.rowKey) ?? null) : null;
  const selectedRow = panel.selected && panel.selected.snapshotId === snapshot?.id ? (rowOf.get(panel.selected.rowKey) ?? null) : null;

  // The keyboard: every shortcut has a control on the page, none fires while typing or composing, all can be off.
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Escape") {
      // The top-most layer: the palette closes itself; an overlay panel's own handler has run first. A key an IME owns
      // (keyCode 229) is not a request to close (T19 review REG-7).
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || paletteOpen || panel.kind === "none") return;
      dispatch({ type: "close" });
      return;
    }
    const shortcut = shortcutFor(event, shortcutsOn, mac);
    if (!shortcut || event.defaultPrevented) return;
    if (shortcut === "palette") {
      event.preventDefault();
      setPaletteOpen(true);
    } else if (shortcut === "focus_query") {
      if (paletteOpen || document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      bar.current?.focus();
    } else if (shortcut === "submit") {
      if (!bar.current?.contains(event.target)) return;
      event.preventDefault();
      submit();
    }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  const commands: WorkspaceCommand[] = [
    { id: "focus_query", label: t("workspace.cmd.focus_query"), hint: shortcutsOn ? "/" : undefined, keywords: ["query", "查询"] },
    { id: "run_query", label: copy("query.submit", locale), hint: shortcutsOn ? chordLabel("↵", mac) : undefined, keywords: ["find", "search", "查找"], disabled: !hasKey || running },
    { id: "view_list", label: t("workspace.cmd.view_list"), keywords: ["list", "列表"] },
    { id: "view_calendar", label: t("workspace.cmd.view_calendar"), keywords: ["calendar", "日历"] },
    { id: "view_matrix", label: t("workspace.cmd.view_matrix"), keywords: ["matrix", "矩阵"] },
    { id: "open_assistant", label: copy("ai.entry", locale), keywords: ["ai", "ask", "assistant", "提问"] },
    { id: "close_panel", label: t("workspace.cmd.close_panel"), hint: "Esc", disabled: panel.kind === "none" },
    { id: "go_saved", label: t("workspace.cmd.go_saved"), keywords: ["saved", "收藏"] },
    { id: "go_queries", label: t("workspace.cmd.go_queries"), keywords: ["queries", "watch", "查询", "关注"] },
    { id: "go_settings", label: t("workspace.cmd.go_settings"), keywords: ["settings", "设置"] },
    { id: "toggle_shortcuts", label: shortcutsOn ? t("workspace.cmd.shortcuts_off") : t("workspace.cmd.shortcuts_on"), keywords: ["keyboard", "shortcuts", "快捷键"] },
  ];
  const runCommand = (id: CommandId) => {
    switch (id) {
      case "focus_query":
        return focusQuery();
      case "run_query":
        return submit();
      case "view_list":
      case "view_calendar":
      case "view_matrix":
        return chooseView(id.slice(5) as WorkspaceView);
      case "open_assistant":
        return openAssistant();
      case "close_panel":
        return dispatch({ type: "close" });
      case "go_saved":
        return router.push("/workspace/saved");
      case "go_queries":
        return router.push("/queries");
      case "go_settings":
        return router.push("/settings");
      case "toggle_shortcuts":
        return toggleShortcuts();
    }
  };

  const actions = {
    savedOrigins,
    savingKey: saving,
    readOnly: favorites.isReadOnly(),
    onSave: (rowKey: string) => void save(rowKey),
    onOpen: openOption,
  };

  const runKind = state.run.kind;
  const statusLine = !hasKey
    ? t(seatsNotice ? "seats.reconnect_notice" : "workspace.no_key")
    : runKind === "running"
      ? snapshot
        ? copy("run.inflight", locale)
        : t("workspace.running")
      : runKind === "failed"
        ? snapshot
          ? copy("run.old", locale)
          : t("workspace.failed")
        : projected
          ? optionsCount(projected.rows.length, locale)
          : ready
            ? t("workspace.no_search")
            : "";
  // Every coverage notice, each naming its routes, over the snapshot's own rows (U-031; T19 review PRD-3), and the
  // dynamically priced options the query leaves out.
  const notices = snapshot ? coverageNotices(snapshot.coverage, snapshot.rows.length, locale) : [];
  const dynamicNotShown = projected?.dynamicNotShown ?? 0;

  return (
    <section className="ag-ws-page" data-testid="workspace" data-run={runKind} data-ready={ready || undefined} data-panel={panel.kind} data-view={view}>
      <header className="ag-ws-head">
        <h1 className="ag-ws-title">{t("workspace.page_title")}</h1>
        <div className="ag-ws-head-actions">
          <button type="button" className="ag-ws-button ag-ws-button-quiet" onClick={() => setPaletteOpen(true)} aria-keyshortcuts={shortcutsOn ? (mac ? "Meta+K" : "Control+K") : undefined} aria-haspopup="dialog">
            <span>{t("workspace.commands")}</span>
            {shortcutsOn ? (
              <kbd className="ag-ws-kbd" aria-hidden>
                {chordLabel("K", mac)}
              </kbd>
            ) : null}
          </button>
          <button
            type="button"
            className="ag-ws-button ag-ws-button-primary"
            aria-pressed={panel.kind === "assistant"}
            onClick={(e) => (panel.kind === "assistant" ? dispatch({ type: "close" }) : openAssistant(e.currentTarget))}
          >
            {copy("ai.entry", locale)}
          </button>
        </div>
      </header>

      <QueryBar
        ref={bar}
        draft={draft}
        texts={texts}
        errors={errors}
        modified={modified}
        running={running}
        disabled={!hasKey}
        submitHint={shortcutsOn ? chordLabel("↵", mac) : null}
        onTexts={setTexts}
        onDraft={setDraft}
        onSubmit={submit}
        onDiscard={discard}
      />

      <div className="ag-ws-columns" data-panel={panel.kind}>
        <div className="ag-ws-main">
          <ResultsToolbar
            draft={draft}
            view={view}
            sort={state.preferences.sort}
            disabled={!hasKey}
            milesError={errors.find((e) => e.field === "max_miles") ?? null}
            onDraft={setDraft}
            onView={chooseView}
            onSort={chooseSort}
          />
          <div className="ag-ws-status">
            <p role="status" className="ag-ws-status-line">
              {statusLine}
              {!hasKey ? (
                <>
                  {" "}
                  <Link href="/settings#seats" className="ag-link">
                    {t("grid.empty.no_key_cta")}
                  </Link>
                </>
              ) : null}
            </p>
            <SeatsAttribution className="ag-ws-status-source" />
          </div>
          {notices.length > 0 || dynamicNotShown > 0 ? (
            <ul className="ag-ws-notices">
              {notices.map((n) => (
                <li key={n.kind} className="ag-ws-notice" data-testid="coverage-notice" data-kind={n.kind}>
                  {n.text}
                </li>
              ))}
              {dynamicNotShown > 0 ? (
                <li className="ag-ws-notice" data-testid="coverage-notice" data-kind="dynamic">
                  {t("workspace.dynamic_not_shown", { count: String(dynamicNotShown) })}
                </li>
              ) : null}
            </ul>
          ) : null}
          {notice ? (
            <p role="alert" className="ag-web-notice">
              {notice}
            </p>
          ) : null}
          {snapshot && projected && projected.rows.length > 0 ? (
            view === "matrix" ? (
              <MatrixView snapshot={snapshot} projected={projected} sort={state.preferences.sort} now={now} onSort={chooseSort} {...actions} />
            ) : view === "calendar" ? (
              <CalendarView
                snapshot={snapshot}
                projected={projected}
                sort={state.preferences.sort}
                cabin={state.preferences.calendarCabin}
                now={now}
                onSort={chooseSort}
                onCabin={chooseCabin}
                {...actions}
              />
            ) : (
              <ListView snapshot={snapshot} rows={projected.rows} sort={state.preferences.sort} now={now} onSort={chooseSort} {...actions} />
            )
          ) : null}
        </div>
        <aside ref={setSlot} className="ag-ws-panel-slot" aria-label={panel.kind === "assistant" ? copy("ai.entry", locale) : panel.kind === "detail" ? t("workspace.view_option") : undefined} />
      </div>

      <AskDrawer
        open={panel.kind === "assistant"}
        onOpenChange={(next) => dispatch(next ? { type: "assistant" } : { type: "close" })}
        query={snapshot?.query ?? null}
        cell={selectedRow ? cellContextFromRow(selectedRow.value) : null}
        hasKey={hasKey}
        panel={{ title: copy("ai.entry", locale), width: ASSISTANT_PANEL_WIDTH, container: slot, testId: "assistant-panel", className: "ag-ws-tokens", opener: panelOpener }}
      />
      <DetailPanel
        open={panel.kind === "detail"}
        snapshot={snapshot}
        row={detailRow}
        now={now}
        container={slot}
        opener={panelOpener}
        saved={!!snapshot && !!detailRow && savedOrigins.has(optionOrigin(snapshot.id, detailRow.key))}
        saveDisabled={favorites.isReadOnly() || (detailRow !== null && saving === detailRow.key)}
        onSave={() => detailRow && void save(detailRow.key)}
        onClose={() => dispatch({ type: "close" })}
      />
      <CommandPalette open={paletteOpen} commands={commands} onRun={runCommand} onClose={() => setPaletteOpen(false)} />
    </section>
  );
}
