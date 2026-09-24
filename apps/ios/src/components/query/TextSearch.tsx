/**
 * Search by typing (docs/04 S02: "自由文字可作为另一入口解析，但不自动请求LLM"): one sentence, read by the deterministic
 * parser only — no AI — and run as a workspace revision when the person presses Run. Used on the empty Search screen
 * and at the top of the query editor. Examples fill the box; they never run by themselves.
 */
import { useEffect, useRef, useState } from "react";
import { Button, Chip } from "../ui";

export const EXAMPLES = [
  "HKG, SHA to SEA, next 30 days, business and first",
  "SFO to NRT next 60 days business",
  "LHR to JFK, next 2 weeks, first",
] as const;

export interface TextSearchProps {
  /** A search is being prepared or is running: Run is busy. */
  busy: boolean;
  /** No key: Run cannot be used (the screen says why). */
  disabled?: boolean;
  onSearch: (text: string) => void;
  initial?: string;
  /** An error about the text itself (a parse failure), shown under the box. */
  error?: string | null;
  /** Whether Run is the screen's one filled action (spec §10: one primary per screen). */
  primary?: boolean;
  /** The language this box's own words are in, when it differs from the screen's (English until T11). */
  lang?: string;
}

export function TextSearch({ busy, disabled = false, onSearch, initial = EXAMPLES[0], error, primary = true, lang }: TextSearchProps) {
  const [text, setText] = useState(initial);
  const box = useRef<HTMLTextAreaElement>(null);
  // A text that could not be read: focus goes back to the box, whose description now carries the error.
  useEffect(() => {
    if (error) box.current?.focus();
  }, [error]);
  return (
    <div className="ag-field ag-text-search" lang={lang}>
      <label htmlFor="q" className="ag-field-label">
        Search by typing
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
        <p id="q-error" role="alert" className="ag-field-error">
          {error}
        </p>
      ) : null}
      <div className="ag-text-search-actions">
        <Button variant={primary ? "primary" : "secondary"} onClick={() => onSearch(text)} disabled={disabled} loading={busy} loadingLabel="Searching">
          Run
        </Button>
      </div>
      <div className="ag-chip-row" role="group" aria-label="Examples">
        {EXAMPLES.map((e) => (
          <Chip key={e} variant="filter" onClick={() => setText(e)}>
            {e}
          </Chip>
        ))}
      </div>
    </div>
  );
}
