/**
 * The query summary (UI/UX v1 T07; docs/04 S01): the shown snapshot's query — not a draft's — in two lines, route
 * then dates, cabins and the conditions that narrow it; a 64 pt link that opens the editor on it. While a search is
 * running it is not a link and says why (T06: the editor would otherwise show the previous query and supersede the
 * run in flight).
 */
import type { QueryObject } from "@awardgrid/core/query/schema";
import { querySubline, routeLabel } from "@awardgrid/core/workspace/present";
import { Link } from "react-router";
import type { Locale } from "../../app/locale";
import { Icon } from "../ui";
import { RESULTS } from "./copy";

export function QuerySummary({ query, locale, id, waitNote }: { query: QueryObject; locale: Locale; id?: string; waitNote?: string | null }) {
  const route = routeLabel(query, locale);
  const subline = querySubline(query, locale);
  if (waitNote) {
    return (
      <div className="ag-query-summary" data-testid="query-summary">
        {/* Keeps the return-focus id, so focus coming back from the editor mid-run lands here, not on <body>. */}
        <div id={id} tabIndex={-1} className="ag-query-summary-link" aria-describedby="query-summary-wait">
          <span className="ag-query-summary-text">
            <span className="ag-query-summary-route">{route}</span>
            <span className="ag-query-summary-sub">{subline}</span>
            <span id="query-summary-wait" className="ag-query-summary-sub">
              {waitNote}
            </span>
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className="ag-query-summary" data-testid="query-summary">
      <Link id={id} to="/edit" className="ag-query-summary-link" aria-label={`${RESULTS[locale].editSearch}: ${route}, ${subline}`}>
        <span className="ag-query-summary-text">
          <span className="ag-query-summary-route">{route}</span>
          <span className="ag-query-summary-sub">{subline}</span>
        </span>
        <Icon name="chevron-down" />
      </Link>
    </div>
  );
}
