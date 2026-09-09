"use client";

/**
 * The eight parsed chips (spec §3.2, docs/UI_PLAN.md §6.2a) — Origins, Destinations, Dates,
 * Cabins, Programs, Direct only, Mixed cabin, Sort, always in that order, wrapping on narrow
 * widths.
 *
 * Each chip is a button carrying its label and value summary; clicking (or Enter / Space) opens
 * its editor popover anchored to the chip, Esc closes it and returns focus to the chip. Editing
 * marks the query MODIFIED: the edited chip takes the accent outline, "Reset to parsed" and
 * "Run" appear at the end of the row, and the page dims the grid until the query is re-run.
 * Chips are the single source of truth for the grid; nothing here talks to the API.
 *
 * Errors are inline: an errored chip turns --error, takes aria-invalid, and points with
 * aria-describedby at its own message under the row — one line per errored chip, in chip order,
 * so nothing is carried by color alone. The 92-day cap is a note, not an error, and never
 * blocks the run.
 */
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { useLocale, useT } from "@awardgrid/core/i18n/client";
import type { QueryObject } from "@awardgrid/core/query/schema";
import { CabinsEditor } from "@/components/grid/chip-editors/cabins-editor";
import { ChipPopover, type ChipState } from "@/components/grid/chip-editors/chip-popover";
import { DatesEditor } from "@/components/grid/chip-editors/dates-editor";
import { DirectEditor } from "@/components/grid/chip-editors/direct-editor";
import { MixedCabinEditor } from "@/components/grid/chip-editors/mixed-cabin-editor";
import { PlacesEditor } from "@/components/grid/chip-editors/places-editor";
import { ProgramsEditor } from "@/components/grid/chip-editors/programs-editor";
import { SortEditor } from "@/components/grid/chip-editors/sort-editor";
import { CHIP_ORDER, chipAriaLabel, chipLabel, chipSummary, modifiedChips, validateQuery, type ChipId } from "@/components/grid/chips-model";

export interface ChipRowProps {
  query: QueryObject;
  /** The parser's output: the accent outline and "Reset to parsed" compare against it. */
  parsed: QueryObject | null;
  /** The draft differs from the query the grid on screen was produced from. */
  modified: boolean;
  /** Today in the browser's calendar; the calendar's first selectable day. */
  today: string;
  disabled?: boolean;
  /**
   * The chip whose editor is open, or null. Controlled by the page, so "Build it with chips
   * instead" can open Origins whether or not the row was already on screen.
   */
  open?: ChipId | null;
  onOpenChange?: (chip: ChipId | null) => void;
  /** False in manual mode, where there is no parser output to go back to. */
  canReset?: boolean;
  onChange: (next: QueryObject) => void;
  onRun: () => void;
  onReset: () => void;
}

export function ChipRow({ query, parsed, modified, today, disabled = false, open = null, onOpenChange, canReset, onChange, onRun, onReset }: ChipRowProps) {
  const t = useT();
  const locale = useLocale();
  const uid = useId();

  const ctx = { locale, t };
  const changed = modifiedChips(query, parsed);
  const validation = validateQuery(query, t);
  // Every errored chip gets its own line, in chip order, and its own id: three empty chips are
  // three messages, not one, and each chip points at its own (spec §1.3, §8).
  const messages = CHIP_ORDER.flatMap((chip) => {
    const text = validation.errors[chip];
    return text === undefined ? [] : [{ chip, text, id: `${uid}-${chip}-error` }];
  });
  const errorId = (chip: ChipId) => messages.find((m) => m.chip === chip)?.id;
  const setOpen = (chip: ChipId | null) => onOpenChange?.(chip);

  function editorFor(chip: ChipId) {
    switch (chip) {
      case "origins":
        return <PlacesEditor codes={query.origins} label={t("grid.chips.origins")} onChange={(origins) => onChange({ ...query, origins })} />;
      case "destinations":
        return <PlacesEditor codes={query.destinations} label={t("grid.chips.destinations")} onChange={(destinations) => onChange({ ...query, destinations })} />;
      case "dates":
        return <DatesEditor dateFrom={query.date_from} dateTo={query.date_to} today={today} onChange={(range) => onChange({ ...query, ...range })} />;
      case "cabins":
        return <CabinsEditor cabins={query.cabins} onChange={(cabins) => onChange({ ...query, cabins })} />;
      case "programs":
        return (
          <ProgramsEditor
            programs={query.programs ?? []}
            onChange={(programs) => {
              const next = { ...query };
              if (programs === null || programs.length === 0) delete next.programs;
              else next.programs = programs;
              onChange(next);
            }}
          />
        );
      case "direct_only":
        return <DirectEditor value={query.direct_only} onChange={(value) => onChange({ ...query, direct_only: value })} />;
      case "min_cabin_pct":
        return <MixedCabinEditor value={query.min_cabin_pct} onChange={(min_cabin_pct) => onChange({ ...query, min_cabin_pct })} />;
      case "sort":
        return <SortEditor value={query.sort_by} onChange={(sort_by) => onChange({ ...query, sort_by })} />;
    }
  }

  return (
    <section aria-label={t("grid.chips.title")} className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {CHIP_ORDER.map((chip) => {
          const state: ChipState = validation.errors[chip] ? "error" : changed.includes(chip) ? "modified" : "default";
          return (
            <ChipPopover
              key={chip}
              id={chip}
              label={chipLabel(chip, t)}
              summary={chipSummary(chip, query, ctx)}
              state={state}
              disabled={disabled}
              open={open === chip}
              onOpenChange={(next) => setOpen(next ? chip : null)}
              title={chipLabel(chip, t)}
              tooltip={chipAriaLabel(chip, query, ctx)}
              errorId={errorId(chip)}
              contentClassName={chip === "dates" ? "w-[34rem]" : undefined}
            >
              {editorFor(chip)}
            </ChipPopover>
          );
        })}

        {modified && (
          <div className="ml-auto flex items-center gap-3">
            {(canReset ?? parsed !== null) && (
              <button type="button" onClick={onReset} className="link t-meta" data-testid="chips-reset">
                {t("grid.reset_to_parsed")}
              </button>
            )}
            <Button type="button" size="sm" onClick={onRun} disabled={disabled || !validation.valid} data-testid="chips-run">
              {t("grid.run")}
            </Button>
          </div>
        )}
      </div>

      {messages.map((m) => (
        <p key={m.chip} id={m.id} className="t-meta text-error" data-testid="chips-error" role="status">
          {m.text}
        </p>
      ))}
      {validation.notes.dates && (
        <p className="t-meta text-fg-muted" data-testid="chips-note">
          {validation.notes.dates}
        </p>
      )}
    </section>
  );
}
