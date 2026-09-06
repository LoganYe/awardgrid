"use client";

/**
 * The grid page's client orchestrator: query box → /api/parse → chips → /api/find → grid.
 * The QueryObject lives in React state AND in the URL (?q=base64url JSON) so links are
 * shareable; orientation is a pure client-side transpose (no extra API call).
 *
 * Layout (spec §3): query bar → chips → [quota banner] → toolbar → grid. The grid area is one
 * of: the loading skeleton in the query's real shape, the results table, or the empty-results
 * state; the no-key and failure states replace it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { transposeGrid } from "@/lib/grid/pivot";
import type { AvailabilityRow, Grid, GridCell, Orientation } from "@/lib/grid/types";
import { useLocale, useT } from "@/lib/i18n/client";
import { MAX_SPAN_DAYS, type Cabin, type QueryObject } from "@/lib/query/schema";
import type { Provenance } from "@/lib/query/deterministic";
import type { QuotaSnapshot, TripsForUserResult } from "@/lib/server/find";
import { noticeKey } from "@/lib/notices";
import { apiExport, apiFind, apiParse, uiNotices, type ApiFailure, type UiNotice } from "@/components/grid/api";
import { CellSheet } from "@/components/grid/cell-sheet";
import { ChipRow } from "@/components/grid/chip-row";
import { isModified, resetToParsed, type ChipId } from "@/components/grid/chips-model";
import { FailureState, NoKeyState, StartState } from "@/components/grid/empty-states";
import { GridEmptyResults, GridTable, type GridTableHandle } from "@/components/grid/grid-table";
import { GridSkeleton } from "@/components/grid/grid-skeleton";
import { ParseFailure } from "@/components/grid/parse-failure";
import { QueryBar } from "@/components/grid/query-bar";
import { applyChipAction, gridHref, localToday, mergeTripsIntoGrid, type ChipAction } from "@/components/grid/state";
import { QuotaBanner, Toolbar } from "@/components/grid/toolbar";
import { AskDrawer } from "@/components/ask/ask-drawer";
import { cellContextFromCell } from "@/components/ask/context";

export interface GridAppProps {
  initialQuery: QueryObject | null;
  hasKey: boolean;
  llmAvailable: boolean;
}

type Phase = "idle" | "parsing" | "loading" | "ready";

interface CellRef {
  origin: string;
  dest: string;
  date: string;
}

function findCell(grid: Grid, ref: CellRef | null): GridCell | null {
  if (!ref) return null;
  for (const line of grid.cells) {
    for (const cell of line) {
      if (cell.origin === ref.origin && cell.dest === ref.dest && cell.date === ref.date) return cell;
    }
  }
  return null;
}

function gridHasResults(grid: Grid): boolean {
  return grid.cells.some((line) => line.some((c) => c.status === "ok"));
}

const DAY_MS = 86_400_000;

/** `iso` + `days` calendar days (UTC arithmetic; the reducer clamps to the 92-day cap). */
function addDays(iso: string, days: number): string {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms + days * DAY_MS).toISOString().slice(0, 10);
}

