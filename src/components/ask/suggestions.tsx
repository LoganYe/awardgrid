"use client";

/**
 * The three suggested questions (spec §3.6). Clicking one fills the input rather than sending,
 * so the user can edit it first and still sees exactly what will be asked.
 */
import type { I18nKey } from "@awardgrid/core/i18n";
import { useT } from "@awardgrid/core/i18n/client";

export const ASK_SUGGESTION_KEYS: readonly I18nKey[] = ["ask.suggestion.cheapest_program", "ask.suggestion.good_price", "ask.suggestion.combine_trip"];

export interface SuggestionsProps {
  onPick: (question: string) => void;
  disabled?: boolean;
}

export function Suggestions({ onPick, disabled }: SuggestionsProps) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1" data-testid="ask-suggestions">
      <p className="t-meta text-fg-muted">{t("ask.suggestions_label")}</p>
      {ASK_SUGGESTION_KEYS.map((key) => {
        const question = t(key);
        return (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => onPick(question)}
            className="t-body rounded-[var(--radius-control)] border border-line bg-bg-raised px-2 py-1.5 text-left text-fg disabled:text-fg-muted"
          >
            {question}
          </button>
        );
      })}
    </div>
  );
}
