/**
 * The Search screen's trip planner (release plan step 18), under the first run's welcome while no data source is
 * connected: the same text box as a search, read by the same deterministic parser (AppServices.parsePlan, no key
 * asked for), and shown as a plan (./PlanView.tsx) instead of being run. Nothing is sent.
 *
 * The plan can be saved on this device (Saved › Trip plans), or tried on sample data, which switches to sample data and
 * searches it there. A text the parser cannot read says why under the box, in the screen's language.
 */
import { useState } from "react";
import { Link } from "react-router";
import type { AppServices } from "../../app/bootstrap";
import { localDate } from "../../app/local-date";
import type { Locale } from "../../app/locale";
import { WithTail } from "../../app/WithTail";
import { SAMPLE } from "../../sample/sample-copy";
import { FAVORITES } from "../../screens/favorites-copy";
import type { ApiFailure } from "../../search/search";
import { type PlanDraft, planFromDraft } from "../../store/plans-store";
import { TextSearch } from "../query/TextSearch";
import { Button } from "../ui";
import { PLAN, planNoticeText } from "./plan-copy";
import { planName, planPast } from "./plan-facts";
import { PlanView, usePlanActions } from "./PlanView";

/** The plan's heading, where focus goes once a text has been read. */
export const PLAN_TITLE = "plan-title";
/** Saved › Trip plans' heading, where "View in Saved" lands. */
export const SAVED_PLANS_TITLE = "saved-plans-title";

/** Why a text could not be read: the parser's notice in the screen's language, else the engine's own English words. */
export function planFailureText(failure: ApiFailure, locale: Locale): { text: string; lang?: "en" } {
  if (failure.notice) return planNoticeText(failure.notice, locale, failure.missing ?? []);
  return { text: failure.message ?? failure.error, lang: locale === "en" ? undefined : "en" };
}

export function PlanSearch({ services, locale }: { services: AppServices; locale: Locale }) {
  const p = PLAN[locale];
  const [reading, setReading] = useState(false);
  const [plan, setPlan] = useState<PlanDraft | null>(null);
  const [error, setError] = useState<{ text: string; lang?: "en" } | null>(null);
  const [saving, setSaving] = useState(false);
  // What saving said, about the plan on screen; a plan read again is not "saved".
  const [said, setSaid] = useState<{ text: string; ok: boolean; tail?: string } | null>(null);
  const actions = usePlanActions(services, locale);
  const today = localDate(services.now());

  const read = async (text: string) => {
    setReading(true);
    setSaid(null);
    const result = await services.parsePlan(text);
    setReading(false);
    if (!result.ok) {
      setPlan(null);
      setError(planFailureText(result, locale));
      return;
    }
    setError(null);
    setPlan({ text: text.trim(), query: result.value.query, notices: result.value.notices });
    // What was read is the next thing to look at: focus goes to the plan's heading.
    window.requestAnimationFrame(() => document.getElementById(PLAN_TITLE)?.focus());
  };

  const save = async () => {
    if (!plan || saving) return;
    setSaving(true);
    setSaid(null);
    const result = await services.plans.save(planFromDraft(plan, services.now().toISOString(), `plan-${crypto.randomUUID()}`));
    setSaving(false);
    if (result.ok) setSaid({ text: result.already ? p.alreadySaved : p.saved, ok: true });
    else if (result.reason === "write_failed") setSaid({ text: p.writeFailed(result.message), ok: false, tail: result.message });
    else setSaid({ text: result.reason === "capacity" ? p.full(services.plans.usage().maxItems) : p.readOnly, ok: false });
  };

  const past = plan ? planPast(plan.query, today) : null;
  return (
    <section className="ag-planner" aria-labelledby="planner-title" data-testid="planner">
      <h2 id="planner-title" className="ag-planner-title">
        {p.section}
      </h2>
      <p className="ag-planner-intro">{p.intro}</p>
      <TextSearch
        locale={locale}
        busy={reading}
        primary={false}
        onSearch={(text) => void read(text)}
        error={error?.text ?? null}
        errorLang={error?.lang}
        words={{ label: p.label, run: p.run, running: p.running }}
        runTestId="plan-run"
      />
      {plan ? (
        <PlanView plan={plan} locale={locale} today={today} heading={{ level: 3, text: p.title, id: PLAN_TITLE }} justRead note={p.tryNote}>
          <Button onClick={() => void save()} loading={saving} loadingLabel={p.saving}>
            {p.save}
          </Button>
          <Button
            onClick={() => actions.trySample(plan, "draft")}
            loading={actions.trying === "draft"}
            loadingLabel={SAMPLE[locale].opening}
            aria-label={p.tryName(planName(plan.query, locale))}
            disabled={past === "all"}
            disabledReason={past === "all" ? p.pastBlocked : null}
          >
            {SAMPLE[locale].tryIt}
          </Button>
        </PlanView>
      ) : null}
      {/* Always in the tree, so saving is announced; a failure is an alert of its own. */}
      <p role="status" className="ag-plan-status">
        {said?.ok ? (
          <>
            {said.text}{" "}
            <Link to="/saved" state={{ focus: SAVED_PLANS_TITLE }} className="ag-results-link">
              {FAVORITES[locale].viewSaved}
            </Link>
          </>
        ) : null}
      </p>
      {said && !said.ok ? (
        <p role="alert" className="ag-callout ag-callout-danger">
          <WithTail text={said.text} tail={said.tail} tailLang={locale === "en" ? undefined : "en"} />
        </p>
      ) : null}
      {actions.failed ? (
        <p role="alert" className="ag-callout ag-callout-danger">
          {actions.failed}
        </p>
      ) : null}
    </section>
  );
}
