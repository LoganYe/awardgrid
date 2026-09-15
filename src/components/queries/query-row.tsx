"use client";

/**
 * One standing query, in the two shapes spec §4 and §6 ask for: a table row at ≥ 768 px
 * (`QueryRow`) and a stacked card below it (`QueryCard`, 40 px targets). Both read the same
 * props and render the same words, so nothing is true on one breakpoint only.
 *
 * Row anatomy: name · schedule ("every 3 hours") · notifies on · last run (relative + what it
 * found) · next run (relative) · an Enabled switch · Run now / Edit / Delete. "Delete" swaps
 * the actions for the inline confirmation (spec §11: never a modal); "Run now" spins on the row
 * and leaves its result — or its error, 409 in progress and 429 quota included — in the notice
 * line under the row, never in a dialog. "Details" is a plain text toggle carrying
 * aria-expanded/aria-controls over the panel with the last diff and the last 20 runs.
 */
import { InlineConfirm } from "@/components/queries/inline-confirm";
import { RunHistory } from "@/components/queries/run-history";
import { nextRunFromCron, relativeTime, runResultText, scheduleText, absoluteTime } from "@/components/queries/format";
import type { QueryDetails, QueryRowSummary } from "@/components/queries/api";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { I18nKey, Locale, Translate } from "@awardgrid/core/i18n";
import { useLocale, useT } from "@awardgrid/core/i18n/client";

export const QUERY_COLUMN_COUNT = 7;

const NOTIFY_KEY: Record<QueryRowSummary["notify_on"], I18nKey> = {
  new_cells: "saved.notify.new_cells",
  price_drop: "saved.notify.price_drop",
  both: "saved.notify.both",
};

export interface RowNotice {
  kind: "ok" | "error";
  text: string;
}

export interface QueryRowProps {
  row: QueryRowSummary;
  /** "Now" in ms: every relative time and every freshness mark on the row reads from it. */
  now: number;
  expanded: boolean;
  confirmingDelete: boolean;
  running: boolean;
  busy: boolean;
  notice: RowNotice | null;
  details: QueryDetails | null;
  detailsLoading: boolean;
  detailsError: string | null;
  onToggleExpand: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onRun: () => void;
  onEdit: () => void;
  onAskDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}

/** "2 hours ago" plus what the run found, or "Never" for a query that has not run. */
function lastRunText(row: QueryRowSummary, now: number, locale: Locale, t: Translate): { when: string; result: string; title?: string } {
  const run = row.last_run;
  if (!run) return { when: t("saved.never_run"), result: "" };
  return { when: relativeTime(run.ran_at, now, locale), result: runResultText(run, t), title: absoluteTime(run.ran_at, locale) };
}

/**
 * "in 58 minutes". A paused query has no next run, and a cron shape the client cannot read
 * falls back to the expression itself rather than a wrong promise.
 */
function nextRunText(row: QueryRowSummary, now: number, locale: Locale, t: Translate): string {
  if (!row.enabled) return t("saved.paused");
  const at = row.next_run_at ?? nextRunFromCron(row.schedule_cron, now);
  if (!at) return row.schedule_cron;
  // The API's next run is measured from the last run, so it sits in the past when the worker
  // has not caught up yet. "3 hours ago" would read as a run that happened; it is one that owes.
  const ms = Date.parse(at);
  if (!Number.isNaN(ms) && ms <= now) return t("saved.due_now");
  return relativeTime(at, now, locale);
}

/** Run now / Edit / Delete, or the inline confirmation once Delete is pressed. */
function RowActions(
  props: Pick<QueryRowProps, "row" | "running" | "busy" | "confirmingDelete" | "onRun" | "onEdit" | "onAskDelete" | "onConfirmDelete" | "onCancelDelete"> & {
    /** Where the confirmation sits: the table's Actions cell is right-aligned, the card is not. */
    align?: "start" | "end";
  },
) {
  const t = useT();
  const { row, running, busy, confirmingDelete, align = "end" } = props;
  if (confirmingDelete) {
    return (
      <InlineConfirm
        // The name, not "this query" (docs/UI_PLAN.md §6.7): with several rows "this" is not
        // anchored to anything the eye can follow. "Keep" is the dismissal verb, not "Cancel".
        question={t("saved.delete_title", { name: row.name })}
        confirmLabel={t("saved.delete")}
        cancelLabel={t("saved.keep")}
        align={align}
        busy={busy}
        restoreFocusTo={`[data-testid="delete-${row.id}"]`}
        onConfirm={props.onConfirmDelete}
        onCancel={props.onCancelDelete}
        data-testid={`delete-confirm-${row.id}`}
      />
    );
  }
  return (
    <div className="aq-actions">
      <Button type="button" size="xs" variant="outline" disabled={running || busy} aria-busy={running || undefined} onClick={props.onRun} data-testid={`run-${row.id}`}>
        {running ? t("saved.running") : t("saved.run_now")}
      </Button>
      <Button type="button" size="xs" variant="ghost" disabled={busy} onClick={props.onEdit} data-testid={`edit-${row.id}`}>
        {t("saved.edit")}
      </Button>
      <Button type="button" size="xs" variant="ghost" disabled={busy} onClick={props.onAskDelete} data-testid={`delete-${row.id}`}>
        {t("saved.delete")}
      </Button>
    </div>
  );
}

