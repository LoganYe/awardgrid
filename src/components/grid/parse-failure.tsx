"use client";

/**
 * Parse failure, inline under the query bar (spec §3.7, docs/UI_PLAN.md §6.2): one sentence per
 * thing the parser could not read, and a way forward — "Build it with chips instead" opens the
 * seven chips in manual mode with the first editor already open. Never a modal, never an apology.
 *
 * The raw text is not echoed here: it stays in the query bar directly above ("the raw text
 * preserved in the bar", §6.2), so repeating it would put the same sentence on screen twice.
 */
import { useT } from "@/lib/i18n/client";
import type { ApiFailure } from "@/components/grid/api";
import type { I18nKey } from "@/lib/i18n";

/** `missing` field names from /api/parse → one sentence each, deduped (both date bounds are "the dates"). */
export function missingSentenceKeys(missing: readonly string[] | undefined): I18nKey[] {
  const keys: I18nKey[] = [];
  const push = (key: I18nKey) => {
    if (!keys.includes(key)) keys.push(key);
  };
  for (const field of missing ?? []) {
    if (field === "origins") push("grid.parse_failure.origins");
    else if (field === "destinations") push("grid.parse_failure.destinations");
    else if (field === "date_from" || field === "date_to" || field === "dates") push("grid.parse_failure.dates");
  }
  if (keys.length === 0) keys.push("grid.parse_failure.generic");
  return keys;
}

export interface ParseFailureProps {
  failure: ApiFailure;
  onBuildWithChips: () => void;
}

export function ParseFailure({ failure, onBuildWithChips }: ParseFailureProps) {
  const t = useT();
  const keys = missingSentenceKeys(failure.missing);
  return (
    <div className="flex flex-col items-start gap-1.5" data-testid="parse-failure" role="status">
      {keys.map((key) => (
        <p key={key} className="text-body text-error">
          {t(key)}
        </p>
      ))}
      <button type="button" onClick={onBuildWithChips} data-testid="build-with-chips" className="link text-body">
        {t("grid.parse_failure.build")}
      </button>
    </div>
  );
}
