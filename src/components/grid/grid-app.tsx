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
import { useT } from "@/lib/i18n/client";
import type { Cabin, QueryObject } from "@/lib/query/schema";
import type { Provenance } from "@/lib/query/deterministic";
import type { QuotaSnapshot, TripsForUserResult } from "@/lib/server/find";
import { noticeKey } from "@/lib/notices";
import { apiExport, apiFind, apiParse, uiNotices, type ApiFailure, type UiNotice } from "@/components/grid/api";
import { CellSheet } from "@/components/grid/cell-sheet";
import { Chips } from "@/components/grid/chips";
import { FailureState, NoKeyState, StartState } from "@/components/grid/empty-states";
import { GridEmptyResults, GridTable, skeletonGridFor, type GridTableHandle } from "@/components/grid/grid-table";
import { QueryBox } from "@/components/grid/query-box";
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
  const [query, setQuery] = useState<QueryObject | null>(initialQuery);
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

  // Keep ?q= in sync so the URL is always shareable.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const href = gridHref(query);
    if (window.location.pathname + window.location.search !== href) window.history.replaceState(null, "", href);
  }, [query]);

  const runFind = useCallback(
    async (q: QueryObject) => {
      inflight.current?.abort();
      const controller = new AbortController();
      inflight.current = controller;
      setPhase("loading");
      setFailure(null);
      setRevealGrid(false);
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

  async function onSubmitText(text: string) {
    inflight.current?.abort();
    setPhase("parsing");
    setFailure(null);
    setExportError(null);
    const res = await apiParse(text, localToday());
    if (!res.ok) {
      setFailure(res);
      setPhase("ready");
      return;
    }
    setQuery(res.value.query);
    setProvenance(res.value.provenance);
    setParseWarnings(uiNotices(res.value));
    setSelected(null);
    if (!hasKey) {
      setPhase("ready");
      return;
    }
    await runFind(res.value.query);
  }

  /** Commit an edited query: chips are the source of truth, so every edit re-runs (6.3 adds the modified state). */
  function commit(next: QueryObject) {
    setQuery(next);
    setSelected(null);
    if (hasKey) void runFind(next);
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

  // Empty-results suggestions. TODO(6.3): open the Dates / Cabins chip editors instead; until
  // the editors exist these apply the smallest useful edit and re-run.
  function onWidenDates() {
    if (!query) return;
    onChip({ type: "set_dates", date_to: addDays(query.date_to, 30) });
  }
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
  const skeleton = useMemo(() => (phase === "loading" && query ? skeletonGridFor(query, orientation, now) : null), [phase, query, orientation, now]);
  const hasResults = grid !== null && gridHasResults(grid);
  // The toolbar stays on the quota state too, so Save is visibly disabled with its reason (spec §3.7).
  const showToolbar = query !== null && hasKey && (shown !== null || skeleton !== null || quotaExceeded);

  return (
    <div className="flex flex-col gap-3">
      <QueryBox
        initialText={initialQuery?.raw_text ?? ""}
        busy={busy}
        llmAvailable={llmAvailable}
        onSubmit={(text) => void onSubmitText(text)}
        disabled={quotaExceeded}
        disabledTitle={t("grid.toolbar.run_disabled_quota")}
      />

      {query && <Chips query={query} provenance={provenance} disabled={phase === "parsing"} onChange={onChip} />}

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

      {failure && failure.error !== "quota" && <FailureState failure={failure} onRetry={query && hasKey ? () => void runFind(query) : undefined} />}

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
          searching={phase === "loading"}
        />
      )}
      {exportError && <p className="t-meta text-error">{exportError}</p>}

      {skeleton ? (
        <GridTable grid={skeleton} now={now} selected={null} onSelect={() => undefined} loading />
      ) : (
        shown &&
        grid && (
          <>
            {!hasResults && (
              <GridEmptyResults grid={shown} now={now} programsChecked={programsChecked} onWidenDates={onWidenDates} onAddCabin={onAddCabin} onReviewUnmonitored={onReviewUnmonitored} />
            )}
            {(hasResults || revealGrid) && (
              <GridTable
                ref={gridRef}
                grid={shown}
                now={now}
                selected={selectedCell}
                onSelect={(c) => setSelected({ origin: c.origin, dest: c.dest, date: c.date })}
                programsByPair={programsByPair ?? undefined}
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
