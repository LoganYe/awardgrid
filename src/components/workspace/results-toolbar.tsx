"use client";
/**
 * The conditions and view toolbar under the query (UI/UX v1 T19; docs/04 S10 "toolbar min48"; spec §17).
 *
 *   - Left: the query's other hard conditions — programs, stops, cabin mix, mileage cap. They edit the same draft as
 *     the query bar, so a change is marked "changed" there and runs only from Find: a hard condition never changes the
 *     results on its own (D08).
 *   - Right: the result view (list, calendar, matrix) and the sort. These are local: they reorder or redraw the one
 *     snapshot on screen and send nothing.
 */
import { useRef } from "react";
import { useLocale, useT } from "@awardgrid/core/i18n/client";
import type { QueryObject } from "@awardgrid/core/query/schema";
import { SEATS_SOURCES } from "@awardgrid/core/seatsaero/types";
import { programLabel, sortLabel } from "@awardgrid/core/workspace/present";
import type { QueryDraft } from "@awardgrid/core/workspace/query-editor";
import type { WorkspaceView } from "./prefs";
import { MAX_MILES_INPUT_ID } from "./query-bar";
import type { QueryError } from "./query-draft";

const MIXED: readonly number[] = [100, 75, 50, 0];
const SORTS: readonly QueryObject["sort_by"][] = ["miles_asc", "fees_asc", "seats_desc", "date_asc"];

export interface ResultsToolbarProps {
  draft: QueryDraft;
  view: WorkspaceView;
  sort: QueryObject["sort_by"];
  disabled: boolean;
  /** The mileage cap's error from the last Find, if any (the rest are the query bar's). */
  milesError: QueryError | null;
  onDraft: (draft: QueryDraft) => void;
  onView: (view: WorkspaceView) => void;
  onSort: (sort: QueryObject["sort_by"]) => void;
}

export function ResultsToolbar({ draft, view, sort, disabled, milesError, onDraft, onView, onSort }: ResultsToolbarProps) {
  const t = useT();
  const programsRef = useRef<HTMLDetailsElement>(null);
  const locale = useLocale();
  const q = draft.query;
  const set = (patch: Partial<QueryObject>) => onDraft({ ...draft, query: { ...q, ...patch } });
  const programs = q.programs ?? [];
  const mixedLabel = (pct: number) => (pct === 100 ? t("workspace.mixed_100") : pct === 0 ? t("workspace.mixed_0") : t("workspace.mixed_pct", { pct: String(pct) }));
  const mixedOptions = MIXED.includes(q.min_cabin_pct) ? MIXED : [...MIXED, q.min_cabin_pct];

  return (
    <div className="ag-ws-toolbar">
      <div className="ag-ws-conditions">
        <details
          ref={programsRef}
          className="ag-ws-programs"
          onKeyDown={(e) => {
            // The popover is the top-most layer: Esc closes it, not a panel behind it (T19 review LAY-9).
            if (e.key !== "Escape" || e.nativeEvent.isComposing || e.keyCode === 229 || !programsRef.current?.open) return;
            e.preventDefault();
            programsRef.current.open = false;
            programsRef.current.querySelector("summary")?.focus();
          }}
          onBlur={(e) => {
            // Leaving it (a click or Tab elsewhere) closes it, as a popover does.
            if (programsRef.current && !programsRef.current.contains(e.relatedTarget as Node | null)) programsRef.current.open = false;
          }}
        >
          <summary className="ag-ws-select-like">
            <span className="sr-only">{t("workspace.programs")}: </span>
            {programs.length === 0 ? t("workspace.programs_all") : t("workspace.programs_some", { count: String(programs.length) })}
          </summary>
          <fieldset className="ag-ws-programs-list" disabled={disabled}>
            <legend className="sr-only">{t("workspace.programs")}</legend>
            <label className="ag-ws-check">
              <input type="checkbox" checked={programs.length === 0} onChange={() => set({ programs: undefined })} />
              <span>{t("workspace.programs_all")}</span>
            </label>
            {SEATS_SOURCES.map((code) => (
              <label key={code} className="ag-ws-check">
                <input
                  type="checkbox"
                  checked={programs.includes(code)}
                  onChange={(e) => {
                    const next = e.target.checked ? [...programs, code] : programs.filter((p) => p !== code);
                    // An empty list would filter every row out while meaning "all"; no list is what "All programs" is.
                    set({ programs: next.length > 0 ? next : undefined });
                  }}
                />
                <span>{programLabel(code)}</span>
              </label>
            ))}
          </fieldset>
        </details>
        <label className="ag-ws-select-wrap">
          <span className="sr-only">{t("workspace.stops")}</span>
          <select className="ag-ws-select" value={q.direct_only ? "nonstop" : "any"} onChange={(e) => set({ direct_only: e.target.value === "nonstop" })} disabled={disabled}>
            <option value="any">{t("workspace.stops_any")}</option>
            <option value="nonstop">{t("workspace.stops_nonstop")}</option>
          </select>
        </label>
        <label className="ag-ws-select-wrap">
          <span className="sr-only">{t("workspace.mixed")}</span>
          <select className="ag-ws-select" value={String(q.min_cabin_pct)} onChange={(e) => set({ min_cabin_pct: Number(e.target.value) })} disabled={disabled}>
            {mixedOptions.map((pct) => (
              <option key={pct} value={String(pct)}>
                {mixedLabel(pct)}
              </option>
            ))}
          </select>
        </label>
        <label className="ag-ws-check ag-ws-check-inline">
          <input type="checkbox" checked={q.include_filtered} onChange={(e) => set({ include_filtered: e.target.checked })} disabled={disabled} />
          <span>{t("workspace.include_filtered")}</span>
        </label>
        <label className="ag-ws-select-wrap ag-ws-miles" htmlFor={MAX_MILES_INPUT_ID}>
          <span className="ag-ws-inline-label">{t("workspace.max_miles")}</span>
          <input
            id={MAX_MILES_INPUT_ID}
            aria-invalid={milesError ? true : undefined}
            aria-describedby={milesError ? `${MAX_MILES_INPUT_ID}-error` : undefined}
            className="ag-ws-input ag-ws-input-miles"
            inputMode="numeric"
            placeholder={t("workspace.max_miles_none")}
            value={q.max_miles === undefined ? "" : String(q.max_miles)}
            onChange={(e) => {
              // Digits only (a pasted "80,000" reads as 80000); core's validation names 0 at Find.
              const raw = e.target.value.replace(/\D/g, "");
              set({ max_miles: raw === "" ? undefined : Number(raw) });
            }}
            disabled={disabled}
          />
        </label>
        {milesError ? (
          <p id={`${MAX_MILES_INPUT_ID}-error`} className="ag-ws-field-error">
            {t(milesError.key as never)}
          </p>
        ) : null}
      </div>
      <div className="ag-ws-view-controls">
        <div className="ag-ws-segmented" role="group" aria-label={t("workspace.view")}>
          {(["list", "calendar", "matrix"] as const).map((kind) => (
            <button key={kind} type="button" aria-pressed={view === kind} className="ag-ws-segment" onClick={() => onView(kind)} data-view={kind}>
              {t(`workspace.view_${kind}`)}
            </button>
          ))}
        </div>
        <label className="ag-ws-select-wrap">
          <span className="sr-only">{t("workspace.sort")}</span>
          <select className="ag-ws-select" value={sort} onChange={(e) => onSort(e.target.value as QueryObject["sort_by"])}>
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {sortLabel(s, locale)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
