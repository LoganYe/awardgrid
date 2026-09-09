"use client";

/**
 * Origins / Destinations editor (spec §3.2, docs/UI_PLAN.md §6.2a).
 *
 * Search the places seed by code or by any alias in either language, add a city (every airport
 * it expands to) or a single airport, then refine: a city renders as one row
 * ("TYO ▸ NRT ✓ HND ✓") with a group toggle and one toggle per airport, and × removes the row.
 * A three-letter code the seed does not know can still be added by hand — it is flagged, not
 * refused, because seats.aero covers airports the seed does not. At least one airport is
 * required; the empty list turns the chip and this note --error.
 *
 * Keyboard: the search input keeps focus; ↓/↑ move the active result (aria-activedescendant),
 * Enter adds it, Esc clears the search before a second Esc closes the popover.
 */
import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { useLocale, useT } from "@awardgrid/core/i18n/client";
import { cn } from "@/lib/utils";
import { EditorNote } from "@/components/grid/chip-editors/chip-popover";
import {
  DEFAULT_PLACES_INDEX,
  groupForEditor,
  placeLabel,
  searchPlaces,
  toggleAirport,
  toggleMetro,
  validateFreeEntry,
  type PlaceEntry,
} from "@/components/grid/places-index";

export interface PlacesEditorProps {
  codes: readonly string[];
  onChange: (codes: string[]) => void;
  /** "Origins" / "Destinations" — the list's accessible name. */
  label: string;
}

type Option = { kind: "place"; entry: PlaceEntry } | { kind: "free"; code: string };

