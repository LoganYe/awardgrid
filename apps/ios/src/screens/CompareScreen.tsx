/**
 * Compare the chosen options (UI/UX v1 T12; docs/04 S05; spec §13 "比较"; acceptance A22).
 *
 * A full-height page drawn over the Search screen, like an option's details (T10): the results stay mounted and inert
 * underneath, so Back finds their view, scroll, calendar day and matrix cell as they were. A 52 pt header with Back,
 * the title and "2 of 4", then the options in the fixed field order — route and date, cabin, program, miles, fees,
 * itineraries, seats, source time, program website.
 *
 * Every figure is the chosen snapshot's own (core workspace/selection.ts): an option whose snapshot has left the
 * device is shown from the copy kept when it was chosen, and says so; one found nowhere says it is gone. Options are
 * numbered in the order chosen, and when they come from more than one search each says which, so two options that
 * otherwise read the same (the same row in two searches) are never confused. Itineraries show only if they were
 * loaded on this device, with when; nothing here loads them, and nothing here sends any request.
 *
 * Nothing is ranked, scored or totalled. Miles from different programs are not worth the same, fees in different
 * currencies are not converted, a fee with no currency is not comparable, and an unknown fee is said as unknown.
 *
 * Sample mode (release plan step 17): the banner at the top, "Sample data" for the source time under a "Data" field,
 * no program links ("Sample options have no booking links.") and "Sample data · on this device" for the data line.
 *
 * Layout (core `compareLayout`): on a phone two columns at a time, with a picker above each column for a third or
 * fourth option; "Read one by one" shows every option in turn; at 320 or 200% text only that. Wider screens show up to
 * four side by side, 16 apart and 220 or more each; when they do not fit only the table scrolls sideways, and the
 * field names stay in view. The table is a real table: each value is announced with its option and its field.
 */
import { detailLink } from "@awardgrid/core/grid/deeplinks/trusted";
import { ageLabel, copy, dayLabel, dayParts, feesLabel, formatMiles, programLabel, programShortLabel, resultName, seatsLabel, timeLabel } from "@awardgrid/core/workspace/present";
import { cabinName } from "@awardgrid/core/workspace/query-editor";
import { COMPARE_FIELDS, type CompareEntry, type CompareField, MAX_COMPARE, compareLayout, compareNotes, refKey } from "@awardgrid/core/workspace/selection";
import { type ReactNode, useEffect, useEffectEvent, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate, useOutletContext } from "react-router";
import type { AppServices } from "../app/bootstrap";
import { isSample } from "../app/data-source";
import { useFocusOnArrival } from "../app/focus";
import { langTag, useLocale } from "../app/locale";
import { shortDateTime } from "../app/when";
import { COMPARE_OPENER } from "../components/CompareTray";
import { RESULTS } from "../components/results/copy";
import { SeatsAttribution } from "../components/SeatsAttribution";
import { SampleBanner } from "../components/SampleBanner";
import { SAMPLE } from "../sample/sample-copy";
import { Icon, IconButton } from "../components/ui";
import { COMPARE } from "./compare-copy";
import "../components/compare.css";

/** When a search was made, on this device's clock. */
const searchWhen = shortDateTime;

