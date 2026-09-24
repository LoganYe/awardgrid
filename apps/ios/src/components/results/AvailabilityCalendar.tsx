/**
 * The Calendar view (UI/UX v1 T08; docs/04 S03; spec §14 "日历"): the lowest miles by date for one cabin, from the
 * same projection as the list — each number is backed by the rows listed when its day is chosen, so choosing a day
 * never makes its number disappear.
 *
 *   - One cabin at a time, named in the caption ("Lowest miles by date · Business J"); with more than one cabin in
 *     the search, a switch between them. No number mixes cabins, and none is called "best".
 *   - Where the search was not proven complete, the caption says the numbers are the lowest retrieved (approved copy
 *     result.min_partial), and an empty day is marked "?" rather than "–" (no matches), with a legend.
 *   - A day's number is compact ("68.5K", core compactMiles, the same in both languages), rounded UP where it has to
 *     round, so no cell shows a price lower than the real one; a rounded cell carries a small "≈", explained in the
 *     legend, and the day's options and the cell's name carry the exact miles.
 *   - Month title 20/26 with 44 pt arrows, weekday heads 13/18, day cells at least 64 tall with 4 pt gaps: at 390 wide
 *     each column is (358 − 24) / 7 ≈ 47.7. Where a column would be narrower than 44 pt at the current text scale
 *     (320 wide, or larger text), the days become a list instead — full numbers, one per line.
 *   - Choosing a day is local: it lists that day's options below, in the view's sort, with their checkboxes bound to
 *     the same selection as the list.
 */
import { CABIN_ORDER, type Cabin, type QueryObject } from "@awardgrid/core/query/schema";
import {
  type EmptyDayKind,
  calendarDayName,
  compactMiles,
  copy,
  dayLabel,
  emptyDayKind,
  emptyDayLabel,
  formatMiles,
  monthLabel,
  optionsCount,
  weekdayHeads,
} from "@awardgrid/core/workspace/present";
import { cabinName } from "@awardgrid/core/workspace/query-editor";
import type { ProjectedDay, RowKey, SnapshotId, ViewPreferences, WorkspaceRow } from "@awardgrid/core/workspace/types";
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Locale } from "../../app/locale";
import { IconButton, SegmentedControl } from "../ui";
import { AvailabilityList } from "./AvailabilityList";
import { RESULTS } from "./copy";

export interface AvailabilityCalendarProps {
  query: QueryObject;
  /** The projection's days: every date of the query's range, for the calendar's cabin. */
  days: readonly ProjectedDay[];
  /** The projection's rows, in the view's sort. */
  rows: readonly WorkspaceRow[];
  sort: ViewPreferences["sort"];
  onCabin: (cabin: Cabin) => void;
  snapshotId: SnapshotId;
  selected: ReadonlySet<RowKey>;
  onToggle: (rowKey: RowKey, on: boolean) => void;
  now: string;
  locale: Locale;
}

/** Every "YYYY-MM" from the first date's month to the last's. */
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number) as [number, number];
  const end = to.slice(0, 7);
  for (;;) {
    const month = `${y}-${String(m).padStart(2, "0")}`;
    out.push(month);
    if (month >= end) return out;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
}

