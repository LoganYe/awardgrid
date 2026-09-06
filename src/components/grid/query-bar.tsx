"use client";

/**
 * The query bar (spec §3.1, docs/UI_PLAN.md §6.2): one field that accepts Chinese and English,
 * grows from one line to three and then scrolls. Enter runs, Shift+Enter inserts a newline, and
 * a "Run" button does the same for touch. "Examples" opens the three-row popover that fills the
 * bar without running. Under the bar, once a query has been parsed, the raw text stays visible
 * as "Parsed from: …" so the chips can always be traced back to what the user typed.
 *
 * The IME guard matters: in Chinese, Enter also confirms a candidate, so a composing Enter must
 * never submit.
 */
import { useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/lib/i18n/client";
import { ExamplesPopover } from "@/components/grid/examples-popover";

/** One line of 20 px plus 8 px padding top and bottom. */
const LINE_HEIGHT = 20;
const PADDING = 16;
const MIN_HEIGHT = LINE_HEIGHT + PADDING;
const MAX_HEIGHT = LINE_HEIGHT * 3 + PADDING;

export interface QueryBarProps {
  value: string;
  onValueChange: (text: string) => void;
  /** Enter or the Run button, with the trimmed text. */
  onRun: (text: string) => void;
  busy: boolean;
  /** Running is off (the seats.aero daily limit): Enter and Run do nothing, the reason is in the title. */
  disabled?: boolean;
  disabledTitle?: string;
  /** The raw text the current chips were parsed from, or null before the first parse. */
  parsedFrom?: string | null;
  /** True when the language model filled a field the deterministic parser could not read. */
  guessed?: boolean;
  /** False when the server has no language model: the note tells the user to be explicit. */
  llmAvailable?: boolean;
}

export function QueryBar({ value, onValueChange, onRun, busy, disabled = false, disabledTitle, parsedFrom = null, guessed = false, llmAvailable = true }: QueryBarProps) {
  const t = useT();
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow with the content, up to three lines; after that the field scrolls.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, MIN_HEIGHT), MAX_HEIGHT)}px`;
  }, [value]);

  function run() {
    const text = value.trim();
    if (text.length === 0 || busy || disabled) return;
    onRun(text);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      run();
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
        className="flex items-start gap-2"
      >
        <Textarea
          ref={ref}
          name="q"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("grid.query_placeholder")}
          rows={1}
          autoComplete="off"
          spellCheck={false}
          aria-label={t("grid.search")}
          style={{ height: MIN_HEIGHT }}
          className="min-h-9 flex-1 resize-none overflow-y-auto py-2 leading-5 [field-sizing:fixed]"
        />
        <span title={disabled ? disabledTitle : undefined}>
          <Button type="submit" disabled={busy || disabled || value.trim().length === 0} data-testid="query-run">
            {busy ? t("grid.parsing") : t("grid.run")}
          </Button>
        </span>
        <ExamplesPopover disabled={busy || disabled} onPick={(text) => onValueChange(text)} />
      </form>

      {parsedFrom && (
        <p className="text-grid text-fg-muted" data-testid="parsed-from">
          {t("grid.parsed_from")} {parsedFrom}
          {guessed && <span className="ml-2 t-meta">{t("grid.provenance.llm")}</span>}
        </p>
      )}
      {!llmAvailable && <p className="t-meta text-fg-muted">{t("grid.llm_off")}</p>}
    </div>
  );
}
