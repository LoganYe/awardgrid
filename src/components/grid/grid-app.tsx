"use client";

/**
 * The grid page's client orchestrator: query box → /api/parse → chips → /api/find → grid.
 * The QueryObject lives in React state AND in the URL (?q=base64url JSON) so links are
 * shareable; orientation is a pure client-side transpose (no extra API call).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { transposeGrid } from "@/lib/grid/pivot";
import type { AvailabilityRow, Grid, GridCell, Orientation } from "@/lib/grid/types";
import { useT } from "@/lib/i18n/client";
import type { QueryObject } from "@/lib/query/schema";
import type { Provenance } from "@/lib/query/deterministic";
import type { QuotaSnapshot, TripsForUserResult } from "@/lib/server/find";
import { noticeKey } from "@/lib/notices";
import { apiExport, apiFind, apiParse, uiNotices, type ApiFailure, type UiNotice } from "@/components/grid/api";
import { CellSheet } from "@/components/grid/cell-sheet";
import { Chips } from "@/components/grid/chips";
import { FailureState, NoKeyState, NoResultsState, StartState } from "@/components/grid/empty-states";
import { GridTable } from "@/components/grid/grid-table";
import { HeaderBar } from "@/components/grid/header-bar";
import { QueryBox } from "@/components/grid/query-box";
import { applyChipAction, gridHref, localToday, mergeTripsIntoGrid, type ChipAction } from "@/components/grid/state";

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
  const [orientation, setOrientation] = useState<Orientation>("dates");
  const [now, setNow] = useState<number>(0);
  const [selected, setSelected] = useState<CellRef | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const inflight = useRef<AbortController | null>(null);

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
      try {
        const res = await apiFind(q, "dates", controller.signal);
        if (controller.signal.aborted) return;
        if (res.ok) {
          setGrid(res.value.grid);
          setQuota(res.value.quota);
          setFindWarnings(uiNotices(res.value));
          setNow(Date.now());
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

  function onChip(action: ChipAction) {
    if (!query) return;
    const next = applyChipAction(query, action);
    setQuery(next);
    setSelected(null);
    if (hasKey) void runFind(next);
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

  const shown = useMemo(() => (grid ? (orientation === "routes" ? transposeGrid(grid) : grid) : null), [grid, orientation]);
  const selectedCell = useMemo(() => (grid ? findCell(grid, selected) : null), [grid, selected]);
  const busy = phase === "parsing" || phase === "loading";
  const warnings = [...parseWarnings, ...findWarnings];

  return (
    <div className="flex flex-col gap-3">
      <QueryBox initialText={initialQuery?.raw_text ?? ""} busy={busy} llmAvailable={llmAvailable} onSubmit={(text) => void onSubmitText(text)} />

      {query && <Chips query={query} provenance={provenance} disabled={phase === "parsing"} onChange={onChip} />}

      {warnings.length > 0 && (
        <details className="text-xs text-muted-foreground">
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

      {failure && <FailureState failure={failure} onRetry={query && hasKey ? () => void runFind(query) : undefined} />}

      {phase === "loading" && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {t("grid.searching")}
        </p>
      )}

      {shown && grid && (
        <>
          <HeaderBar
            grid={shown}
            quota={quota}
            now={now}
            orientation={orientation}
            exporting={exporting}
            onToggleOrientation={() => setOrientation((o) => (o === "dates" ? "routes" : "dates"))}
            onExport={() => void onExport()}
          />
          {exportError && <p className="text-xs text-destructive">{exportError}</p>}
          {gridHasResults(grid) ? (
            <GridTable grid={shown} now={now} selected={selectedCell} onSelect={(c) => setSelected({ origin: c.origin, dest: c.dest, date: c.date })} />
          ) : (
            <NoResultsState />
          )}
          <p className="text-[11px] text-muted-foreground">
            {t("grid.freshness.legend")} · {t("grid.cell.click_hint")} · {t("grid.share_hint")}
          </p>
        </>
      )}

      {!query && hasKey && phase === "idle" && !failure && <StartState />}

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
