"use client";
/**
 * The professional list (UI/UX v1 T19; spec §17 "专业列表"; docs/04 S10): the projection's rows in the view's sort,
 * one row each, header 44 and rows at least 64, grouped as route and date, cabin, program, miles, fees, seats and
 * source time. The sorted column says its direction in words and carries aria-sort. Each row opens its details
 * (a local action, nothing is fetched) or saves the option. Below 768 the same rows are cards (./option-card.tsx).
 */
import type { Locale } from "@awardgrid/core/i18n";
import { useLocale, useT } from "@awardgrid/core/i18n/client";
import type { QueryObject } from "@awardgrid/core/query/schema";
import { optionOrigin } from "@awardgrid/core/workspace/favorites-store";
import { dayLabel, feesLabel, formatMiles, programLabel, resultName, seatsLabel, sortShortLabel, timeLabel } from "@awardgrid/core/workspace/present";
import { cabinName } from "@awardgrid/core/workspace/query-editor";
import type { ProjectedResults, ResultSnapshot, WorkspaceRow } from "@awardgrid/core/workspace/types";
import { useDensity } from "@/components/grid/use-roving-grid";
import { OptionCard } from "./option-card";

export interface OptionActions {
  savedOrigins: ReadonlySet<string>;
  savingKey: string | null;
  readOnly: boolean;
  onSave: (rowKey: string) => void;
  /** Open the option's details (local: nothing is fetched); focus returns to `opener`, the control used, on close. */
  onOpen: (rowKey: string, opener?: HTMLElement) => void;
}

type SortColumn = "route" | "miles" | "fees" | "seats";
const COLUMN_SORT: Record<SortColumn, QueryObject["sort_by"]> = { route: "date_asc", miles: "miles_asc", fees: "fees_asc", seats: "seats_desc" };

export interface ListViewProps extends OptionActions {
  snapshot: ResultSnapshot;
  rows: ProjectedResults["rows"];
  sort: QueryObject["sort_by"];
  now: string;
  onSort: (sort: QueryObject["sort_by"]) => void;
  /** Set when the list is a subset (a calendar day, a matrix cell): its accessible name. */
  label?: string;
  testId?: string;
}

export function ListView({ snapshot, rows, sort, now, onSort, label, testId = "availability-list", ...actions }: ListViewProps) {
  const t = useT();
  const locale = useLocale();
  const density = useDensity();

  if (density === "mobile") {
    return (
      <ul className="ag-web-options" data-testid={testId} aria-label={label}>
        {rows.map((row) => (
          <li key={row.key}>
            <OptionCard
              row={row}
              snapshotId={snapshot.id}
              locale={locale}
              now={now}
              saved={actions.savedOrigins.has(optionOrigin(snapshot.id, row.key))}
              busy={actions.savingKey === row.key || actions.readOnly}
              onSave={() => actions.onSave(row.key)}
              onOpen={(opener) => actions.onOpen(row.key, opener)}
            />
          </li>
        ))}
      </ul>
    );
  }

  const header = (column: SortColumn, text: string) => {
    const active = COLUMN_SORT[column] === sort;
    return (
      <th scope="col" aria-sort={active ? (column === "seats" ? "descending" : "ascending") : "none"} className="ag-ws-th">
        <button type="button" className="ag-ws-sort" onClick={() => onSort(COLUMN_SORT[column])} aria-pressed={active}>
          <span>{text}</span>
          {active ? <span className="ag-ws-sort-dir">{sortShortLabel(sort, locale)}</span> : null}
        </button>
      </th>
    );
  };

  return (
    <div className="ag-ws-table-wrap">
      <table className="ag-ws-table" data-testid={testId} aria-label={label ?? t("workspace.sorted_by", { what: sortShortLabel(sort, locale) })}>
        <thead>
          <tr>
            {header("route", t("workspace.col.route"))}
            <th scope="col" className="ag-ws-th">
              {t("workspace.col.cabin")}
            </th>
            <th scope="col" className="ag-ws-th">
              {t("workspace.col.program")}
            </th>
            {header("miles", t("workspace.col.miles"))}
            {header("fees", t("workspace.col.fees"))}
            {header("seats", t("workspace.col.seats"))}
            <th scope="col" className="ag-ws-th">
              {t("workspace.col.time")}
            </th>
            <th scope="col" className="ag-ws-th">
              <span className="sr-only">{t("workspace.col.actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <ListRow key={row.key} row={row} snapshotId={snapshot.id} now={now} actions={actions} locale={locale} t={t} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ListRow({ row, snapshotId, now: at, actions: act, locale, t }: { row: WorkspaceRow; snapshotId: string; now: string; actions: OptionActions; locale: Locale; t: ReturnType<typeof useT> }) {
  const v = row.value;
  const saved = act.savedOrigins.has(optionOrigin(snapshotId, row.key));
  const name = resultName(v, locale);
  const nameId = `opt-${snapshotId}-${row.key}`.replace(/[^A-Za-z0-9_-]/g, "_");
  return (
    <tr className="ag-ws-row" data-row-key={row.key} data-snapshot-id={snapshotId}>
      <th scope="row" className="ag-ws-td ag-ws-td-route" id={nameId}>
        <span className="ag-ws-route">
          {v.origin} → {v.dest}
        </span>
        <span className="ag-ws-sub">{dayLabel(v.date, locale)}</span>
      </th>
      <td className="ag-ws-td">{cabinName(v.cabin, locale)}</td>
      <td className="ag-ws-td ag-ws-td-wrap">{programLabel(v.program)}</td>
      <td className="ag-ws-td ag-ws-td-miles tabular">{formatMiles(v.miles)}</td>
      <td className="ag-ws-td tabular">{feesLabel(v.fees_cents, v.currency, locale)}</td>
      <td className="ag-ws-td tabular">{seatsLabel(v.seats_left, locale)}</td>
      <td className="ag-ws-td ag-ws-td-wrap">
        <span className="ag-ws-sub">{timeLabel(row.time, at, locale)}</span>
      </td>
      <td className="ag-ws-td ag-ws-td-actions">
        <button type="button" className="ag-ws-button" onClick={(e) => act.onOpen(row.key, e.currentTarget)} aria-label={t("workspace.view_option_named", { name })}>
          {t("workspace.view_option")}
        </button>
        <button
          type="button"
          className="ag-ws-button ag-ws-button-quiet"
          aria-pressed={saved}
          aria-describedby={nameId}
          disabled={act.savingKey === row.key || act.readOnly || saved}
          onClick={() => act.onSave(row.key)}
        >
          {saved ? t("workspace.option_saved") : t("workspace.save_option")}
        </button>
      </td>
    </tr>
  );
}