/** The weeks of a month as rows of seven: a day of the month (1-based) or null, in the locale's column order. */
function weeksOf(month: string, locale: Locale): Array<Array<number | null>> {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const lead = weekdayHeads(locale).findIndex((h) => h.day === new Date(Date.UTC(y, m - 1, 1)).getUTCDay());
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: Array<number | null> = [...Array<null>(lead).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

const weakest = (days: readonly ProjectedDay[]): ProjectedDay["coverage"] =>
  days.some((d) => d.coverage === "unknown") ? "unknown" : days.some((d) => d.coverage === "partial") ? "partial" : "complete";

/** The mark an empty day carries; each kind has its own, and the legend names each one shown. */
const MARK: Record<EmptyDayKind, string> = { hidden: "∗", complete: "–", unmonitored: "⊘", partial: "…", unknown: "?" };
const KIND_ORDER: EmptyDayKind[] = ["hidden", "complete", "unmonitored", "partial", "unknown"];

export function AvailabilityCalendar({ query, days, rows, sort, onCabin, snapshotId, selected, onToggle, now, locale }: AvailabilityCalendarProps) {
  const t = RESULTS[locale];
  const id = useId();
  const cabin = days[0]?.cabin ?? query.cabins[0]!;
  const cabinText = `${cabinName(cabin, locale)} ${cabin}`;
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const months = useMemo(() => monthsBetween(query.date_from, query.date_to), [query.date_from, query.date_to]);
  const withRows = days.filter((d) => d.minMiles !== null);
  const [month, setMonth] = useState(() => withRows[0]?.date.slice(0, 7) ?? months[0]!);
  const monthIndex = Math.max(0, months.indexOf(month));
  const shownMonth = months[monthIndex]!;
  const [chosen, setChosen] = useState<string | null>(null);
  const chosenDay = chosen ? byDate.get(chosen) : undefined;
  const chosenRows = chosenDay ? rows.filter((r) => chosenDay.rowKeys.includes(r.key)) : [];

  // A grid while a column is at least 44 pt at the current text scale; a list when it would be narrower. Measured
  // on the content box: the element's own padding is the 16 pt gutters, which no column gets.
  const wrap = useRef<HTMLDivElement>(null);
  const [asList, setAsList] = useState(false);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => {
      const style = getComputedStyle(el);
      const scale = Number.parseFloat(style.getPropertyValue("--ag-text-scale")) || 1;
      const inner = el.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
      setAsList((inner - 6 * 4) / 7 < 44 * scale);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, []);

  const proven = weakest(days);
  const caption = `${t.calendarCaption(cabinText)}${proven === "complete" ? "" : ` · ${copy("result.min_partial", locale)}`}`;
  const toggle = (date: string) => setChosen((current) => (current === date ? null : date));
  const cabins = CABIN_ORDER.filter((c) => query.cabins.includes(c));
  const emptyKinds = (list: readonly ProjectedDay[]) => {
    const counts = new Map<EmptyDayKind, number>();
    for (const d of list) if (d.minMiles === null) counts.set(emptyDayKind(d), (counts.get(emptyDayKind(d)) ?? 0) + 1);
    return KIND_ORDER.filter((k) => counts.has(k)).map((kind) => ({ kind, n: counts.get(kind)! }));
  };

  const monthDays = days.filter((d) => d.date.startsWith(shownMonth));
  const marks = emptyKinds(monthDays).map((k) => k.kind);
  const rounded = monthDays.some((d) => d.minMiles !== null && !compactMiles(d.minMiles).exact);

  /** A chosen day's options, in the view's sort, with the same selection as the list. */
  const dayPanel = (day: ProjectedDay, dayRows: readonly WorkspaceRow[], panelId: string) => (
    <section className="ag-cal-panel" id={panelId} aria-labelledby={`${panelId}-title`}>
      <h2 className="ag-cal-day-title" id={`${panelId}-title`}>
        {t.dayHeading(dayLabel(day.date, locale), cabinText, dayRows.length)}
      </h2>
      <AvailabilityList
        rows={dayRows}
        sort={sort}
        snapshotId={snapshotId}
        selected={selected}
        onToggle={onToggle}
        now={now}
        locale={locale}
        headingLevel={3}
        testId="calendar-day-list"
      />
    </section>
  );
  const step = (to: number) => {
    // The arrows stay focusable at the ends (aria-disabled), so a keyboard user is never dropped to the page.
    if (to >= 0 && to < months.length) setMonth(months[to]!);
  };

  return (
    <div className="ag-cal" data-testid="calendar-view" data-layout={asList ? "list" : "grid"} ref={wrap}>
      {cabins.length > 1 ? (
        <SegmentedControl<Cabin>
          label={t.calendarCabin}
          className={`ag-cal-cabins${cabins.length > 3 ? " ag-cal-cabins-2x2" : ""}`}
          value={cabin}
          onChange={(next) => {
            setChosen(null);
            onCabin(next);
          }}
          options={cabins.map((c) => ({ value: c, label: `${cabinName(c, locale)} ${c}` }))}
        />
      ) : null}
      <p className="ag-cal-caption" id={`${id}-caption`}>
        {caption}
      </p>

      {asList ? (
        <>
          {withRows.length > 0 ? (
            <ul className="ag-cal-list" aria-labelledby={`${id}-caption`}>
              {withRows.map((d) => {
                const open = chosen === d.date && chosenRows.length > 0;
                const panelId = `${id}-day-${d.date}`;
                return (
                  <li key={d.date}>
                    {/* A disclosure: the day's options open right under it, not below the whole list. */}
                    <button
                      type="button"
                      className="ag-cal-row"
                      data-date={d.date}
                      aria-expanded={open}
                      aria-controls={open ? panelId : undefined}
                      aria-label={calendarDayName(d, locale)}
                      onClick={() => toggle(d.date)}
                    >
                      <span className="ag-cal-row-day">{dayLabel(d.date, locale)}</span>
                      <span className="ag-cal-row-min">
                        <span className="ag-miles">{formatMiles(d.minMiles!)}</span> {t.milesUnit}
                      </span>
                      <span className="ag-cal-row-count">{optionsCount(d.rowKeys.length, locale)}</span>
                    </button>
                    {open ? dayPanel(d, chosenRows, panelId) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
          {emptyKinds(days).map(({ kind, n }) => (
            <p key={kind} className="ag-cal-note">
              {t.otherDays(n, kind)}
            </p>
          ))}
        </>
      ) : (
        <>
          <div className="ag-cal-head">
            {months.length > 1 ? (
              <IconButton icon="chevron-left" label={t.previousMonth} aria-disabled={monthIndex === 0 || undefined} onClick={() => step(monthIndex - 1)} />
            ) : null}
            <h2 className="ag-cal-title" id={`${id}-month`} aria-live="polite">
              {monthLabel(shownMonth, locale)}
            </h2>
            {months.length > 1 ? (
              <IconButton icon="chevron-right" label={t.nextMonth} aria-disabled={monthIndex === months.length - 1 || undefined} onClick={() => step(monthIndex + 1)} />
            ) : null}
          </div>
          <table className="ag-cal-grid" aria-labelledby={`${id}-month`} aria-describedby={`${id}-caption`}>
            <thead>
              <tr>
                {weekdayHeads(locale).map((h) => (
                  <th key={h.day} scope="col" abbr={h.long}>
                    {h.short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeksOf(shownMonth, locale).map((week, w) => (
                <tr key={w}>
                  {week.map((n, i) => {
                    if (n === null) return <td key={i} />;
                    const date = `${shownMonth}-${String(n).padStart(2, "0")}`;
                    const day = byDate.get(date);
                    if (!day) {
                      // Outside the search's dates: shown for orientation only.
                      return (
                        <td key={i}>
                          <div className="ag-cal-day ag-cal-out" aria-hidden="true">
                            <span className="ag-cal-num">{n}</span>
                          </div>
                        </td>
                      );
                    }
                    if (day.minMiles === null) {
                      const kind = emptyDayKind(day);
                      return (
                        <td key={i}>
                          <div className="ag-cal-day ag-cal-empty" data-date={date} data-coverage={day.coverage} data-empty={kind}>
                            <span className="ag-cal-num" aria-hidden="true">
                              {n}
                            </span>
                            <span className="ag-cal-mark" aria-hidden="true">
                              {MARK[kind]}
                            </span>
                            <span className="sr-only">{calendarDayName(day, locale)}</span>
                          </div>
                        </td>
                      );
                    }
                    const short = compactMiles(day.minMiles);
                    return (
                      <td key={i}>
                        <button
                          type="button"
                          className="ag-cal-day ag-cal-has"
                          data-date={date}
                          aria-pressed={chosen === date}
                          aria-label={calendarDayName(day, locale)}
                          onClick={() => toggle(date)}
                        >
                          <span className="ag-cal-num">{n}</span>
                          <span className="ag-cal-min">{short.text}</span>
                          {short.exact ? null : <span className="ag-cal-approx">≈</span>}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {marks.length > 0 || rounded ? (
            <p className="ag-cal-legend">
              {marks.map((kind) => (
                <span key={kind}>
                  {MARK[kind]} {emptyDayLabel(kind, locale)}
                </span>
              ))}
              {rounded ? <span>≈ {t.roundedUp}</span> : null}
            </p>
          ) : null}
          {chosenDay && chosenRows.length > 0 ? dayPanel(chosenDay, chosenRows, `${id}-day`) : null}
        </>
      )}

      {/* Only when there is a day to choose. */}
      {withRows.length > 0 && !(chosenDay && chosenRows.length > 0) ? <p className="ag-cal-note">{t.pickDay}</p> : null}
    </div>
  );
}
