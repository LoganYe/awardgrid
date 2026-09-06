"use client";

/**
 * The expanded row of the Queries page (spec §4): the last run's diff drawn with the real grid
 * cells — new, dropped, and cheaper, the same three buckets the scheduler notifies on — then
 * the last 20 runs as a plain table: time, calls used, result, and the skipped reason where
 * there is one.
 *
 * The data arrives with the page (the server reads the runs and rebuilds the diff from the
 * stored snapshots), so opening "Details" is instant; a "Run now" refetches
 * GET /api/queries/[id]/runs and the panel shows a loading line while that is in flight. Calls
 * used is null for runs recorded before the run rows carried a call count, and reads as an
 * en dash rather than a made-up zero.
 */
import { DiffCells } from "@/components/queries/diff-cells";
import { absoluteTime, relativeTime, runResultText } from "@/components/queries/format";
import type { QueryDetails } from "@/components/queries/api";
import { useLocale, useT } from "@/lib/i18n/client";

export interface RunHistoryProps {
  id: string;
  details: QueryDetails | null;
  loading: boolean;
  /** Already-translated error text when the refresh failed. */
  error: string | null;
  now: number;
}

/** No value recorded, as opposed to a recorded zero. */
const NO_VALUE = "–";

export function RunHistory({ id, details, loading, error, now }: RunHistoryProps) {
  const t = useT();
  const locale = useLocale();
  const runs = details?.runs ?? [];
  const diff = details?.diff ?? null;
  const drops = diff?.price_drops ?? [];
  const hasDiff = diff !== null && (diff.new.length > 0 || diff.dropped.length > 0 || drops.length > 0);
  // "−12% from 70,000": the fall, and what it fell from, beside the cell's new price.
  const dropTags = drops.map((d) =>
    t("saved.diff.drop_tag", { pct: d.pct, before: d.before_miles.toLocaleString(locale === "zh" ? "zh-CN" : "en-US") }),
  );

  return (
    <div className="flex flex-col gap-4" data-testid={`run-history-${id}`}>
      {error && (
        <p className="t-meta text-error" role="status">
          {error}
        </p>
      )}
      {loading && (
        <p className="t-meta text-fg-muted" role="status">
          {t("common.loading")}
        </p>
      )}

      <div className="flex flex-col gap-3">
        <p className="aq-section-title">{t("saved.diff.title")}</p>
        {hasDiff ? (
          <>
            <DiffCells title={t("saved.diff.new_cells")} rows={diff.new} kind="new" now={now} />
            <DiffCells title={t("saved.diff.dropped_cells")} rows={diff.dropped} kind="dropped" now={now} />
            <DiffCells
              title={t("saved.diff.price_drops")}
              rows={drops.map((d) => d.row)}
              tags={dropTags}
              kind="price_drop"
              now={now}
            />
          </>
        ) : (
          <p className="t-meta text-fg-muted" data-testid="diff-none">
            {t("saved.diff.none")}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <p className="aq-section-title">{t("saved.runs.title")}</p>
        {runs.length === 0 ? (
          <p className="t-meta text-fg-muted">{t("saved.runs.none")}</p>
        ) : (
          <table className="aq-runs t-meta" data-testid={`runs-table-${id}`}>
            <thead>
              <tr>
                <th scope="col">{t("saved.runs.time")}</th>
                <th scope="col">{t("saved.runs.calls_used")}</th>
                <th scope="col">{t("saved.runs.result")}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td title={absoluteTime(run.ran_at, locale)} suppressHydrationWarning>
                    {relativeTime(run.ran_at, now, locale)}
                  </td>
                  <td title={typeof run.calls_used === "number" ? undefined : t("saved.runs.not_recorded")}>
                    {typeof run.calls_used === "number" ? run.calls_used.toLocaleString(locale === "zh" ? "zh-CN" : "en-US") : NO_VALUE}
                  </td>
                  <td>{runResultText(run, t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