export function GridApp({ initialQuery, hasKey, llmAvailable }: GridAppProps) {
  const t = useT();
  const locale = useLocale();
  // Three queries at once (chips-model.ts): the parser's output (the baseline "Reset to parsed"
  // restores), the draft the chips edit, and the query the grid on screen was produced from —
  // which is also the only one the URL encodes (spec §3.2: ?q= updates on run, not on edit).
  const [query, setQuery] = useState<QueryObject | null>(initialQuery);
  const [parsedQuery, setParsedQuery] = useState<QueryObject | null>(initialQuery);
  const [ranQuery, setRanQuery] = useState<QueryObject | null>(null);
  const [text, setText] = useState<string>(initialQuery?.raw_text ?? "");
  // Manual mode ("Build it with chips instead"): no parser output, the Run affordance from the start.
  const [manualMode, setManualMode] = useState(false);
  const [openChip, setOpenChip] = useState<ChipId | null>(null);
  const [provenance, setProvenance] = useState<Record<string, Provenance>>({});
  const [parseWarnings, setParseWarnings] = useState<UiNotice[]>([]);
  const [findWarnings, setFindWarnings] = useState<UiNotice[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [grid, setGrid] = useState<Grid | null>(null);
  const [quota, setQuota] = useState<QuotaSnapshot | null>(null);
  const [dynamicRowsAvailable, setDynamicRowsAvailable] = useState(false);
  // Column-header "N programs" and the empty state's "Checked N programs" (from /api/find).
  const [programsByPair, setProgramsByPair] = useState<Record<string, number> | null>(null);
  const [programsChecked, setProgramsChecked] = useState<number | undefined>(undefined);
  const [orientation, setOrientation] = useState<Orientation>("dates");
  const [now, setNow] = useState<number>(() => Date.now());
  const [selected, setSelected] = useState<CellRef | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  // Empty results: the grid is hidden until "review the not-monitored cells" reveals it.
  const [revealGrid, setRevealGrid] = useState(false);
  const inflight = useRef<AbortController | null>(null);
  const gridRef = useRef<GridTableHandle>(null);

  // Keep the freshness ages ticking while the page is open.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Keep ?q= in sync with the query the grid was produced from, so the URL is always shareable
  // AND always matches what is on screen (an edited-but-not-run chip must not change the link).
  useEffect(() => {
    if (typeof window === "undefined" || ranQuery === null) return;
    const href = gridHref(ranQuery);
    if (window.location.pathname + window.location.search !== href) window.history.replaceState(null, "", href);
  }, [ranQuery]);

  const runFind = useCallback(
    async (q: QueryObject) => {
      inflight.current?.abort();
      const controller = new AbortController();
      inflight.current = controller;
      setPhase("loading");
      setFailure(null);
      setRevealGrid(false);
      setRanQuery(q);
      setManualMode(false);
      try {
        const res = await apiFind(q, "dates", controller.signal);
        if (controller.signal.aborted) return;
        setNow(Date.now());
        if (res.ok) {
          setGrid(res.value.grid);
          setQuota(res.value.quota);
          setDynamicRowsAvailable(res.value.dynamic_rows_available === true);
          setProgramsByPair(res.value.programs_by_pair ?? null);
          setProgramsChecked(typeof res.value.programs_checked === "number" ? res.value.programs_checked : undefined);
          setFindWarnings(uiNotices(res.value));
        } else {
          setFailure(res);
          if (res.error !== "quota") setGrid(null);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setFailure({ ok: false, status: 0, error: "network" });
      }
      if (!controller.signal.aborted) setPhase("ready");
    },
    [],
  );

  // A query arriving through the URL runs immediately. Deferred through a timer so the first
  // paint shows the chips, and so StrictMode's double effect invocation cancels the first run.
  useEffect(() => {
    if (!initialQuery || !hasKey) return;
    const id = window.setTimeout(() => void runFind(initialQuery), 0);
    return () => window.clearTimeout(id);
  }, [initialQuery, hasKey, runFind]);

  async function onSubmitText(raw: string) {
    inflight.current?.abort();
    setPhase("parsing");
    setFailure(null);
    setExportError(null);
    setOpenChip(null);
    const res = await apiParse(raw, localToday());
    if (!res.ok) {
      // A parse failure keeps the text in the bar and offers the chips instead (spec §3.7).
      setFailure(res);
      setPhase("ready");
      return;
    }
    setQuery(res.value.query);
    setParsedQuery(res.value.query);
    setManualMode(false);
    setProvenance(res.value.provenance);
    setParseWarnings(uiNotices(res.value));
    setSelected(null);
    if (!hasKey) {
      setPhase("ready");
      return;
    }
    await runFind(res.value.query);
  }

  /** Commit a toolbar edit: the toolbar acts at once, unlike the chips (spec §3.3). */
  function commit(next: QueryObject) {
    setQuery(next);
    setSelected(null);
    if (hasKey) void runFind(next);
  }

  /** A chip edit only marks the query modified; the grid changes when the user runs it. */
  function onChipQuery(next: QueryObject) {
    setQuery(next);
  }

  /** The Run affordance at the end of the chip row, and Enter in the query bar while modified. */
  function runDraft() {
    if (!query || !hasKey) return;
    // Same guard as the disabled Run button: an incomplete draft is never sent (chips-model).
    if (query.origins.length === 0 || query.destinations.length === 0 || query.cabins.length === 0) return;
    void runFind(query);
  }

  /** "Reset to parsed": the parser's output comes back and the modified state clears. */
  function resetToParsedQuery() {
    if (!parsedQuery) return;
    setQuery(resetToParsed(parsedQuery));
  }

  /**
   * "Build it with chips instead" (spec §3.7): the parse failure becomes an empty draft with
   * every chip visible and the first editor open, so the user can construct the query by hand.
   */
  function buildWithChips() {
    const today = localToday();
    setFailure(null);
    setParsedQuery(null);
    setProvenance({});
    setParseWarnings([]);
    setManualMode(true);
    setQuery({
      origins: [],
      destinations: [],
      date_from: today,
      date_to: addDays(today, 29),
      cabins: [],
      direct_only: false,
      include_filtered: false,
      sort_by: "miles_asc",
      raw_text: text,
      language: locale,
    });
    setOpenChip("origins");
  }

  function onChip(action: ChipAction) {
    if (!query) return;
    commit(applyChipAction(query, action));
  }

  async function onExport() {
    if (!query) return;
    setExporting(true);
    setExportError(null);
    const res = await apiExport(query, orientation);
    setExporting(false);
    if (!res.ok) {
      setExportError(t("grid.export_failed"));
      return;
    }
    const url = URL.createObjectURL(res.value.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = res.value.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function onTripsLoaded(row: AvailabilityRow, result: TripsForUserResult) {
    setGrid((g) => (g ? mergeTripsIntoGrid(g, row, result) : g));
    setQuota(result.quota);
  }

  // Empty-results suggestions (spec §3.7). Each applies the smallest useful edit and re-runs
  // rather than opening the matching chip editor: the sentence promises an outcome ("widen the
  // dates"), so making the user then pick a date in a popover would be a second step for a
  // decision they already made. The chip is left modified-free because the query did run.
  function onWidenDates() {
    if (!query) return;
    // Push the end out, but never past the 92-day span: clampDates would otherwise pull
    // date_from forward and silently drop days the user is already looking at.
    const limit = addDays(query.date_from, MAX_SPAN_DAYS - 1);
    const next = addDays(query.date_to, 30);
    onChip({ type: "set_dates", date_to: next > limit ? limit : next });
  }
  /** False once the window is already the longest seats.aero searches: widening would do nothing. */
  const canWidenDates = query !== null && query.date_to < addDays(query.date_from, MAX_SPAN_DAYS - 1);
  function onAddCabin() {
    if (!query) return;
    const missing: Cabin | undefined = (["F", "J", "W"] as const).find((c) => !query.cabins.includes(c));
    if (missing) onChip({ type: "toggle_cabin", cabin: missing });
  }
  function onReviewUnmonitored() {
    setRevealGrid(true);
    // The grid mounts on this render; focus it once its cells have registered.
    window.requestAnimationFrame(() => gridRef.current?.focusFirstUnmonitored());
  }

  const shown = useMemo(() => (grid ? (orientation === "routes" ? transposeGrid(grid) : grid) : null), [grid, orientation]);
  const selectedCell = useMemo(() => (grid ? findCell(grid, selected) : null), [grid, selected]);
  const askCell = useMemo(() => cellContextFromCell(selectedCell), [selectedCell]);
  const busy = phase === "parsing" || phase === "loading";
  const warnings = [...parseWarnings, ...findWarnings];
  const quotaExceeded = failure?.error === "quota" || (quota !== null && quota.used >= quota.limit);
  const loadingSkeleton = phase === "loading" && query !== null && query.origins.length > 0 && query.destinations.length > 0;
  const hasResults = grid !== null && gridHasResults(grid);
  // Modified, not yet run (spec §3.7): chips outlined, toolbar disabled, grid dimmed with the
  // "Run to refresh" strip. Manual mode is modified from the start — nothing has ever been run.
  const modified = query !== null && (manualMode || (ranQuery !== null && isModified(query, ranQuery)));
  // The toolbar stays on the quota state too, so Save is visibly disabled with its reason (spec §3.7).
  const showToolbar = query !== null && hasKey && (shown !== null || loadingSkeleton || quotaExceeded);

  return (
    <div className="flex flex-col gap-3">
      <QueryBar
        value={text}
        onValueChange={setText}
        busy={busy}
        llmAvailable={llmAvailable}
        parsedFrom={parsedQuery?.raw_text ?? null}
        guessed={Object.values(provenance).some((p) => p === "llm")}
        onRun={(raw) => {
          // Enter re-runs an edited query untouched; otherwise it parses what the bar says.
          if (modified && query && raw === query.raw_text) runDraft();
          else void onSubmitText(raw);
        }}
        disabled={quotaExceeded}
        disabledTitle={t("grid.toolbar.run_disabled_quota")}
      />

      {failure?.error === "parse" && <ParseFailure failure={failure} onBuildWithChips={buildWithChips} />}

      {query && (
        <ChipRow
          query={query}
          parsed={ranQuery ?? parsedQuery}
          canReset={parsedQuery !== null}
          modified={modified}
          today={localToday()}
          disabled={phase === "parsing"}
          open={openChip}
          onOpenChange={setOpenChip}
          onChange={onChipQuery}
          onRun={runDraft}
          onReset={resetToParsedQuery}
        />
      )}

      {warnings.length > 0 && (
        <details className="t-meta text-fg-muted">
          <summary className="cursor-pointer">
            {t("grid.warnings")} ({warnings.length})
          </summary>
          <ul className="mt-1 list-disc pl-5">
            {warnings.map((w, i) => (
              <li key={i}>{w.kind === "notice" ? t(noticeKey(w.notice.code), w.notice.vars) : w.text}</li>
            ))}
          </ul>
        </details>
      )}

      {!hasKey && <NoKeyState />}

      {/* The daily limit is a persistent banner above the toolbar (spec §3.7), not an alert. */}
      {quotaExceeded && <QuotaBanner resetAt={failure?.error === "quota" ? failure.resetAt : quota?.resetAt} now={now} />}

      {failure && failure.error !== "quota" && failure.error !== "parse" && (
        <FailureState failure={failure} onRetry={query && hasKey ? () => void runFind(query) : undefined} />
      )}

      {showToolbar && query && (
        <Toolbar
          query={query}
          orientation={orientation}
          onOrientation={setOrientation}
          onCabins={(cabins) => commit({ ...query, cabins })}
          onIncludeFiltered={(value) => onChip({ type: "set_include_filtered", value })}
          dynamicRowsAvailable={dynamicRowsAvailable}
          onExport={() => void onExport()}
          exporting={exporting}
          canExport={shown !== null}
          onAsk={() => setAskOpen(true)}
          quotaExceeded={quotaExceeded}
          disabled={modified}
          searching={phase === "loading"}
        />
      )}
      {exportError && <p className="t-meta text-error">{exportError}</p>}

      {loadingSkeleton && query ? (
        <GridSkeleton query={query} orientation={orientation} now={now} />
      ) : (
        shown &&
        grid && (
          <>
            {!hasResults && (
              <GridEmptyResults
                grid={shown}
                now={now}
                programsChecked={programsChecked}
                onWidenDates={canWidenDates ? onWidenDates : undefined}
                dateCapNote={canWidenDates ? undefined : t("grid.chips.date_cap")}
                onAddCabin={onAddCabin}
                onReviewUnmonitored={onReviewUnmonitored}
              />
            )}
            {(hasResults || revealGrid) && (
              <GridTable
                ref={gridRef}
                grid={shown}
                now={now}
                selected={selectedCell}
                onSelect={(c) => setSelected({ origin: c.origin, dest: c.dest, date: c.date })}
                programsByPair={programsByPair ?? undefined}
                dimmed={modified}
              />
            )}
          </>
        )
      )}

      {!query && hasKey && phase === "idle" && !failure && <StartState />}

      <AskDrawer open={askOpen} onOpenChange={setAskOpen} query={query} cell={askCell} hasKey={hasKey} />

      {query && (
        <CellSheet
          cell={selectedCell}
          sortBy={query.sort_by}
          includeFiltered={query.include_filtered}
          now={now}
          onClose={() => setSelected(null)}
          onTripsLoaded={onTripsLoaded}
        />
      )}
    </div>
  );
}