export function CompareScreen() {
  const services = useOutletContext<AppServices>();
  const locale = useLocale(services);
  const sample = isSample(services);
  // In sample mode the source-time field is named "Data", and it says "Sample data" (release plan step 17).
  const base = COMPARE[locale];
  const c = sample ? { ...base, fields: { ...base.fields, source_time: SAMPLE[locale].compareField }, noLink: SAMPLE[locale].noLinks } : base;
  const t = RESULTS[locale];
  const navigate = useNavigate();
  // Drawn again whenever the workspace changes (a removal here, a search finishing): at most four options are read
  // again from the kept snapshots each time, and nothing is fetched to read them.
  useSyncExternalStore(services.workspace.subscribe, services.workspace.getState, services.workspace.getState);
  const entries = services.workspace.selectionEntries();
  const [now] = useState(() => services.now());
  const title = useRef<HTMLHeadingElement>(null);
  useFocusOnArrival(title);
  const [status, setStatus] = useState("");

  // Focus returns to "Compare selected options", or to the results' title when nothing is chosen any more.
  const back = () => navigate("/", { replace: true, state: { focus: services.workspace.getState().selected.length > 0 ? COMPARE_OPENER : "search-title" } });
  const onEscape = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
    event.preventDefault();
    back();
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onEscape(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  // The content width and text scale decide the layout (docs/04 S05).
  const body = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 358, scale: 1 });
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const measure = () => {
      const style = getComputedStyle(el);
      const width = el.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
      const scale = Number.parseFloat(style.getPropertyValue("--ag-text-scale")) || 1;
      setBox((b) => (b.width === width && b.scale === scale ? b : { width, scale }));
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, []);
  const layout = compareLayout(box.width, box.scale, entries.length);
  const wide = box.width >= 2 * 220 + 16;
  const [oneByOne, setOneByOne] = useState(false);
  const single = layout.columns <= 1 || oneByOne;
  // Switching between side by side and one by one replaces the button pressed: focus goes to the one that switches
  // back, and the reading starts from the top.
  const modeButton = useRef<HTMLButtonElement>(null);
  const switchMode = (next: boolean) => {
    setOneByOne(next);
    window.requestAnimationFrame(() => {
      body.current?.scrollTo(0, 0);
      modeButton.current?.focus({ preventScroll: true });
    });
  };

  // Numbered in the order chosen; which search, when there is more than one.
  const number = new Map(entries.map((e, i) => [refKey(e.ref), i + 1]));
  const manySearches = new Set(entries.map((e) => e.ref.snapshotId)).size > 1;
  const manyRoutes = new Set(entries.flatMap((e) => (e.row ? [`${e.row.value.origin}-${e.row.value.dest}`] : []))).size > 1;
  const searchLine = (entry: CompareEntry) => (manySearches && entry.snapshotCreatedAt ? c.searchOf(searchWhen(entry.snapshotCreatedAt, locale)) : null);

  // On a phone with more options than columns: which option each column shows, by reference.
  const [picked, setPicked] = useState<[string | null, string | null]>([null, null]);
  const keys = entries.map((e) => refKey(e.ref));
  const shownKeys: string[] = layout.picker
    ? (() => {
        const first = picked[0] && keys.includes(picked[0]) ? picked[0] : keys[0]!;
        const second = picked[1] && keys.includes(picked[1]) && picked[1] !== first ? picked[1] : keys.find((k) => k !== first)!;
        return [first, second];
      })()
    : keys;
  const columns = shownKeys.map((k) => entries.find((e) => refKey(e.ref) === k)!);
  const pick = (column: 0 | 1, key: string) => {
    const other = shownKeys[column === 0 ? 1 : 0]!;
    // Choosing what the other column shows swaps the two.
    setPicked(column === 0 ? [key, key === other ? shownKeys[0]! : other] : [key === other ? shownKeys[1]! : other, key]);
  };

  // Removing is said, and focus goes to the page title: the button pressed is gone with its option.
  const remove = (entry: CompareEntry) => {
    services.workspace.setSelected(entry.ref, false);
    const left = services.workspace.getState().selected.length;
    setStatus("");
    window.requestAnimationFrame(() => {
      setStatus(c.removed(left, MAX_COMPARE));
      title.current?.focus({ preventScroll: true });
    });
  };
  const notes = compareNotes(entries);

  const loadedFor = (entry: CompareEntry) => (entry.source === "snapshot" ? services.details.peek(entry.ref) : null);
  function linkFor(entry: CompareEntry) {
    // Sample options have no booking or program links.
    if (!entry.row || sample) return null;
    return loadedFor(entry)?.link ?? detailLink(entry.row.value, []);
  }
  const anyLink = entries.some((e) => linkFor(e) !== null);

  /** The full name, for the Remove button: numbered, so it is never the same as another's. */
  function name(entry: CompareEntry): string {
    const n = c.option(number.get(refKey(entry.ref)) ?? 0);
    const search = searchLine(entry);
    return [n, entry.row ? resultName(entry.row.value, locale) : c.missing, search].filter(Boolean).join(locale === "zh" ? "，" : ", ");
  }

  /** The picker's text: what tells the options apart first (miles, program), then when, and where and which search when those differ. */
  function pickerName(entry: CompareEntry): string {
    const n = `${number.get(refKey(entry.ref))}.`;
    const row = entry.row?.value;
    if (!row) return `${n} ${c.missing}`;
    const parts = [`${formatMiles(row.miles)} ${t.milesUnit}`, programShortLabel(row.program), dayParts(row.date, locale).date, cabinName(row.cabin, locale)];
    if (manyRoutes) parts.push(`${row.origin} → ${row.dest}`);
    if (manySearches && entry.snapshotCreatedAt) parts.push(searchWhen(entry.snapshotCreatedAt, locale));
    return `${n} ${parts.join(" · ")}`;
  }

  function value(field: CompareField, entry: CompareEntry): ReactNode {
    const row = entry.row?.value;
    if (!row) return field === "route_date" ? c.missing : null;
    switch (field) {
      case "route_date":
        return (
          <>
            <span className="ag-compare-strong">{`${row.origin} → ${row.dest}`}</span>
            <span>{dayLabel(row.date, locale)}</span>
          </>
        );
      case "cabin":
        return cabinName(row.cabin, locale);
      case "program":
        return programLabel(row.program);
      case "miles":
        return (
          <>
            <span className="ag-compare-figure tabular">{formatMiles(row.miles)}</span> <span className="ag-compare-unit">{t.milesUnit}</span>
          </>
        );
      case "fees":
        return <span className="tabular">{feesLabel(row.fees_cents, row.currency, locale)}</span>;
      case "itineraries": {
        if (entry.source === "kept_copy") return <span className="ag-compare-muted">{c.cannotLoad}</span>;
        const loaded = loadedFor(entry);
        // Loaded for this option (the same source, cabin and scope) on this device: said with when.
        return loaded ? c.loaded(loaded.trips.length, ageLabel(Math.max(0, now.getTime() - Date.parse(loaded.loadedAt)), locale)) : <span className="ag-compare-muted">{c.notLoaded}</span>;
      }
      case "seats":
        return seatsLabel(row.seats_left, locale);
      case "source_time":
        return (
          <>
            <span>{timeLabel(entry.row!.time, now.toISOString(), locale, { sample })}</span>
            {entry.source === "kept_copy" ? <span className="ag-compare-muted">{c.keptCopy}</span> : null}
          </>
        );
      case "link": {
        const link = linkFor(entry);
        return link ? (
          <a className="ag-button ag-compare-out" href={link.url} target="_blank" rel="noreferrer noopener" aria-label={`${c.openProgram} (${link.host})`}>
            <span>{c.openProgram}</span>
            <Icon name="external" />
          </a>
        ) : (
          <span className="ag-compare-muted">{c.noLink}</span>
        );
      }
    }
  }

  const removeButton = (entry: CompareEntry) => (
    <button type="button" className="ag-button ag-compare-remove" aria-label={c.removeName(name(entry))} onClick={() => remove(entry)}>
      <Icon name="close" size={16} />
      <span>{c.remove}</span>
    </button>
  );

  /** The option's heading: its number, then date and cabin, then program and route, then which search (when several). */
  const heading = (entry: CompareEntry) => {
    const n = c.option(number.get(refKey(entry.ref)) ?? 0);
    if (!entry.row) {
      return (
        <>
          <span className="ag-compare-muted">{n}</span>
          <span className="ag-compare-muted">{c.missing}</span>
        </>
      );
    }
    const row = entry.row.value;
    const search = searchLine(entry);
    return (
      <>
        <span className="ag-compare-muted">{n}</span>
        <span className="ag-compare-strong">{`${dayParts(row.date, locale).date} · ${cabinName(row.cabin, locale)}`}</span>
        <span className="ag-compare-muted">{`${programShortLabel(row.program)} · ${row.origin} → ${row.dest}`}</span>
        {search ? <span className="ag-compare-muted">{search}</span> : null}
      </>
    );
  };

  return (
    <div className="ag-compare" role="dialog" aria-modal="true" aria-labelledby="compare-title" lang={langTag(locale)} data-columns={single ? 1 : columns.length}>
      <header className="ag-compare-header">
        <IconButton icon="chevron-left" label={c.back} onClick={back} />
        <h1 ref={title} id="compare-title" tabIndex={-1} className="ag-compare-title">
          {copy("compare.title", locale)}
        </h1>
        <span className="ag-compare-count tabular">{c.count(entries.length, MAX_COMPARE)}</span>
      </header>

      <div ref={body} className="ag-compare-body">
        {/* Always in the tree, so a removal is announced. */}
        <p role="status" className="sr-only">
          {status}
        </p>
        <SampleBanner services={services} locale={locale} />
        <p className="ag-compare-note">{c.nothingSent}</p>
        {notes.programs.length > 1 ? <p className="ag-compare-note">{c.noRanking}</p> : null}
        {notes.currencies.length > 1 ? <p className="ag-compare-note">{c.currencies(notes.currencies.join(locale === "zh" ? "、" : ", "))}</p> : null}
        {notes.currencyMissing > 0 ? <p className="ag-compare-note">{c.currencyMissing(notes.currencyMissing)}</p> : null}
        {notes.unknownFees > 0 ? <p className="ag-compare-note">{c.unknownFees(notes.unknownFees)}</p> : null}

        {entries.length < 2 ? (
          <div className="ag-compare-empty">
            <p>{c.needTwo}</p>
            {entries.map((entry) => (
              <div key={refKey(entry.ref)} className="ag-compare-one">
                <p>{name(entry)}</p>
                {removeButton(entry)}
              </div>
            ))}
            <button type="button" className="ag-button" onClick={back}>
              {c.back}
            </button>
          </div>
        ) : single ? (
          <>
            {layout.columns > 1 ? (
              <button ref={modeButton} type="button" className="ag-button ag-compare-mode" onClick={() => switchMode(false)}>
                {c.sideBySide}
              </button>
            ) : null}
            {entries.map((entry, i) => (
              <section key={refKey(entry.ref)} className="ag-compare-card" aria-labelledby={`compare-card-${i}`}>
                <div className="ag-compare-card-head">
                  <h2 id={`compare-card-${i}`} className="ag-compare-card-title">
                    {heading(entry)}
                  </h2>
                  {removeButton(entry)}
                </div>
                <dl className="ag-compare-list">
                  {COMPARE_FIELDS.map((field) => (
                    <div key={field} className="ag-compare-pair">
                      <dt className="ag-compare-label">{c.fields[field]}</dt>
                      <dd className="ag-compare-value">{value(field, entry) ?? "—"}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </>
        ) : (
          <>
            <div className="ag-compare-tools" data-wide={wide ? "" : undefined}>
              {layout.picker
                ? ([0, 1] as const).map((column) => (
                    <label key={column} className="ag-compare-picker">
                      <span className="ag-compare-picker-label">{c.column(column + 1)}</span>
                      <select className="ag-input" value={shownKeys[column]} onChange={(e) => pick(column, e.target.value)}>
                        {entries.map((entry) => (
                          <option key={refKey(entry.ref)} value={refKey(entry.ref)}>
                            {pickerName(entry)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))
                : null}
              <button ref={modeButton} type="button" className="ag-button ag-compare-mode" onClick={() => switchMode(true)}>
                {c.readOneByOne}
              </button>
            </div>
            <div className={layout.scroll ? "ag-compare-scroll" : undefined}>
              {/* Wider than a phone: 16 apart; scrolling, each column exactly 220 (a table ignores min-width). */}
              <table
                className="ag-compare-table"
                data-wide={wide ? "" : undefined}
                style={layout.scroll ? { width: `${columns.length * 220 + (columns.length + 1) * 16}px` } : undefined}
              >
                <caption className="sr-only">{copy("compare.title", locale)}</caption>
                <thead>
                  <tr>
                    {columns.map((entry, i) => (
                      <th key={refKey(entry.ref)} id={`compare-col-${i}`} scope="col" className="ag-compare-head">
                        <span className="ag-compare-head-text">{heading(entry)}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                {/* The Remove buttons in their own row, so a column's header names the option and nothing else. */}
                <tbody>
                  <tr>
                    {columns.map((entry) => (
                      <td key={refKey(entry.ref)} className="ag-compare-actions">
                        {removeButton(entry)}
                      </td>
                    ))}
                  </tr>
                </tbody>
                {COMPARE_FIELDS.map((field) => (
                  <tbody key={field}>
                    <tr>
                      <th id={`compare-field-${field}`} colSpan={columns.length} scope="colgroup" className="ag-compare-label">
                        <span className="ag-compare-label-text">{c.fields[field]}</span>
                      </th>
                    </tr>
                    <tr>
                      {columns.map((entry, i) => (
                        <td key={refKey(entry.ref)} headers={`compare-col-${i} compare-field-${field}`} className={`ag-compare-value ag-compare-${field}`}>
                          {value(field, entry)}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                ))}
              </table>
            </div>
          </>
        )}
        {anyLink && entries.length >= 2 ? <p className="ag-compare-note">{copy("details.external", locale)}</p> : null}
        {/* LEGAL.md: seats.aero's figures carry "Data: seats.aero", linked to seats.aero, beside them, as the details
            do. Not when no option is left to show any. */}
        {entries.some((entry) => entry.row !== null) ? (
          sample ? (
            <p className="ag-compare-note ag-sample-source">{SAMPLE[locale].attribution}</p>
          ) : (
            <SeatsAttribution className="ag-compare-note" text={copy("data.source", locale)} locale={locale} />
          )
        ) : null}
      </div>
    </div>
  );
}
