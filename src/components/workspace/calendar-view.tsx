"use client";
/**
 * The Web calendar (UI/UX v1 T19; spec §17): the search's days, one cabin at a time, from the same projection as the
 * list and matrix. A day with options shows its lowest miles (the lowest retrieved where the search did not prove
 * complete); an empty day says why in words. One tab stop: arrows move a day or a week, Home/End to the ends; Enter or
 * a click lists that day's options under the calendar. Too narrow for seven readable columns (a phone), the month is a
 * list of dates instead (docs/04: 320 wide or large text use an accessible date list). Nothing here fetches.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useLocale, useT } from "@awardgrid/core/i18n/client";
import type { Cabin, QueryObject } from "@awardgrid/core/query/schema";
import { calendarCabinFor } from "@awardgrid/core/workspace/projection";
import { calendarDayName, compactMiles, dayLabel, emptyDayKind, emptyDayLabel, monthLabel, weekdayHeads } from "@awardgrid/core/workspace/present";
import { cabinName } from "@awardgrid/core/workspace/query-editor";
import type { ProjectedDay, ProjectedResults, ResultSnapshot } from "@awardgrid/core/workspace/types";
import { ListView, type OptionActions } from "./list-view";

export interface CalendarViewProps extends OptionActions {
  snapshot: ResultSnapshot;
  projected: ProjectedResults;
  sort: QueryObject["sort_by"];
  cabin: Cabin;
  now: string;
  onSort: (sort: QueryObject["sort_by"]) => void;
  onCabin: (cabin: Cabin) => void;
}

const dayDomId = (snapshotId: string, date: string) => `cal-${snapshotId}-${date}`.replace(/[^A-Za-z0-9_-]/g, "_");
const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

export function CalendarView({ snapshot, projected, sort, cabin: chosen, now, onSort, onCabin, ...actions }: CalendarViewProps) {
  const t = useT();
  const locale = useLocale();
  const cabin = calendarCabinFor(snapshot.query, chosen);
  const days = useMemo(() => projected.days.filter((d) => d.cabin === cabin), [projected.days, cabin]);
  const heads = weekdayHeads(locale);
  const months = useMemo(() => {
    const byMonth = new Map<string, ProjectedDay[]>();
    for (const day of days) {
      const month = day.date.slice(0, 7);
      byMonth.set(month, [...(byMonth.get(month) ?? []), day]);
    }
    return [...byMonth.entries()];
  }, [days]);
  const [focused, setFocused] = useState<string | null>(null);
  const current = focused && days.some((d) => d.date === focused) ? focused : (days[0]?.date ?? null);
  const [opened, setOpened] = useState<{ date: string; snapshotId: string; cabin: Cabin } | null>(null);
  const open = opened && opened.snapshotId === snapshot.id && opened.cabin === cabin ? opened.date : null;
  const heading = useRef<HTMLHeadingElement>(null);
  const [focusOptions, setFocusOptions] = useState(0);
  useEffect(() => {
    if (focusOptions) heading.current?.focus();
  }, [focusOptions]);

  const focusDay = (date: string) => {
    setFocused(date);
    document.getElementById(dayDomId(snapshot.id, date))?.focus();
  };
  const activate = (day: ProjectedDay) => {
    setFocused(day.date);
    if (day.rowKeys.length === 0) return;
    if (day.rowKeys.length === 1) {
      actions.onOpen(day.rowKeys[0]!, document.getElementById(dayDomId(snapshot.id, day.date)) ?? undefined);
      return;
    }
    setOpened({ date: day.date, snapshotId: snapshot.id, cabin });
    setFocusOptions((n) => n + 1);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.nativeEvent.isComposing) return;
    // A week up or down in the month grid; one day in the narrow list, where the days are one column.
    const week = getComputedStyle(event.currentTarget.parentElement!).gridTemplateColumns.split(" ").length === 1 ? 1 : 7;
    const step: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: week, ArrowUp: -week };
    let next: number | null = null;
    if (event.key in step) next = Math.min(Math.max(index + step[event.key]!, 0), days.length - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = days.length - 1;
    if (next === null) return;
    event.preventDefault();
    focusDay(days[next]!.date);
  };

  const openDay = open ? days.find((d) => d.date === open) : undefined;
  const openKeys = openDay ? new Set(openDay.rowKeys) : null;
  const openRows = openKeys ? projected.rows.filter((r) => openKeys.has(r.key)) : [];
  const offset = (date: string) => {
    const first = heads[0]!.day;
    return (weekdayOf(date) - first + 7) % 7;
  };

  return (
    <div className="ag-ws-calendar" data-testid="calendar-view">
      {snapshot.query.cabins.length > 1 ? (
        <label className="ag-ws-select-wrap">
          <span className="ag-ws-inline-label">{t("workspace.calendar_cabin")}</span>
          <select className="ag-ws-select" value={cabin} onChange={(e) => onCabin(e.target.value as Cabin)}>
            {snapshot.query.cabins.map((c) => (
              <option key={c} value={c}>
                {cabinName(c, locale)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {months.map(([month, monthDays]) => (
        <section key={month} className="ag-ws-month" aria-label={monthLabel(month, locale)}>
          <h2 className="ag-ws-month-title">{monthLabel(month, locale)}</h2>
          <div className="ag-ws-weekdays" aria-hidden>
            {heads.map((h) => (
              <span key={h.day}>{h.short}</span>
            ))}
          </div>
          <div className="ag-ws-days">
            {Array.from({ length: offset(monthDays[0]!.date) }, (_, i) => (
              <span key={`blank-${i}`} className="ag-ws-day-blank" aria-hidden />
            ))}
            {monthDays.map((day) => {
              const index = days.indexOf(day);
              const has = day.minMiles !== null;
              const lowest = has ? compactMiles(day.minMiles!) : null;
              return (
                <button
                  key={day.date}
                  id={dayDomId(snapshot.id, day.date)}
                  type="button"
                  className="ag-ws-day"
                  data-state={has ? "results" : emptyDayKind(day)}
                  tabIndex={day.date === current ? 0 : -1}
                  aria-label={calendarDayName(day, locale)}
                  aria-pressed={open === day.date}
                  onClick={() => activate(day)}
                  onFocus={() => setFocused(day.date)}
                  onKeyDown={(e) => onKeyDown(e, index)}
                >
                  <span className="ag-ws-day-number tabular" aria-hidden>
                    {Number(day.date.slice(8))}
                  </span>
                  <span className="ag-ws-day-date" aria-hidden>
                    {dayLabel(day.date, locale)}
                  </span>
                  <span className="ag-ws-day-value tabular" aria-hidden>
                    {lowest ? lowest.text : emptyDayLabel(emptyDayKind(day), locale)}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {openDay && open ? (
        <section
          className="ag-ws-cell-options"
          aria-labelledby="ag-ws-day-options-title"
          onKeyDown={(e) => {
            if (e.key !== "Escape" || e.defaultPrevented || e.nativeEvent.isComposing) return;
            e.preventDefault();
            setOpened(null);
            focusDay(open);
          }}
        >
          <h2 id="ag-ws-day-options-title" ref={heading} tabIndex={-1} className="ag-ws-section-title">
            {t("workspace.calendar_day_options", { day: dayLabel(open, locale) })}
          </h2>
          <ListView snapshot={snapshot} rows={openRows} sort={sort} now={now} onSort={onSort} label={t("workspace.calendar_day_options", { day: dayLabel(open, locale) })} testId="calendar-day-options" {...actions} />
        </section>
      ) : null}
    </div>
  );
}
