/**
 * The query editor (UI/UX v1 plan 02 T06; docs/04 S02; reference screen query-editor.png).
 *
 * A full-height page, outside the tab chrome: a 52 pt header with Back, the fields in their fixed order (departure,
 * arrival, dates, cabins, nonstop / mixed cabin, programs, more), and one 48 pt primary button above the bottom safe
 * area. The editor only edits a draft: typing, choosing places, turning date modes and cabins on and off send
 * nothing, and no AI is involved. The one request is the explicit "Find award options", which runs the resolved
 * query as a new workspace revision on the shared search path and returns to the results.
 *
 * The page can also be searched by typing (T07): one sentence, read by the deterministic parser (no AI), run when the
 * person presses Run — a parse failure or a missing key stays here, under the box. Opened from a results filter
 * (`?section=programs|stops|more`), the page opens at that condition.
 *
 * Leaving with changes asks first ("Discard changes" / "Keep editing"); leaving without changes just goes back. Esc
 * is Back. Focus moves to the title when the page opens and returns to "Edit search" when it closes. Text typed in
 * an airport box but never chosen counts as a change and stops the submit. A draft that cannot run shows each error
 * under its field and moves focus to the first one.
 */
import { type Cabin, DEFAULT_CABINS, DEFAULT_MIN_CABIN_PCT, type QueryObject } from "@awardgrid/core/query/schema";
import { SEATS_SOURCES, SOURCE_NAMES } from "@awardgrid/core/seatsaero/types";
import {
  type DraftField,
  type DraftFieldError,
  cabinName,
  describeQuery,
  draftFromQuery,
  resolveDraft,
  sameDraft,
  validateDraft,
} from "@awardgrid/core/workspace/query-editor";
import type { QueryDraft } from "@awardgrid/core/workspace/types";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useLocation, useNavigate, useOutletContext, useSearchParams } from "react-router";
import type { AppServices } from "../app/bootstrap";
import { langTag, useLocale } from "../app/locale";
import { AirportField } from "../components/query/AirportField";
import { DateRuleField } from "../components/query/DateRuleField";
import { EDITOR_COPY, fieldErrorText } from "../components/query/labels";
import { TextSearch } from "../components/query/TextSearch";
import { Button, Chip, Icon, IconButton, Sheet, Switch, TextField } from "../components/ui";

const CABINS: readonly Cabin[] = ["J", "F", "W", "Y"];

/** The id of the control that takes focus when its field has the first error. */
const FIELD_FOCUS: Record<DraftField, string> = {
  origins: "query-origins",
  destinations: "query-destinations",
  dates: "query-dates",
  cabins: "query-cabin-J",
  max_miles: "query-miles",
};

/** Where the Search screen puts focus when the editor closes. */
export const RETURN_FOCUS = "edit-search";

/**
 * A draft for a first search: no airports yet, the next 30 days, core's default cabins and mixed-cabin rule. Not a
 * valid query until airports are added; resolveDraft runs the schema at submit.
 */
function blankDraft(today: string, sortBy: QueryObject["sort_by"]): QueryDraft {
  const query: QueryObject = {
    origins: [],
    destinations: [],
    date_from: today,
    date_to: today,
    cabins: [...DEFAULT_CABINS],
    direct_only: false,
    include_filtered: false,
    min_cabin_pct: DEFAULT_MIN_CABIN_PCT,
    sort_by: sortBy,
    raw_text: "",
    language: "en",
  };
  return { query, dates: { kind: "relative_days", days: 30, clock: "UTC" } };
}

