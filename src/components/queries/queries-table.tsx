"use client";

/**
 * /queries — the single table spec §4 asks for, in one 880 px column: name · schedule ·
 * notifies on · last run · next run · enabled · actions. Below 768 px the same rows become a
 * stacked list (spec §6); above it they are a real `<table>` so the columns line up and the
 * numbers stay in tabular figures.
 *
 * Everything the page shows arrives with the server render (the rows, each one's next run, its
 * last 20 runs and its last diff), so expanding a row costs no round trip. Mutations go through
 * /api/queries and patch local state: the Enabled switch PATCHes optimistically and rolls back
 * on failure, "Run now" POSTs and leaves its result or its error in the row, and "Delete"
 * confirms inline in the row (spec §11 — never a modal). One toast, bottom-left, says what
 * happened after a save or a delete.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useDensity } from "@/components/grid/use-roving-grid";
import { EditQueryDrawer } from "@/components/queries/edit-query-drawer";
import { QueryCard, QueryRow, type RowNotice } from "@/components/queries/query-row";
import { nextRunFromCron, runResultText } from "@/components/queries/format";
import {
  apiDeleteQuery,
  apiListRuns,
  apiPatchQuery,
  apiRunQuery,
  normalizeDetails,
  type QueryDetails,
  type QueryRowSummary,
  type RunSummary,
  type SavedQuerySummary,
} from "@/components/queries/api";
import { formatDate } from "@/components/settings/api";
import { errorText } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/client";
import "@/components/queries/queries.css";

export interface QueriesTableProps {
  initial: QueryRowSummary[];
  /** Saved-query id → its last 20 runs and last diff, read on the server. */
  details: Record<string, QueryDetails>;
  telegramLinked: boolean;
}

/** How long the toast stays (docs/UI_PLAN.md §7: one line, 4 s, one at a time). */
const TOAST_MS = 4000;

type DetailsState = { loading: boolean; error: string | null };

