"use client";

/**
 * Parse failure, inline under the query bar (spec §3.7, docs/UI_PLAN.md §6.2): one sentence per
 * thing the parser could not read, and a way forward — "Build it with chips instead" opens the
 * eight chips in manual mode with the first editor already open. Never a modal, never an apology.
 *
 * The raw text is not echoed here: it stays in the query bar directly above ("the raw text
 * preserved in the bar", §6.2), so repeating it would put the same sentence on screen twice.
 */
import { useT } from "@awardgrid/core/i18n/client";
import type { ApiFailure } from "@/components/grid/api";
import type { I18nKey } from "@awardgrid/core/i18n";

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
  /**
   * UI/UX v1 T20: when the server could let the language model read the text (`llm_offer`), this asks it to, as the
   * person's own action. The note before it says the text goes to Anthropic; nothing is sent until it is pressed.
   */
  onUseAi?: () => void;
}

export function ParseFailure({ failure, onBuildWithChips, onUseAi }: ParseFailureProps) {
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
      {failure.llm_offer && onUseAi ? (
        <>
          <p className="t-meta text-fg-muted" id="parse-ai-note">
            {t("grid.parse_failure.ai_note")}
          </p>
          <button type="button" onClick={onUseAi} data-testid="parse-with-ai" aria-describedby="parse-ai-note" className="link text-body">
            {t("grid.parse_failure.ai")}
          </button>
        </>
      ) : null}
    </div>
  );
}
