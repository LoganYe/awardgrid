/**
 * A trip plan on screen (release plan step 18): what was typed, and what AwardGrid read from it — the places on each
 * side with their airports (a metro the parser expanded is shown as that metro, core places seed), the dates with
 * their year and how many days they span, the cabins, any other condition, and what the parser said about the text,
 * in the screen's language. Dates that have passed are said. The actions are the caller's.
 *
 * Shown by the Search screen's planner while no data source is connected (./PlanSearch.tsx) and by Saved for each kept
 * plan (./SavedPlans.tsx). Nothing here fetches or writes: a plan is a search not yet run.
 *
 * `usePlanActions` is what a plan's actions do: "Search" runs it through the connected data source as a typed search
 * would, on the Search screen; "Try with sample data" switches to sample data and searches it there.
 */
import { type ReactNode, useState } from "react";
import { useNavigate } from "react-router";
import type { AppServices } from "../../app/bootstrap";
import { type Locale, langTag } from "../../app/locale";
import { shortDateTime } from "../../app/when";
import { SAMPLE } from "../../sample/sample-copy";
import { FAVORITES } from "../../screens/favorites-copy";
import type { PlanDraft } from "../../store/plans-store";
import { Notice } from "../ui";
import { PLAN, planNoticeText } from "./plan-copy";
import { planCabins, planConditions, planDatesLine, planPast, planPlaceText, planPlaces } from "./plan-facts";
import "./plan.css";

export interface PlanViewProps {
  plan: PlanDraft;
  locale: Locale;
  /** Today (YYYY-MM-DD, this device's calendar day: app/local-date.ts), for saying which dates have passed. */
  today: string;
  /** The plan's heading: its level under the page's, its words, and its id (the plan section is named by it). */
  heading: { level: 2 | 3; text: string; id: string };
  /** When a kept plan was saved. */
  savedAt?: string | null;
  /** A plan just read: say it was read on this device and nothing was sent. */
  justRead?: boolean;
  /** A sentence under the actions: what they do. */
  note?: string | null;
  className?: string;
  testId?: string;
  /** The actions. */
  children?: ReactNode;
}

function PlaceList({ airports, locale }: { airports: readonly string[]; locale: Locale }) {
  return (
    <ul className="ag-plan-places">
      {planPlaces(airports, locale).map((place) => (
        <li key={place.code}>{planPlaceText(place, locale)}</li>
      ))}
    </ul>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="ag-plan-fact">
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function PlanView({ plan, locale, today, heading, savedAt = null, justRead = false, note = null, className, testId = "plan-view", children }: PlanViewProps) {
  const p = PLAN[locale];
  const q = plan.query;
  const Heading = heading.level === 2 ? "h2" : "h3";
  const past = planPast(q, today);
  const conditions = planConditions(q, locale);
  return (
    <section className={["ag-plan", className].filter(Boolean).join(" ")} aria-labelledby={heading.id} data-testid={testId}>
      <Heading id={heading.id} className="ag-plan-title" tabIndex={-1}>
        {heading.text}
      </Heading>
      <p className="ag-plan-typed">
        {p.typed}
        {locale === "zh" ? "：" : ": "}
        <q lang={langTag(q.language === "zh" ? "zh" : "en")}>{plan.text}</q>
      </p>
      <dl className="ag-plan-facts">
        <Fact term={p.from}>
          <PlaceList airports={q.origins} locale={locale} />
        </Fact>
        <Fact term={p.to}>
          <PlaceList airports={q.destinations} locale={locale} />
        </Fact>
        <Fact term={p.dates}>
          <span className="tabular">{planDatesLine(q, locale)}</span>
        </Fact>
        <Fact term={p.cabins}>{planCabins(q.cabins, locale)}</Fact>
        {conditions.length > 0 ? <Fact term={p.also}>{conditions.join(" · ")}</Fact> : null}
      </dl>
      {savedAt ? <p className="ag-plan-meta tabular">{FAVORITES[locale].savedAt(shortDateTime(savedAt, locale))}</p> : null}
      {justRead ? <p className="ag-plan-meta">{p.readNote}</p> : null}
      {plan.notices.length > 0 || past ? (
        <div className="ag-plan-notes" data-testid="plan-notices">
          {plan.notices.map((notice, i) => {
            const said = planNoticeText(notice, locale);
            return (
              <Notice key={`${notice.code}-${i}`} tone="info">
                <span lang={said.lang}>{said.text}</span>
              </Notice>
            );
          })}
          {past ? <Notice tone="warning">{past === "all" ? p.pastAll : p.pastSome}</Notice> : null}
        </div>
      ) : null}
      {children ? <div className="ag-plan-actions">{children}</div> : null}
      {note ? <p className="ag-plan-meta">{note}</p> : null}
    </section>
  );
}

/** What a plan's actions do, for the screen that shows them. */
export function usePlanActions(services: Pick<AppServices, "runParsed" | "persist" | "dataSource">, locale: Locale) {
  const navigate = useNavigate();
  // Which plan is being tried on sample data (the app boots again when it is), and why a switch could not be made.
  const [trying, setTrying] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  /** Search it through the connected data source, on the Search screen, as a typed search would run. */
  const search = (plan: PlanDraft) => {
    void services.runParsed(plan.text, { query: plan.query, warnings: [], notices: [] }).then(() => services.persist());
    navigate("/", { state: { focus: "search-title" } });
  };

  /** Switch to sample data, then search it there (app/data-source.ts SampleStart). */
  const trySample = (plan: PlanDraft, key: string) => {
    if (trying) return;
    setTrying(key);
    setFailed(null);
    services.dataSource.enterSample({ text: plan.text, query: plan.query }).catch((err: unknown) => {
      setFailed(SAMPLE[locale].switchFailed(err instanceof Error ? err.message || err.name : String(err)));
      setTrying(null);
    });
  };

  return { search, trySample, trying, failed };
}