export function QueriesTable({ initial, details, telegramLinked }: QueriesTableProps) {
  const t = useT();
  const locale = useLocale();
  const density = useDensity();
  const [rows, setRows] = useState<QueryRowSummary[]>(initial);
  const [detailsMap, setDetailsMap] = useState<Record<string, QueryDetails>>(details);
  const [detailsState, setDetailsState] = useState<Record<string, DetailsState>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [running, setRunning] = useState<ReadonlySet<string>>(() => new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notices, setNotices] = useState<Record<string, RowNotice | null>>({});
  const [editing, setEditing] = useState<QueryRowSummary | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Relative times age while the page is open. The server's clock and the browser's are a few
  // milliseconds apart, so every element that prints one carries suppressHydrationWarning.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (toast === null) return;
    const id = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(id);
  }, [toast]);

  const failText = useCallback(
    (error: string, resetAt?: string) => errorText(locale, error, resetAt ? { resetAt: formatDate(resetAt, locale) } : undefined),
    [locale],
  );

  const setNotice = useCallback((id: string, notice: RowNotice | null) => {
    setNotices((n) => ({ ...n, [id]: notice }));
  }, []);

  /** Merge an API row back in, keeping a `next_run_at` the server did not send. */
  const replaceRow = useCallback((next: SavedQuerySummary) => {
    setRows((rs) =>
      rs.map((r) => {
        if (r.id !== next.id) return r;
        const supplied = (next as QueryRowSummary).next_run_at;
        return { ...r, ...next, next_run_at: supplied ?? nextRunFromCron(next.schedule_cron, Date.now()) };
      }),
    );
  }, []);

  const refreshDetails = useCallback(async (id: string) => {
    setDetailsState((s) => ({ ...s, [id]: { loading: true, error: null } }));
    const res = await apiListRuns(id);
    if (!res.ok) {
      setDetailsState((s) => ({ ...s, [id]: { loading: false, error: t("saved.runs.load_failed") } }));
      return;
    }
    const fresh = normalizeDetails(res.data);
    // `query_runs.calls_used` carries the count now, so the server's rows are authoritative and
    // replace what the page remembered. `rememberRun` still exists for the other half: showing a
    // "run now" at the top of the history before this refetch lands.
    setDetailsMap((m) => ({
      ...m,
      [id]: { runs: fresh.runs, diff: fresh.diff ?? m[id]?.diff ?? null },
    }));
    setDetailsState((s) => ({ ...s, [id]: { loading: false, error: null } }));
  }, [t]);

  /** Put a just-finished run at the top of the row's history, with the call count only it knows. */
  const rememberRun = useCallback((id: string, run: RunSummary) => {
    setDetailsMap((m) => {
      const prev = m[id];
      const runs = [run, ...(prev?.runs ?? []).filter((r) => r.id !== run.id)];
      return { ...m, [id]: { runs, diff: prev?.diff ?? null } };
    });
  }, []);

  async function onToggleEnabled(row: QueryRowSummary, enabled: boolean) {
    setBusyId(row.id);
    setNotice(row.id, null);
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, enabled } : r))); // optimistic
    const res = await apiPatchQuery(row.id, { enabled });
    setBusyId(null);
    if (res.ok) replaceRow(res.data.query);
    else {
      setRows((rs) => rs.map((r) => (r.id === row.id ? row : r)));
      setNotice(row.id, { kind: "error", text: failText(res.error, res.resetAt) });
    }
  }

  async function onRun(row: QueryRowSummary) {
    setRunning((s) => new Set(s).add(row.id));
    setNotice(row.id, null);
    const res = await apiRunQuery(row.id);
    setRunning((s) => {
      const next = new Set(s);
      next.delete(row.id);
      return next;
    });
    if (!res.ok) {
      setNotice(row.id, { kind: "error", text: failText(res.error, res.resetAt) });
      return;
    }
    const run = res.data.run;
    // The server derives the next run from the last one, so a row that just ran is no longer
    // due: recompute it here the way replaceRow does for a PATCH, or an overdue query keeps
    // saying "due now" until the page is reloaded.
    const ranAtMs = Date.parse(run.ran_at);
    setRows((rs) =>
      rs.map((r) =>
        r.id === row.id
          ? {
              ...r,
              last_run: run,
              last_run_at: run.ran_at,
              // An unparseable timestamp leaves the old next run alone rather than inventing one.
              ...(Number.isNaN(ranAtMs) ? {} : { next_run_at: nextRunFromCron(r.schedule_cron, ranAtMs) }),
            }
          : r,
      ),
    );
    rememberRun(row.id, run);
    setNotice(row.id, { kind: "ok", text: t("saved.run_done", { summary: runResultText(run, t) }) });
    await refreshDetails(row.id);
  }

  async function onDelete(row: QueryRowSummary) {
    setBusyId(row.id);
    const res = await apiDeleteQuery(row.id);
    setBusyId(null);
    setConfirming(null);
    if (res.ok || res.status === 404) {
      setRows((rs) => rs.filter((r) => r.id !== row.id));
      setToast(t("saved.deleted"));
    } else {
      setNotice(row.id, { kind: "error", text: failText(res.error, res.resetAt) });
    }
  }

  function rowProps(row: QueryRowSummary) {
    const state = detailsState[row.id];
    return {
      row,
      now,
      expanded: expanded === row.id,
      confirmingDelete: confirming === row.id,
      running: running.has(row.id),
      busy: busyId === row.id,
      notice: notices[row.id] ?? null,
      details: detailsMap[row.id] ?? null,
      detailsLoading: state?.loading ?? false,
      detailsError: state?.error ?? null,
      onToggleExpand: () => setExpanded((id) => (id === row.id ? null : row.id)),
      onToggleEnabled: (enabled: boolean) => void onToggleEnabled(row, enabled),
      onRun: () => void onRun(row),
      onEdit: () => setEditing(row),
      onAskDelete: () => setConfirming(row.id),
      onConfirmDelete: () => void onDelete(row),
      onCancelDelete: () => setConfirming(null),
    };
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3" data-testid="queries-empty">
        <p className="t-body">{t("saved.empty")}</p>
        {/* A real anchor: the empty state's call to action is navigation, so it must be a link —
            and a link BUTTON, not a boxed one (docs/UI_PLAN.md §6.7: "left-aligned, no box"). */}
        <Link href="/grid" className="link">
          {t("saved.empty_cta")}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {!telegramLinked && (
        <p className="t-meta text-fg-muted">
          {t("saved.telegram_hint")}{" "}
          <Link href="/settings#telegram" className="link">
            {t("saved.telegram_hint_cta")}
          </Link>
        </p>
      )}

      {density === "mobile" ? (
        <ul className="aq-list" data-testid="queries-list">
          {rows.map((row) => (
            <QueryCard key={row.id} {...rowProps(row)} />
          ))}
        </ul>
      ) : (
        <table className="aq-table" data-testid="queries-table">
          <thead>
            <tr>
              <th scope="col">{t("saved.name")}</th>
              <th scope="col">{t("saved.schedule")}</th>
              <th scope="col">{t("saved.notify_on")}</th>
              <th scope="col">{t("saved.last_run")}</th>
              <th scope="col">{t("saved.next_run")}</th>
              <th scope="col">{t("saved.enabled")}</th>
              <th scope="col">{t("saved.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <QueryRow key={row.id} {...rowProps(row)} />
            ))}
          </tbody>
        </table>
      )}

      {editing && (
        <EditQueryDrawer
          saved={editing}
          open
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            replaceRow(saved);
            setToast(t("saved.updated"));
          }}
        />
      )}

      {toast && (
        <p className="aq-toast" role="status" data-testid="queries-toast">
          {toast}
        </p>
      )}
    </div>
  );
}

/** Route-level loading shape (src/app/queries/loading.tsx): static bars under reduced motion. */
export function QueriesSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true" data-testid="queries-skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="aq-skel-row">
          <span className="aq-skel-bar" />
          <span className="aq-skel-bar" />
          <span className="aq-skel-bar" />
        </div>
      ))}
    </div>
  );
}
