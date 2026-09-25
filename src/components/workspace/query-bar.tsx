"use client";
/**
 * The workspace's top query (UI/UX v1 T19; docs/04 S10 "Topquery min72"; spec §17): departure and arrival airports,
 * the departure dates and the cabins, then Find. Typing edits the draft only. A search runs from Find, or
 * Cmd/Ctrl+Enter inside this form, and nowhere else, so a hard condition never changes without that confirmation.
 * A changed draft says so, with "Discard changes". Each broken field names itself and the first one takes focus.
 */
import { forwardRef, useId, useImperativeHandle, useRef, type FormEvent } from "react";
import { useLocale, useT } from "@awardgrid/core/i18n/client";
import type { Cabin } from "@awardgrid/core/query/schema";
import { copy } from "@awardgrid/core/workspace/present";
import { cabinName, type QueryDraft } from "@awardgrid/core/workspace/query-editor";
import { codesFromText, type DraftTexts, type QueryError } from "./query-draft";

/** The conditions toolbar's mileage-cap input: the one field of the draft outside this form. */
export const MAX_MILES_INPUT_ID = "ag-ws-max-miles";

const CABINS: readonly Cabin[] = ["Y", "W", "J", "F"];

export interface QueryBarHandle {
  /** Focus the first field (the "/" shortcut and the palette's "Focus the query"). */
  focus(): void;
  /** Focus the field an error names. */
  focusField(field: QueryError["field"]): void;
  /** Whether an element is inside the form (Cmd/Ctrl+Enter runs only from here). */
  contains(target: EventTarget | null): boolean;
}

export interface QueryBarProps {
  draft: QueryDraft;
  texts: DraftTexts;
  errors: readonly QueryError[];
  modified: boolean;
  running: boolean;
  disabled: boolean;
  /** The Find hint (⌘↵ / Ctrl+Enter), or null while shortcuts are off. */
  submitHint: string | null;
  onTexts: (texts: DraftTexts, draft: QueryDraft) => void;
  onDraft: (draft: QueryDraft) => void;
  onSubmit: () => void;
  onDiscard: () => void;
}

