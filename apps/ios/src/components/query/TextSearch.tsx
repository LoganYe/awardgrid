/**
 * Search by typing (docs/04 S02: "自由文字可作为另一入口解析，但不自动请求LLM"): one sentence, read by the deterministic
 * parser only — no AI — and run as a workspace revision when the person presses Run. Used on the empty Search screen
 * and at the top of the query editor. Examples, in the screen's language, fill the box; they never run by themselves.
 *
 * The trip planner (release plan step 18) uses the same box with its own words (`words`): there the button reads the
 * text as a plan and runs nothing, so it is not the search's Run, and its test id says so.
 */
import { useEffect, useRef, useState } from "react";
import type { Locale } from "../../app/locale";
import { Button, Chip } from "../ui";
import { EDITOR_COPY } from "./labels";

export interface TextSearchProps {
  /** A search is being prepared or is running: Run is busy. */
  busy: boolean;
  onSearch: (text: string) => void;
  /** What the box starts with; the first example when not given. */
  initial?: string;
  /** An error about the text itself (a parse failure), shown under the box. */
  error?: string | null;
  /** The language of `error` when it is not the screen's (the parser's messages are English). */
  errorLang?: string;
  /** Whether Run is the screen's one filled action (spec §10: one primary per screen). */
  primary?: boolean;
  locale?: Locale;
  /** The box's label and its button's words, in place of the search's (the planner's). */
  words?: { label: string; run: string; running: string };
  /** The button's test id; "text-search-run" is the search's Run. */
  runTestId?: string;
}

export function TextSearch({ busy, onSearch, initial, error, errorLang, primary = true, locale = "en", words, runTestId = "text-search-run" }: TextSearchProps) {
  const t = { ...EDITOR_COPY[locale].text, ...words };
  const [text, setText] = useState(initial ?? t.examples[0]!);
  const box = useRef<HTMLTextAreaElement>(null);
  // A text that could not be read: focus goes back to the box, whose description now carries the error.
  useEffect(() => {
    if (error) box.current?.focus();
  }, [error]);
  return (
    <div className="ag-field ag-text-search">
      <label htmlFor="q" className="ag-field-label">
        {t.label}
      </label>
      <textarea
        ref={box}
        id="q"
        className="ag-input"
        rows={2}
        value={text}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "q-error" : undefined}
        onChange={(e) => setText(e.target.value)}
      />
      {error ? (
        <p id="q-error" role="alert" className="ag-field-error" lang={errorLang}>
          {error}
        </p>
      ) : null}
      <div className="ag-text-search-actions">
        <Button variant={primary ? "primary" : "secondary"} data-testid={runTestId} onClick={() => onSearch(text)} loading={busy} loadingLabel={t.running}>
          {t.run}
        </Button>
      </div>
      <div className="ag-chip-row" role="group" aria-label={t.examplesLabel}>
        {t.examples.map((e) => (
          <Chip key={e} variant="filter" onClick={() => setText(e)}>
            {e}
          </Chip>
        ))}
      </div>
    </div>
  );
}
