/**
 * Saved › Trip plans (release plan step 18): the plans kept on this device, newest first, each shown as it was read
 * (./PlanView.tsx) with when it was saved. Not drawn while there are none, so Saved reads as it did before plans.
 *
 * A plan's action depends on the data source: with one connected (the person's seats.aero account, or sample data in
 * sample mode) it is "Search", which runs the plan on the Search screen; with none, "Try with sample data", which
 * switches to sample data and searches it there. Plans whose dates have all passed cannot be run, and say why. Deleting
 * is the Saved screen's (with its undo), passed in.
 */
import { useSyncExternalStore } from "react";
import type { AppServices } from "../../app/bootstrap";
import { isSample } from "../../app/data-source";
import { localDate } from "../../app/local-date";
import type { Locale } from "../../app/locale";
import { routeLabel } from "@awardgrid/core/workspace/present";
import { SAMPLE } from "../../sample/sample-copy";
import { FAVORITES } from "../../screens/favorites-copy";
import type { PlanV1 } from "../../store/plans-store";
import { Button, Notice } from "../ui";
import { PLAN } from "./plan-copy";
import { planName, planPast } from "./plan-facts";
import { SAVED_PLANS_TITLE } from "./PlanSearch";
import { PlanView, usePlanActions } from "./PlanView";

/** A kept plan's heading id: where focus goes when its deletion is undone. */
export const planTitleId = (id: string) => `plan-title-${id}`;

export interface SavedPlansProps {
  services: AppServices;
  locale: Locale;
  /** Whether a data source is connected; null until the key store has answered (no action is offered until then). */
  hasKey: boolean | null;
  /** The plan being deleted, if any. */
  busy: string | null;
  onRemove: (plan: PlanV1) => void;
}

export function SavedPlans({ services, locale, hasKey, busy, onRemove }: SavedPlansProps) {
  const plans = useSyncExternalStore(services.plans.subscribe, services.plans.all, services.plans.all);
  const p = PLAN[locale];
  const actions = usePlanActions(services, locale);
  const readOnly = services.plans.isReadOnly();
  const unreadable = services.plans.unreadableCount();
  if (plans.length === 0 && !readOnly && unreadable === 0) return null;
  const usage = services.plans.usage();
  const today = localDate(services.now());
  // What the plans' action does, said once: through the account, on the sample data, or by switching to it.
  const note = hasKey === null ? null : hasKey ? (isSample(services) ? SAMPLE[locale].savedSearchAgain : p.searchNote) : p.tryNote;
  return (
    <section className="ag-saved-plans" aria-labelledby={SAVED_PLANS_TITLE} data-testid="saved-plans">
      <h2 id={SAVED_PLANS_TITLE} tabIndex={-1} className="ag-saved-section-title">
        {p.plansTitle}
      </h2>
      <p className="ag-saved-intro">{p.plansIntro}</p>
      {readOnly ? <Notice tone="warning">{p.readOnly}</Notice> : null}
      {unreadable > 0 ? <Notice tone="warning">{p.unreadable(unreadable)}</Notice> : null}
      {usage.count > 0 ? <p className="ag-saved-usage tabular">{p.usage(usage.count, usage.maxItems)}</p> : null}
      {plans.length > 0 && note ? <p className="ag-saved-intro">{note}</p> : null}
      {actions.failed ? (
        <p role="alert" className="ag-callout ag-callout-danger">
          {actions.failed}
        </p>
      ) : null}
      {plans.length > 0 ? (
        <ul className="ag-saved-list">
          {plans.map((plan) => {
            const name = planName(plan.query, locale);
            const past = planPast(plan.query, today);
            const blocked = past === "all";
            return (
              <li key={plan.id}>
                <PlanView
                  plan={plan}
                  locale={locale}
                  today={today}
                  heading={{ level: 3, text: routeLabel(plan.query, locale), id: planTitleId(plan.id) }}
                  savedAt={plan.savedAt}
                  className="ag-saved-card"
                  testId="plan-card"
                >
                  {hasKey === true ? (
                    <Button aria-label={p.searchName(name)} disabled={blocked} disabledReason={blocked ? p.pastBlocked : null} onClick={() => actions.search(plan)}>
                      {p.search}
                    </Button>
                  ) : hasKey === false ? (
                    <Button
                      aria-label={p.tryName(name)}
                      disabled={blocked}
                      disabledReason={blocked ? p.pastBlocked : null}
                      loading={actions.trying === plan.id}
                      loadingLabel={SAMPLE[locale].opening}
                      onClick={() => actions.trySample(plan, plan.id)}
                    >
                      {SAMPLE[locale].tryIt}
                    </Button>
                  ) : null}
                  <Button variant="danger" aria-label={p.removeName(name)} loading={busy === plan.id} onClick={() => onRemove(plan)}>
                    {FAVORITES[locale].remove}
                  </Button>
                </PlanView>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