export const QueryBar = forwardRef<QueryBarHandle, QueryBarProps>(function QueryBar(
  { draft, texts, errors, modified, running, disabled, submitHint, onTexts, onDraft, onSubmit, onDiscard },
  ref,
) {
  const t = useT();
  const locale = useLocale();
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const fieldId = (field: QueryError["field"]) => `${id}-${field}`;
  const errorFor = (field: QueryError["field"]) => errors.find((e) => e.field === field);

  useImperativeHandle(ref, () => ({
    focus: () => document.getElementById(fieldId("origins"))?.focus(),
    // The mileage cap lives in the conditions toolbar (results-toolbar.tsx), under its own stable id.
    focusField: (field) => document.getElementById(field === "max_miles" ? MAX_MILES_INPUT_ID : fieldId(field))?.focus(),
    contains: (target) => !!target && !!form.current?.contains(target as Node),
  }));

  const setText = (field: "origins" | "destinations", value: string) => {
    const next = { ...texts, [field]: value };
    onTexts(next, { ...draft, query: { ...draft.query, [field]: codesFromText(value).codes } });
  };
  const setDate = (edge: "from" | "to", value: string) => {
    const from = edge === "from" ? value : draft.query.date_from;
    const to = edge === "to" ? value : draft.query.date_to;
    onDraft({ query: { ...draft.query, date_from: from, date_to: to }, dates: { kind: "fixed", from, to } });
  };
  const toggleCabin = (cabin: Cabin, on: boolean) => {
    const cabins = on ? CABINS.filter((c) => c === cabin || draft.query.cabins.includes(c)) : draft.query.cabins.filter((c) => c !== cabin);
    onDraft({ ...draft, query: { ...draft.query, cabins } });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };

  const message = (error: QueryError | undefined) => (error ? t(error.key as never, error.vars as never) : null);
  const describedBy = (field: QueryError["field"], hint?: string) => [errorFor(field) ? `${fieldId(field)}-error` : null, hint ?? null].filter(Boolean).join(" ") || undefined;
  const codesHint = `${id}-codes-hint`;

  return (
    <form ref={form} className="ag-ws-query" role="search" aria-label={t("workspace.q.label")} onSubmit={submit} data-testid="query-summary" noValidate>
      <div className="ag-ws-query-fields">
        {(["origins", "destinations"] as const).map((field, index) => (
          <div key={field} className="ag-ws-field" data-field={field}>
            {index === 1 ? (
              <span className="ag-ws-field-arrow" aria-hidden>
                →
              </span>
            ) : null}
            <label htmlFor={fieldId(field)} className="ag-ws-field-label">
              {t(`workspace.q.${field}`)}
            </label>
            <input
              id={fieldId(field)}
              className="ag-ws-input ag-ws-input-codes"
              value={texts[field]}
              onChange={(e) => setText(field, e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-invalid={errorFor(field) ? true : undefined}
              aria-describedby={describedBy(field, codesHint)}
              disabled={disabled}
            />
            {errorFor(field) ? (
              <p id={`${fieldId(field)}-error`} className="ag-ws-field-error">
                {message(errorFor(field))}
              </p>
            ) : null}
            {codesFromText(texts[field]).expanded.map((e) => (
              <p key={e.code} className="ag-ws-hint" data-testid={`expands-${field}`}>
                {t("workspace.q.expands", { code: e.code, airports: e.airports.join(locale === "zh" ? "、" : ", ") })}
              </p>
            ))}
          </div>
        ))}
        <fieldset className="ag-ws-field ag-ws-field-dates" data-field="dates" aria-describedby={describedBy("dates")}>
          <legend className="ag-ws-field-label">{t("workspace.q.dates")}</legend>
          <div className="ag-ws-dates">
            <input
              id={fieldId("dates")}
              type="date"
              className="ag-ws-input"
              value={draft.query.date_from}
              onChange={(e) => setDate("from", e.target.value)}
              aria-label={t("workspace.q.date_from")}
              aria-invalid={errorFor("dates") ? true : undefined}
              disabled={disabled}
            />
            <span aria-hidden>–</span>
            <input
              type="date"
              className="ag-ws-input"
              value={draft.query.date_to}
              onChange={(e) => setDate("to", e.target.value)}
              aria-label={t("workspace.q.date_to")}
              aria-invalid={errorFor("dates") ? true : undefined}
              disabled={disabled}
            />
          </div>
          {errorFor("dates") ? (
            <p id={`${fieldId("dates")}-error`} className="ag-ws-field-error">
              {message(errorFor("dates"))}
            </p>
          ) : null}
        </fieldset>
        <fieldset className="ag-ws-field ag-ws-field-cabins" data-field="cabins" aria-describedby={describedBy("cabins")}>
          <legend className="ag-ws-field-label">{t("workspace.q.cabins")}</legend>
          <div className="ag-ws-cabins">
            {CABINS.map((cabin, index) => (
              <label key={cabin} className="ag-ws-toggle">
                <input
                  id={index === 0 ? fieldId("cabins") : undefined}
                  type="checkbox"
                  checked={draft.query.cabins.includes(cabin)}
                  onChange={(e) => toggleCabin(cabin, e.target.checked)}
                  disabled={disabled}
                />
                <span>{cabinName(cabin, locale)}</span>
              </label>
            ))}
          </div>
          {errorFor("cabins") ? (
            <p id={`${fieldId("cabins")}-error`} className="ag-ws-field-error">
              {message(errorFor("cabins"))}
            </p>
          ) : null}
        </fieldset>
        <div className="ag-ws-query-submit">
          <button type="submit" className="ag-ws-button ag-ws-button-primary" disabled={disabled || running} aria-keyshortcuts={submitHint ? "Meta+Enter Control+Enter" : undefined}>
            {copy("query.submit", locale)}
          </button>
          {submitHint ? (
            <kbd className="ag-ws-kbd" aria-hidden>
              {submitHint}
            </kbd>
          ) : null}
        </div>
      </div>
      <p id={codesHint} className="ag-ws-hint">
        {t("workspace.q.codes_hint")}
      </p>
      {modified ? (
        <div className="ag-ws-modified" role="status">
          <span>{t("workspace.q.modified")}</span>
          <button type="button" className="ag-ws-button ag-ws-button-quiet" onClick={onDiscard} disabled={disabled}>
            {copy("query.discard", locale)}
          </button>
        </div>
      ) : null}
    </form>
  );
});