export function QueryEditorScreen() {
  const services = useOutletContext<AppServices>();
  const locale = useLocale(services);
  const EDITOR = EDITOR_COPY[locale];
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const section = params.get("section");
  // The control that opened the editor (a filter chip), so focus goes back to it; else the summary.
  const returnTo = (useLocation().state as { from?: string } | null)?.from ?? RETURN_FOCUS;
  const today = services.now().toISOString().slice(0, 10);
  const [initial] = useState<QueryDraft>(() => {
    // The view's sort rides along, so a search from here keeps the order the results are read in (U-030).
    const { displayedSnapshot: shown, preferences } = services.workspace.getState();
    return shown ? draftFromQuery({ ...shown.query, sort_by: preferences.sort }) : blankDraft(today, preferences.sort);
  });
  const [draft, setDraft] = useState<QueryDraft>(initial);
  const [errors, setErrors] = useState<DraftFieldError[]>([]);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [programsOpen, setProgramsOpen] = useState(section === "programs");
  const [typing, setTyping] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  // What is typed in each airport box but not chosen yet.
  const [pending, setPending] = useState({ origins: "", destinations: "" });
  const submitted = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  const dirty = !sameDraft(initial, draft) || pending.origins.trim() !== "" || pending.destinations.trim() !== "";
  const errorFor = (field: DraftField) => {
    const e = errors.find((x) => x.field === field);
    return e ? fieldErrorText(field, e.code, locale) : null;
  };
  const set = (patch: Partial<QueryObject>) => setDraft((d) => ({ ...d, query: { ...d.query, ...patch } }));
  // An error goes once its field changes; the rest stay until the next submit checks them again.
  const clear = (field: DraftField) => setErrors((list) => list.filter((e) => e.field !== field));

  const leave = () => navigate("/", { replace: true, state: { focus: returnTo } });
  // Opened straight onto the Programs sheet (from its chip), closing it lands on the Programs row, not the page.
  const closePrograms = () => {
    setProgramsOpen(false);
    if (section === "programs") window.requestAnimationFrame(() => document.getElementById("query-programs-row")?.focus());
  };
  const back = () => (dirty ? setConfirmLeave(true) : leave());

  // Focus: the condition the page was opened for, else the title.
  useEffect(() => {
    const target = section === "stops" ? "query-direct" : section === "more" ? FIELD_FOCUS.max_miles : null;
    const el = target ? document.getElementById(target) : null;
    if (el) {
      el.scrollIntoView({ block: "center" });
      el.focus();
    } else if (section !== "programs") heading.current?.focus();
  }, [section]);

  const searchByText = async (text: string) => {
    setTyping({ busy: true, error: null });
    const prepared = await services.prepareText(text);
    if (!prepared.ok) {
      setTyping({ busy: false, error: prepared.message ?? prepared.error });
      return;
    }
    submitted.current = true;
    void services.runParsed(text, prepared.value).then(() => services.persist());
    leave();
  };
  // Esc is Back, unless something inside already used it (the place list, a sheet) or an IME is composing.
  const onEscape = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || programsOpen || confirmLeave) return;
    event.preventDefault();
    back();
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onEscape(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  const submit = () => {
    if (submitted.current) return;
    const unchosen: DraftFieldError[] = (["origins", "destinations"] as const).filter((f) => pending[f].trim() !== "").map((field) => ({ field, code: "unchosen_text" }));
    const order: DraftField[] = ["origins", "destinations", "dates", "cabins", "max_miles"];
    const found = [...unchosen, ...validateDraft(draft, today).filter((e) => !unchosen.some((u) => u.field === e.field))].sort(
      (a, b) => order.indexOf(a.field) - order.indexOf(b.field),
    );
    let resolved: QueryObject | null = null;
    if (found.length === 0) {
      try {
        resolved = resolveDraft(draft, today);
      } catch {
        found.push({ field: "dates", code: "invalid_calendar_date" });
      }
    }
    setErrors(found);
    if (found.length > 0 || !resolved) {
      document.getElementById(FIELD_FOCUS[found[0]!.field])?.focus();
      return;
    }
    // The query carries a sentence that describes it (a rolling window as "next N days"), not the words typed
    // before its fields were edited.
    const query: QueryObject = { ...resolved, raw_text: describeQuery(resolved, draft.dates), language: "en" };
    submitted.current = true;
    void services.workspace.run(query).then(() => services.persist());
    leave();
  };

  const programs = draft.query.programs ?? [];
  // An empty list would filter every row out while meaning "all"; no list is what "All programs" is.
  const toggleProgram = (code: string) => {
    const next = programs.includes(code) ? programs.filter((p) => p !== code) : [...programs, code];
    set({ programs: next.length > 0 ? next : undefined });
  };

  return (
    <div className="query-editor" lang={langTag(locale)}>
      <header className="query-editor-header">
        <IconButton icon="chevron-left" label={EDITOR.back} onClick={back} />
        <h1 ref={heading} tabIndex={-1} className="query-editor-title">
          {EDITOR.title}
        </h1>
      </header>

      <div className="query-editor-body">
        <p className="query-editor-intro">{EDITOR.intro}</p>

        <TextSearch
          primary={false}
          busy={typing.busy}
          error={typing.error}
          errorLang={locale === "en" ? undefined : "en"}
          initial=""
          locale={locale}
          onSearch={(text) => void searchByText(text)}
        />

        <AirportField
          id={FIELD_FOCUS.origins}
          label={EDITOR.origins}
          lang={locale}
          codes={draft.query.origins}
          text={pending.origins}
          onTextChange={(text) => {
            setPending((p) => ({ ...p, origins: text }));
            clear("origins");
          }}
          error={errorFor("origins")}
          onChange={(origins) => {
            set({ origins });
            clear("origins");
          }}
        />
        <AirportField
          id={FIELD_FOCUS.destinations}
          label={EDITOR.destinations}
          lang={locale}
          codes={draft.query.destinations}
          text={pending.destinations}
          onTextChange={(text) => {
            setPending((p) => ({ ...p, destinations: text }));
            clear("destinations");
          }}
          error={errorFor("destinations")}
          onChange={(destinations) => {
            set({ destinations });
            clear("destinations");
          }}
        />
        <DateRuleField
          id={FIELD_FOCUS.dates}
          value={draft.dates}
          today={today}
          locale={locale}
          error={errorFor("dates")}
          onChange={(dates) => {
            setDraft((d) => ({ ...d, dates }));
            clear("dates");
          }}
        />

        <div className="ag-field query-field" role="group" aria-labelledby="query-cabins-label">
          <span id="query-cabins-label" className="ag-field-label">
            {EDITOR.cabins}
          </span>
          <div className="ag-chip-row">
            {CABINS.map((cabin) => (
              <Chip
                key={cabin}
                id={`query-cabin-${cabin}`}
                selected={draft.query.cabins.includes(cabin)}
                aria-describedby={errorFor("cabins") ? "query-cabins-error" : undefined}
                onClick={() => {
                  const cabins = draft.query.cabins.includes(cabin) ? draft.query.cabins.filter((c) => c !== cabin) : [...draft.query.cabins, cabin];
                  set({ cabins });
                  clear("cabins");
                }}
              >
                {cabinName(cabin, locale)}
              </Chip>
            ))}
          </div>
          {errorFor("cabins") ? (
            <p id="query-cabins-error" className="ag-field-error">
              {errorFor("cabins")}
            </p>
          ) : null}
        </div>

        <div className="query-row">
          <label id="query-direct-label" htmlFor="query-direct">
            {EDITOR.direct}
          </label>
          <Switch id="query-direct" aria-labelledby="query-direct-label" checked={draft.query.direct_only} onChange={(on) => set({ direct_only: on })} />
        </div>

        <div className="ag-field query-field">
          <label className="ag-field-label" htmlFor="query-mixed">
            {EDITOR.mixed}
          </label>
          <select
            id="query-mixed"
            className="ag-input"
            value={String(draft.query.min_cabin_pct)}
            aria-describedby="query-mixed-help"
            onChange={(e) => set({ min_cabin_pct: Number(e.target.value) })}
          >
            {EDITOR.mixedOptions.map(([pct, text]) => (
              <option key={pct} value={String(pct)}>
                {text}
              </option>
            ))}
            {EDITOR.mixedOptions.some(([pct]) => pct === draft.query.min_cabin_pct) ? null : (
              <option value={String(draft.query.min_cabin_pct)}>{EDITOR.mixedOther(draft.query.min_cabin_pct)}</option>
            )}
          </select>
          <p id="query-mixed-help" className="ag-field-help">
            {EDITOR.mixedHelp}
          </p>
        </div>

        <button id="query-programs-row" type="button" className="query-row query-row-button" onClick={() => setProgramsOpen(true)}>
          <span>{EDITOR.programs}</span>
          <span className="query-row-value">
            {programs.length === 0 ? EDITOR.programsAll : EDITOR.programsCount(programs.length)}
            <Icon name="chevron-right" size={16} />
          </span>
        </button>

        <section className="query-more" aria-labelledby="query-more-title">
          <h2 id="query-more-title" className="ag-field-label">
            {EDITOR.more}
          </h2>
          <div className="query-row">
            <label id="query-dynamic-label" htmlFor="query-dynamic">
              {EDITOR.dynamic}
            </label>
            <Switch id="query-dynamic" aria-labelledby="query-dynamic-label" checked={draft.query.include_filtered} onChange={(on) => set({ include_filtered: on })} />
          </div>
          <TextField
            id={FIELD_FOCUS.max_miles}
            label={EDITOR.miles}
            type="number"
            inputMode="numeric"
            min={1}
            help={EDITOR.milesHelp}
            error={errorFor("max_miles")}
            value={draft.query.max_miles === undefined ? "" : String(draft.query.max_miles)}
            onChange={(e) => {
              set({ max_miles: e.target.value === "" ? undefined : Number(e.target.value) });
              clear("max_miles");
            }}
          />
        </section>
      </div>

      <footer className="query-editor-footer">
        <Button variant="primary" block onClick={submit}>
          {EDITOR.submit}
        </Button>
        <p className="query-editor-note">{EDITOR.submitNote}</p>
      </footer>

      <Sheet open={programsOpen} title={EDITOR.programs} closeLabel={EDITOR.programsDone} onClose={closePrograms}>
        <p className="ag-field-help">{EDITOR.programsHelp}</p>
        <div className="ag-chip-row">
          <Chip selected={programs.length === 0} onClick={() => set({ programs: undefined })}>
            {EDITOR.programsAll}
          </Chip>
          {SEATS_SOURCES.map((code) => (
            <Chip key={code} variant="filter" selected={programs.includes(code)} onClick={() => toggleProgram(code)}>
              {SOURCE_NAMES[code]}
            </Chip>
          ))}
        </div>
      </Sheet>

      <Sheet open={confirmLeave} title={EDITOR.discardTitle} closeLabel={EDITOR.close} onClose={() => setConfirmLeave(false)}>
        <p>{EDITOR.discardBody}</p>
        <Button variant="primary" block onClick={() => setConfirmLeave(false)}>
          {EDITOR.keepEditing}
        </Button>
        <Button variant="danger" block onClick={leave}>
          {EDITOR.discard}
        </Button>
      </Sheet>
    </div>
  );
}
