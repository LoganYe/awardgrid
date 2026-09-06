"use client";

/**
 * Dates editor (spec §3.2, docs/UI_PLAN.md §6.2a): three presets and a hand-written two-month
 * range calendar on the pure date model next door (no date-picker dependency).
 *
 * Selection: the first click opens a range, the second closes it (either way round, the model
 * orders them). The 92-day cap CLAMPS the stored selection, so the calendar, the day count and
 * the query always describe the same window; the cap itself is an inline NOTE, never an error.
 * Days before today are disabled — seats.aero only searches forward.
 *
 * Keyboard: one tab stop across the two grids (roving tabindex). The tab stop is derived, not
 * stored: it is the focused day when that day is visible and selectable, otherwise the first
 * selectable day on screen, so paging the months can never strand the grid without a tab stop.
 * ←/→ move a day, ↑/↓ a week, Home/End the week ends, PageUp/PageDown a month; Enter or Space
 * selects the focused day. The view follows the focus, so arrowing past the edge turns the page.
 *
 * Each day carries its full localized date as its accessible name, and the summary line is a
 * live region, so the selection is announced without looking at the fill.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { intlLocale } from "@/lib/grid/format";
import { useLocale, useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { EditorNote } from "@/components/grid/chip-editors/chip-popover";
import { summarizeDates } from "@/components/grid/chips-model";
import {
  addDays,
  addMonths,
  clampTo92,
  dayState,
  formatRange,
  fromQueryDates,
  isCompleteRange,
  matchedPreset,
  monthGrid,
  presetRange,
  RANGE_PRESETS,
  rangeReducer,
  toQueryDates,
  weekdayOrder,
  type RangeSelection,
} from "@/components/grid/date-model";

export interface DatesEditorProps {
  dateFrom: string;
  dateTo: string;
  /** Today in the browser's local calendar; the first selectable day. */
  today: string;
  onChange: (range: { date_from: string; date_to: string }) => void;
}

/** Weekday header labels in the viewer's locale, in the model's column order. */
function useWeekdayLabels(locale: "en" | "zh"): string[] {
  return useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { weekday: "short", timeZone: "UTC" });
    // 2023-12-31 is a Sunday, so index 0 of the formatter's week lines up with weekday 0.
    return weekdayOrder().map((w) => fmt.format(new Date(Date.UTC(2023, 11, 31 + w))));
  }, [locale]);
}

const monthIndex = (ym: { year: number; month: number }): number => ym.year * 12 + ym.month;

/** The first day of `ym` the user may pick: never before today. */
function firstSelectable(ym: { year: number; month: number }, today: string): string {
  const first = `${String(ym.year).padStart(4, "0")}-${String(ym.month).padStart(2, "0")}-01`;
  return first < today ? today : first;
}

