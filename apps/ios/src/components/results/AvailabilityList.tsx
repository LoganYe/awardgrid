/**
 * The List view (UI/UX v1 T08; docs/04 S03): one card per row of the projection, in the view's sort — every program
 * and cabin its own card, never folded into a "best" one. Under the fee sort the cards are grouped by currency
 * (then an amount without a currency, then fees not yet confirmed), because fees in different currencies are not
 * compared (D07); each group is named. Also used for a calendar day's options.
 */
import { feeGroup } from "@awardgrid/core/workspace/projection";
import { copy } from "@awardgrid/core/workspace/present";
import type { RowKey, SnapshotId, ViewPreferences, WorkspaceRow } from "@awardgrid/core/workspace/types";
import { useId } from "react";
import type { Locale } from "../../app/locale";
import { AvailabilityCard } from "./AvailabilityCard";
import { RESULTS } from "./copy";

export interface AvailabilityListProps {
  rows: readonly WorkspaceRow[];
  sort: ViewPreferences["sort"];
  snapshotId: SnapshotId;
  selected: ReadonlySet<RowKey>;
  onToggle: (rowKey: RowKey, on: boolean) => void;
  now: string;
  locale: Locale;
  headingLevel?: 2 | 3;
  testId?: string;
}

function groupName(group: string, locale: Locale): string {
  if (group === "unknown") return copy("fees.unknown", locale);
  if (group === "currency_unknown") return copy("fees.currency_unknown", locale);
  return RESULTS[locale].feeGroup(group);
}

export function AvailabilityList({ rows, sort, snapshotId, selected, onToggle, now, locale, headingLevel = 2, testId = "availability-list" }: AvailabilityListProps) {
  const id = useId();
  const card = (row: WorkspaceRow) => (
    <AvailabilityCard
      key={row.key}
      row={row}
      snapshotId={snapshotId}
      selected={selected.has(row.key)}
      onToggle={(on) => onToggle(row.key, on)}
      now={now}
      locale={locale}
      headingLevel={headingLevel}
    />
  );
  // Rows arrive sorted, so under the fee sort each group is one run of consecutive rows.
  const groups: Array<{ name: string; rows: WorkspaceRow[] }> = [];
  if (sort === "fees_asc") {
    for (const row of rows) {
      const name = feeGroup(row.value);
      const last = groups.at(-1);
      if (last && last.name === name) last.rows.push(row);
      else groups.push({ name, rows: [row] });
    }
  }
  if (groups.length < 2) {
    return (
      <div className="ag-result-list" data-testid={testId}>
        {rows.map(card)}
      </div>
    );
  }
  return (
    <div className="ag-result-list" data-testid={testId}>
      {groups.map((group, i) => (
        <div key={group.name} role="group" aria-labelledby={`${id}-${i}`} className="ag-result-group" data-fee-group={group.name}>
          <p id={`${id}-${i}`} className="ag-result-group-name">
            {groupName(group.name, locale)}
          </p>
          {group.rows.map(card)}
        </div>
      ))}
    </div>
  );
}
