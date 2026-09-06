"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/lib/i18n/client";

/** Bilingual examples; clicking one fills the box and submits. */
export const QUERY_EXAMPLES: readonly string[] = [
  "香港、上海、东京、首尔到西雅图，未来一个月最便宜的头等舱",
  "SFO or LAX to Tokyo, business, next 30 days, direct only",
  "台北到伦敦 十一月 商务舱 8万英里以内",
];

export interface QueryBoxProps {
  initialText?: string;
  busy: boolean;
  llmAvailable: boolean;
  onSubmit: (text: string) => void;
  /** Running is off (the seats.aero daily limit, spec §3.7): Run and Enter do nothing, the reason sits in the title. */
  disabled?: boolean;
  disabledTitle?: string;
}

/** Natural-language query box: Enter submits (Shift+Enter inserts a newline). */
export function QueryBox({ initialText = "", busy, llmAvailable, onSubmit, disabled = false, disabledTitle }: QueryBoxProps) {
  const t = useT();
  const [text, setText] = useState(initialText);

  function submit(value: string) {
    const trimmed = value.trim();
    if (trimmed.length === 0 || busy || disabled) return;
    onSubmit(trimmed);
  }

  function onFormSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    submit(text);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit(text);
    }
  }

  return (
    <form onSubmit={onFormSubmit} className="flex flex-col gap-2" aria-label={t("grid.search")}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <Textarea
          name="q"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("grid.query_placeholder")}
          rows={2}
          autoComplete="off"
          spellCheck={false}
          className="min-h-14 flex-1 resize-y text-base sm:text-sm"
          aria-label={t("grid.search")}
        />
        <span title={disabled ? disabledTitle : undefined} className="sm:inline-flex">
          <Button type="submit" disabled={busy || disabled || text.trim().length === 0} className="w-full sm:h-14 sm:px-4">
            {busy ? t("grid.parsing") : t("grid.search")}
          </Button>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>{t("grid.examples")}:</span>
        {QUERY_EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            disabled={busy || disabled}
            onClick={() => {
              setText(ex);
              submit(ex);
            }}
            className="rounded border border-border px-1.5 py-0.5 text-left hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            {ex}
          </button>
        ))}
        {!llmAvailable && <span className="basis-full text-muted-foreground">{t("grid.llm_off")}</span>}
      </div>
    </form>
  );
}