function DetailsToggle({ id, expanded, onToggle }: { id: string; expanded: boolean; onToggle: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      className="link t-meta self-start"
      aria-expanded={expanded}
      aria-controls={`query-details-${id}`}
      onClick={onToggle}
      data-testid={`details-${id}`}
    >
      {t("saved.details")}
    </button>
  );
}

function EnabledSwitch({ row, busy, onToggleEnabled }: Pick<QueryRowProps, "row" | "busy" | "onToggleEnabled">) {
  const t = useT();
  return (
    <Switch
      size="sm"
      checked={row.enabled}
      disabled={busy}
      aria-label={t("saved.enable_aria", { name: row.name })}
      data-testid={`enabled-${row.id}`}
      onCheckedChange={(checked) => onToggleEnabled(checked)}
    />
  );
}

function Notice({ notice }: { notice: RowNotice }) {
  return (
    <p className={notice.kind === "error" ? "t-meta text-error" : "t-meta text-fg-muted"} role="status" data-testid="row-notice">
      {notice.text}
    </p>
  );
}

/** The ≥ 768 px shape: one `<tr>`, plus a notice row and an expanded panel row when they exist. */
export function QueryRow(props: QueryRowProps) {
  const t = useT();
  const locale = useLocale();
  const { row, now, expanded, notice, details, detailsLoading, detailsError } = props;
  const last = lastRunText(row, now, locale, t);
  return (
    <>
      <tr className="aq-row" data-enabled={row.enabled} data-testid={`query-row-${row.id}`}>
        <td>
          <div className="flex flex-col gap-0.5">
            <span className="aq-name">{row.name}</span>
            <DetailsToggle id={row.id} expanded={expanded} onToggle={props.onToggleExpand} />
          </div>
        </td>
        <td title={row.schedule_cron}>{scheduleText(t, row.schedule_cron, row.schedule_label)}</td>
        <td>{t(NOTIFY_KEY[row.notify_on])}</td>
        <td>
          <div className="flex flex-col gap-0.5">
            <span title={last.title} suppressHydrationWarning>
              {last.when}
            </span>
            {last.result && <span className="aq-meta">{last.result}</span>}
          </div>
        </td>
        <td suppressHydrationWarning>{nextRunText(row, now, locale, t)}</td>
        <td>
          <EnabledSwitch row={row} busy={props.busy} onToggleEnabled={props.onToggleEnabled} />
        </td>
        <td>
          <RowActions {...props} />
        </td>
      </tr>
      {notice && (
        <tr className="aq-row">
          <td colSpan={QUERY_COLUMN_COUNT}>
            <Notice notice={notice} />
          </td>
        </tr>
      )}
      {expanded && (
        <tr>
          <td className="aq-details" colSpan={QUERY_COLUMN_COUNT} id={`query-details-${row.id}`}>
            <RunHistory id={row.id} details={details} loading={detailsLoading} error={detailsError} now={now} />
          </td>
        </tr>
      )}
    </>
  );
}

/** The < 768 px shape: name + schedule + notifies on + last run + next run + the switch, actions below. */
export function QueryCard(props: QueryRowProps) {
  const t = useT();
  const locale = useLocale();
  const { row, now, expanded, notice, details, detailsLoading, detailsError } = props;
  const last = lastRunText(row, now, locale, t);
  return (
    <li className="aq-card" data-enabled={row.enabled} data-testid={`query-row-${row.id}`}>
      <div className="aq-card-head">
        <div className="flex flex-col gap-0.5">
          <span className="aq-name">{row.name}</span>
          <span className="aq-meta" title={row.schedule_cron}>
            {scheduleText(t, row.schedule_cron, row.schedule_label)}
          </span>
          {/* The table's "Notifies on" column: the card carries the same seven facts as the row. */}
          {/* The card has no column headers, so "Both" and "due now" carry their own label —
              without them the two lines are values with nothing to attach to. */}
          <span className="aq-meta">{t("saved.card.notify_on", { value: t(NOTIFY_KEY[row.notify_on]) })}</span>
          <span className="aq-meta" title={last.title} suppressHydrationWarning>
            {last.result ? `${last.when}, ${last.result}` : last.when}
          </span>
          <span className="aq-meta" suppressHydrationWarning>
            {t("saved.card.next_run", { value: nextRunText(row, now, locale, t) })}
          </span>
        </div>
        <EnabledSwitch row={row} busy={props.busy} onToggleEnabled={props.onToggleEnabled} />
      </div>
      <RowActions {...props} align="start" />
      <DetailsToggle id={row.id} expanded={expanded} onToggle={props.onToggleExpand} />
      {notice && <Notice notice={notice} />}
      {expanded && (
        <div className="aq-details" id={`query-details-${row.id}`}>
          <RunHistory id={row.id} details={details} loading={detailsLoading} error={detailsError} now={now} />
        </div>
      )}
    </li>
  );
}
