/**
 * A change to the search Claude proposed (UI/UX v1 T16; docs/04 S09; docs/02 D08; acceptance A27).
 *
 * The card shows what would change, field by field, from the typed queries (the one the question was about, and the
 * validated proposal), never from the model's words; the model's reason is shown as its reason. Each changed field
 * is marked Original and New, not by colour alone. "Apply and search" runs it once, through the normal search, on the
 * person's own quota; "Keep current conditions" sets it aside and changes nothing. A proposal made before the query
 * changed is stale: it says so and cannot be applied.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { EntryProposal } from "@awardgrid/core/ask/conversation";
import type { QueryObject } from "@awardgrid/core/query/schema";
import { copy, formatMiles, programLabel, rangeLabel, routeLabel } from "@awardgrid/core/workspace/present";
import { type ProposalField, proposalChanges } from "@awardgrid/core/workspace/proposals";
import { cabinName } from "@awardgrid/core/workspace/query-editor";
import type { QueryChangeProposal as Proposal } from "@awardgrid/core/workspace/types";
import type { Locale } from "../app/locale";
import { ASK_COPY, type AskCopy } from "../ask/ask-copy";
import { EDITOR_COPY } from "./query/labels";

const ALL_FIELDS: readonly ProposalField[] = ["route", "dates", "cabins", "programs", "direct_only", "max_miles", "min_cabin_pct", "include_filtered"];

function fieldLabel(field: ProposalField, locale: Locale, c: AskCopy): string {
  const e = EDITOR_COPY[locale];
  const labels: Record<ProposalField, string> = {
    route: c.fieldRoute,
    dates: e.dates,
    cabins: e.cabins,
    programs: e.programs,
    direct_only: e.direct,
    max_miles: e.miles,
    min_cabin_pct: e.mixed,
    include_filtered: c.fieldDynamic,
  };
  return labels[field];
}

/** A field's value, as the editor would say it. */
function fieldValue(field: ProposalField, q: QueryObject, locale: Locale, c: AskCopy): string {
  const e = EDITOR_COPY[locale];
  const sep = locale === "zh" ? "、" : ", ";
  switch (field) {
    case "route":
      return routeLabel(q, locale);
    case "dates":
      return `${rangeLabel(q.date_from, q.date_to, locale)} (${q.date_from} – ${q.date_to})`;
    case "cabins":
      return (["J", "F", "W", "Y"] as const).filter((cabin) => q.cabins.includes(cabin)).map((cabin) => cabinName(cabin, locale)).join(sep);
    case "programs":
      return q.programs && q.programs.length > 0 ? q.programs.map(programLabel).join(sep) : e.programsAll;
    case "direct_only":
      return q.direct_only ? c.yes : c.no;
    case "max_miles":
      return typeof q.max_miles === "number" ? (locale === "zh" ? `≤ ${formatMiles(q.max_miles)} 里程` : `≤ ${formatMiles(q.max_miles)} miles`) : c.noCap;
    case "min_cabin_pct":
      return e.mixedOptions.find(([pct]) => pct === q.min_cabin_pct)?.[1] ?? e.mixedOther(q.min_cabin_pct);
    case "include_filtered":
      return q.include_filtered ? c.included : c.notIncluded;
  }
}

export interface QueryChangeProposalProps {
  proposal: EntryProposal;
  /**
   * The search on screen, for a proposal made with no search included (T16 review UX-5): compared locally, so only what
   * would change is marked; it was not sent to Claude. Null when there is none.
   */
  shown?: QueryObject | null;
  /** proposalStatus against the workspace's current revision. */
  status: Proposal["status"];
  locale: Locale;
  onApply(): void;
  onKeep(): void;
}

export function QueryChangeProposal({ proposal, shown = null, status, locale, onApply, onKeep }: QueryChangeProposalProps) {
  const c = ASK_COPY[locale];
  const titleId = `proposal-${proposal.id}`;
  // What it is compared with: the search it was made about; or, with none sent, the one on screen (local only).
  const before = proposal.base ?? shown;
  const fields = before === null ? ALL_FIELDS : proposalChanges(before, proposal.proposed);
  // Focus follows the card's own change: after Apply, to the way to the results; after Keep, to its note.
  const [acted, setActed] = useState(false);
  const after = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (acted && status !== "pending") after.current?.focus();
  }, [acted, status]);

  return (
    <section className="ag-proposal" data-testid="query-change-proposal" data-status={status} aria-labelledby={titleId}>
      <h3 id={titleId} className="ag-proposal-title">
        {c.proposalTitle}
      </h3>
      <p className="ag-proposal-reason">
        <span>{c.proposalReason}</span> {proposal.reason}
      </p>
      {proposal.base === null ? <p className="ag-proposal-note">{c.proposalNoBase}</p> : null}
      {proposal.base === null && before !== null ? <p className="ag-proposal-note">{c.comparedWithShown}</p> : null}
      <dl className="ag-proposal-diff">
        {fields.map((field) => (
          <div key={field} className="ag-proposal-row">
            <dt>{fieldLabel(field, locale, c)}</dt>
            {before !== null ? (
              <>
                <dd className="ag-proposal-old">
                  <span className="ag-proposal-tag">{c.original}</span>
                  <span>{fieldValue(field, before, locale, c)}</span>
                </dd>
                <dd className="ag-proposal-new">
                  <span className="ag-proposal-tag">{c.proposed}</span>
                  <span>{fieldValue(field, proposal.proposed, locale, c)}</span>
                </dd>
              </>
            ) : (
              // Nothing to compare with: the proposed values, not marked as changes.
              <dd className="ag-proposal-plain">{fieldValue(field, proposal.proposed, locale, c)}</dd>
            )}
          </div>
        ))}
      </dl>
      {/* Always in the tree, so what happened to the proposal is announced. */}
      <div role="status" className="ag-proposal-status">
        {status === "stale" ? <p className="ag-proposal-note">{copy("ai.stale", locale)}</p> : null}
        {status === "applied" ? (
          <p>
            {c.proposalApplied}{" "}
            <Link to="/" replace state={{ focus: "search-title" }} className="ag-button ag-proposal-view" ref={(el) => void (after.current = el)}>
              {c.viewResults}
            </Link>
          </p>
        ) : null}
        {status === "dismissed" ? (
          <p tabIndex={-1} ref={(el) => void (after.current = el)}>
            {c.proposalKept}
          </p>
        ) : null}
      </div>
      {status === "pending" ? <p className="ag-proposal-note">{c.applyNote}</p> : null}
      {status === "pending" || status === "stale" ? (
        <div className="ag-proposal-actions">
          <button
            type="button"
            className="ag-button ag-button-primary ag-proposal-apply"
            disabled={status !== "pending"}
            onClick={() => {
              setActed(true);
              onApply();
            }}
          >
            {copy("ai.apply", locale)}
          </button>
          <button
            type="button"
            className="ag-button"
            onClick={() => {
              setActed(true);
              onKeep();
            }}
          >
            {copy("ai.keep", locale)}
          </button>
        </div>
      ) : null}
    </section>
  );
}