export function PlacesEditor({ codes, onChange, label }: PlacesEditorProps) {
  const t = useT();
  const locale = useLocale();
  const listId = useId();
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);

  const options = useMemo<Option[]>(() => {
    const hits = searchPlaces(text).map((entry): Option => ({ kind: "place", entry }));
    const free = validateFreeEntry(text, codes);
    // A code can be both a city and one of its own airports (SHA = Shanghai, and Hongqiao;
    // BKK = Bangkok, and Suvarnabhumi). The city row adds every airport, so the airport itself
    // stays reachable through the free-entry row: only an AIRPORT hit suppresses it.
    const coveredByAirport = hits.some((o) => o.kind === "place" && o.entry.kind === "airport" && o.entry.code === free.code);
    if (free.code && !coveredByAirport) hits.push({ kind: "free", code: free.code });
    return hits;
  }, [text, codes]);

  const rows = groupForEditor(codes);

  function add(added: readonly string[]) {
    const next = [...codes];
    for (const code of added) if (!next.includes(code)) next.push(code);
    onChange(next);
    setText("");
    setActive(0);
  }

  function commit(option: Option | undefined) {
    if (!option) return;
    if (option.kind === "free") add([option.code]);
    else add(option.entry.kind === "metro" ? (DEFAULT_PLACES_INDEX.metroAirports.get(option.entry.code) ?? [option.entry.code]) : [option.entry.code]);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (options.length === 0) return;
      setActive((i) => (e.key === "ArrowDown" ? (i + 1) % options.length : (i - 1 + options.length) % options.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit(options[active]);
    } else if (e.key === "Escape" && text !== "") {
      // Clear the search first; a second Escape closes the popover.
      e.stopPropagation();
      setText("");
    }
  }

  const formatError = text.trim().length > 0 && options.length === 0;

  return (
    <div className="flex flex-col gap-2">
      <Input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        placeholder={t("grid.chips.search_places")}
        aria-label={t("grid.chips.search_places")}
        // The results listbox only exists while the search has hits, so the combobox is only
        // expanded — and only points at a list — then; aria-controls to a missing id is an
        // aria-valid-attr-value violation (axe, e2e/axe.spec.ts "grid-chip-editor").
        role="combobox"
        aria-expanded={options.length > 0}
        aria-controls={options.length > 0 ? listId : undefined}
        aria-activedescendant={options.length > 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        className="h-8"
      />

      {options.length > 0 && (
        <ul id={listId} role="listbox" aria-label={t("grid.chips.search_results")} className="max-h-40 overflow-y-auto">
          {options.map((option, i) => {
            const code = option.kind === "free" ? option.code : option.entry.code;
            const members = option.kind === "place" && option.entry.kind === "metro" ? (DEFAULT_PLACES_INDEX.metroAirports.get(code) ?? []) : [];
            return (
              <li key={`${option.kind}-${code}`} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => commit(option)}
                  className={cn("flex h-8 w-full items-center gap-2 rounded-lg px-1.5 text-left text-grid", i === active && "bg-bg")}
                >
                  <span className="w-9 shrink-0 font-medium">{code}</span>
                  <span className="truncate text-fg-muted">{option.kind === "free" ? t("grid.chips.add_sibling", { code }) : placeLabel(option.entry, locale)}</span>
                  {members.length > 1 && <span className="ml-auto shrink-0 t-meta text-fg-muted">{members.join(", ")}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {formatError && <EditorNote tone="error">{t("grid.chips.invalid_airport")}</EditorNote>}

      <ul aria-label={label} className="flex flex-col">
        {rows.map((row) => (
          <li key={row.metro} className="flex min-h-8 flex-wrap items-center gap-1.5 py-0.5 text-grid">
            <button
              type="button"
              aria-pressed={row.state === "all"}
              onClick={() => onChange(toggleMetro(codes, row.metro))}
              title={placeLabel(DEFAULT_PLACES_INDEX.byCode.get(row.metro), locale)}
              // The name says which city and that the control takes every airport of it — a bare
              // "SHA" is indistinguishable from the Hongqiao airport toggle beside it.
              aria-label={
                row.airports.length > 1
                  ? t("grid.chips.select_city", { city: `${row.metro} ${placeLabel(DEFAULT_PLACES_INDEX.byCode.get(row.metro), locale)}`.trim() })
                  : `${row.metro} ${placeLabel(DEFAULT_PLACES_INDEX.byCode.get(row.metro), locale)}`.trim()
              }
              className={cn("inline-flex h-6 items-center rounded-lg border px-1.5", row.state === "all" ? "border-line-strong bg-bg text-fg" : "border-line text-fg-muted")}
            >
              {row.metro}
            </button>
            {/*
              The city name is on EVERY row, not just single-airport ones (docs/UI_PLAN.md §6.2a
              draws the group row as "SHA  Shanghai  ▸ PVG ✓  SHA ✓  ×"). It used to survive only
              in the title and the aria-label, so a sighted user scanning the list saw three bare
              codes and could not tell that SEL is Seoul.
            */}
            <span className="truncate text-fg-muted">
              {row.unknown ? t("grid.chips.unknown_code") : placeLabel(DEFAULT_PLACES_INDEX.byCode.get(row.metro), locale)}
            </span>
            {row.airports.length > 1 && (
              <>
                <span aria-hidden="true" className="text-fg-muted">
                  ▸
                </span>
                {row.airports.map((airport) => (
                  <button
                    key={airport.code}
                    type="button"
                    aria-pressed={airport.selected}
                    aria-label={`${airport.code} ${airport.selected ? t("grid.chips.selected") : t("grid.chips.not_selected")}`}
                    onClick={() => onChange(toggleAirport(codes, airport.code))}
                    className={cn("inline-flex h-6 items-center gap-1 rounded-lg border px-1.5", airport.selected ? "border-line-strong bg-bg text-fg" : "border-line text-fg-muted")}
                  >
                    {airport.code}
                    {airport.selected && <span aria-hidden="true">✓</span>}
                  </button>
                ))}
              </>
            )}
            <button
              type="button"
              onClick={() => onChange(codes.filter((c) => !row.airports.some((a) => a.code === c)))}
              aria-label={`${t("grid.chips.remove")} ${row.metro}`}
              className="ml-auto inline-flex size-6 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:text-fg"
            >
              <span aria-hidden="true">×</span>
            </button>
          </li>
        ))}
      </ul>

      {codes.length === 0 ? <EditorNote tone="error">{t("grid.chips.at_least_one_airport")}</EditorNote> : <EditorNote>{t("grid.chips.free_entry_hint")}</EditorNote>}
    </div>
  );
}