export function DatesEditor({ dateFrom, dateTo, today, onChange }: DatesEditorProps) {
  const t = useT();
  const locale = useLocale();
  const weekdays = useWeekdayLabels(locale);

  const [selection, setSelection] = useState<RangeSelection>(() => fromQueryDates({ date_from: dateFrom, date_to: dateTo }));
  const [synced, setSynced] = useState(`${dateFrom}|${dateTo}`);
  // The query changed under us (Reset to parsed, a preset elsewhere): adopt it.
  if (synced !== `${dateFrom}|${dateTo}`) {
    setSynced(`${dateFrom}|${dateTo}`);
    setSelection(fromQueryDates({ date_from: dateFrom, date_to: dateTo }));
  }

  // A shared ?q= link can carry a start date in the past; the calendar opens on today instead,
  // so the visible window always holds at least one selectable day.
  const openOn = dateFrom < today ? today : dateFrom;
  const [view, setView] = useState(() => ({ year: Number(openOn.slice(0, 4)), month: Number(openOn.slice(5, 7)) }));
  const [focusDay, setFocusDay] = useState(openOn);
  const [capped, setCapped] = useState(false);
  const dayRefs = useRef(new Map<string, HTMLButtonElement>());
  const wantFocus = useRef(false);

  const months = [view, addMonths(view.year, view.month, 1)];
  // 84 cells: cheap enough to build on every render, and always in step with `view`.
  const grids = months.map((ym) => monthGrid(ym.year, ym.month));

  // The single tab stop, derived from what is on screen rather than stored: paging the months
  // can never leave the grid with zero focusable cells, and a ?q= link whose start date is in
  // the past (a disabled cell) still has one.
  const selectable = grids.flat(2).filter((cell) => cell.inMonth && cell.iso >= today);
  const tabStop = selectable.some((cell) => cell.iso === focusDay) ? focusDay : (selectable[0]?.iso ?? null);

  useEffect(() => {
    if (!wantFocus.current) return;
    wantFocus.current = false;
    dayRefs.current.get(focusDay)?.focus();
  }, [focusDay, view]);

  /** Keep `day` inside the two visible months. */
  function reveal(day: string) {
    const year = Number(day.slice(0, 4));
    const month = Number(day.slice(5, 7));
    const delta = (year - view.year) * 12 + (month - view.month);
    if (delta < 0) setView(addMonths(view.year, view.month, delta));
    else if (delta > 1) setView(addMonths(view.year, view.month, delta - 1));
  }

  function moveFocus(day: string) {
    if (day < today) return;
    wantFocus.current = true;
    setFocusDay(day);
    reveal(day);
  }

  /** ‹ / ›: turn the page AND take the tab stop with it. */
  function goMonths(delta: number) {
    const next = addMonths(view.year, view.month, delta);
    setView(next);
    setFocusDay(firstSelectable(next, today));
  }

  function commit(next: RangeSelection) {
    const clamped = clampTo92(next);
    // Store the CLAMPED range: the day cells, the count and the query all show the 92 days that
    // will actually be searched (spec §3.2 — the cap is a note, and it is never a surprise).
    const settled: RangeSelection = clamped.start !== null && clamped.end !== null ? { start: clamped.start, end: clamped.end } : next;
    setSelection(settled);
    if (!isCompleteRange(settled)) {
      setCapped(false);
      return;
    }
    setCapped(clamped.capped);
    const dates = toQueryDates(settled);
    if (dates) {
      setSynced(`${dates.date_from}|${dates.date_to}`);
      onChange(dates);
    }
  }

  function pick(day: string) {
    setFocusDay(day);
    commit(rangeReducer(selection, { type: "pick", date: day }));
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" ? -7 : e.key === "ArrowDown" ? 7 : 0;
    if (step !== 0) {
      e.preventDefault();
      moveFocus(addDays(focusDay, step));
      return;
    }
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const weekday = (new Date(`${focusDay}T00:00:00Z`).getUTCDay() + 6) % 7;
      moveFocus(addDays(focusDay, e.key === "Home" ? -weekday : 6 - weekday));
      return;
    }
    if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      moveFocus(addDays(focusDay, e.key === "PageUp" ? -28 : 28));
    }
  }

  const monthTitle = (ym: { year: number; month: number }) =>
    new Intl.DateTimeFormat(intlLocale(locale), { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(ym.year, ym.month - 1, 1)));

  const dayFormat = useMemo(
    () => new Intl.DateTimeFormat(intlLocale(locale), { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }),
    [locale],
  );
  const dayName = (iso: string) => dayFormat.format(new Date(`${iso}T00:00:00Z`));

  // The note says exactly what the chip says ("Oct 1 – Oct 30 (30 days)"), in the same words and
  // the same punctuation, on the clamped range.
  const summary = isCompleteRange(selection) ? summarizeDates({ date_from: selection.start, date_to: selection.end }, { locale, t }) : formatRange(selection, locale);
  const activePreset = matchedPreset(selection, today);
  const canGoBack = monthIndex(view) > monthIndex({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {RANGE_PRESETS.map((days) => (
          <button
            key={days}
            type="button"
            data-testid={`preset-${days}`}
            aria-pressed={activePreset === days}
            onClick={() => {
              const next = presetRange(days, today);
              setFocusDay(next.start ?? today);
              setView({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) });
              commit(next);
            }}
            className={cn("link t-meta", activePreset === days && "font-medium text-fg no-underline")}
          >
            {t("grid.chips.next_days", { n: days })}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => goMonths(-1)}
          disabled={!canGoBack}
          aria-label={t("grid.chips.prev_month")}
          className="inline-flex size-7 items-center justify-center rounded-lg border border-line-strong bg-bg text-fg disabled:border-line disabled:text-fg-muted"
        >
          <span aria-hidden="true">‹</span>
        </button>
        <button
          type="button"
          onClick={() => goMonths(1)}
          aria-label={t("grid.chips.next_month")}
          className="inline-flex size-7 items-center justify-center rounded-lg border border-line-strong bg-bg text-fg"
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>

      <div role="group" aria-label={t("grid.chips.dates")} className="grid grid-cols-1 gap-3 sm:grid-cols-2" onKeyDown={onKeyDown}>
        {months.map((ym, mi) => (
          <table key={`${ym.year}-${ym.month}`} className="w-full border-separate border-spacing-0">
            <caption className="pb-1 text-left text-grid font-medium text-fg">{monthTitle(ym)}</caption>
            <thead>
              <tr>
                {weekdays.map((w) => (
                  <th key={w} scope="col" className="pb-1 t-meta font-normal text-fg-muted">
                    {w}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(grids[mi] ?? []).map((week, wi) => (
                <tr key={wi}>
                  {week.map((cell) => {
                    if (!cell.inMonth) return <td key={cell.iso} className="p-0" />;
                    const state = dayState(cell.iso, selection);
                    const past = cell.iso < today;
                    const isEnd = state === "start" || state === "end";
                    return (
                      <td key={cell.iso} className="p-0">
                        <button
                          type="button"
                          ref={(el) => {
                            if (el) dayRefs.current.set(cell.iso, el);
                            else dayRefs.current.delete(cell.iso);
                          }}
                          disabled={past}
                          tabIndex={cell.iso === tabStop ? 0 : -1}
                          aria-pressed={state !== "none"}
                          aria-current={cell.iso === today ? "date" : undefined}
                          aria-label={dayName(cell.iso)}
                          onClick={() => pick(cell.iso)}
                          onFocus={() => setFocusDay(cell.iso)}
                          data-day={cell.iso}
                          className={cn(
                            "h-7 w-full rounded-lg text-grid",
                            past && "text-fg-muted",
                            // The band that says "in range" is the --line-strong rule above and
                            // below it (3:1 on the raised popover ground); hovering an
                            // unselected day draws a ring instead, so the two never look alike.
                            !past && state === "none" && "text-fg hover:ring-1 hover:ring-line-strong hover:ring-inset",
                            state === "in" && "rounded-none border-y border-line-strong bg-selection text-fg",
                            isEnd && "bg-fg font-medium text-bg",
                          )}
                        >
                          {cell.day}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>

      <p className="t-meta text-fg-muted" role="status" aria-live="polite" data-testid="dates-summary">
        {summary}
      </p>
      {capped && <EditorNote>{t("grid.chips.date_cap")}</EditorNote>}
    </div>
  );
}
