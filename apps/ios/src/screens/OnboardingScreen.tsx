/**
 * The first run (UI/UX v1 T11; docs/04 S08; spec §16 "首次配置"; release plan step 17): one screen, shown where the
 * Search screen would be while there is no seats.aero key — what the app does, then "Try with sample data" first and
 * "Connect your seats.aero account" second. Nothing is forced and nothing comes back once a key is saved. The Anthropic
 * key is not asked for here: it waits for the first AI entry.
 *
 * "Try with sample data" switches the whole app to sample mode (app/data-source.ts): every feature, on any route the
 * app knows, on made-up data that every screen labels as such. It replaces the old static example: `#/example` now
 * enters sample mode too (EnterSample), so an old link still leads somewhere useful.
 */
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useOutletContext } from "react-router";
import type { AppServices } from "../app/bootstrap";
import { isSample } from "../app/data-source";
import { CAN_CONNECT } from "../app/flags";
import { type Locale, langTag, useLocale } from "../app/locale";
import { RESULTS } from "../components/results/copy";
import { Button } from "../components/ui";
import { SAMPLE } from "../sample/sample-copy";

export const WELCOME: Record<Locale, { value: string; connect: string }> = {
  en: {
    value: "Find award seats across programs, from your own seats.aero account. Every result says what is known and what is not.",
    connect: "Connect your seats.aero account",
  },
  zh: {
    value: "通过你自己的 seats.aero 账户跨计划查找兑换座位，每条结果都写明已知与未知。",
    connect: "连接你的 seats.aero 账户",
  },
};

/** Switch to sample mode, saying so while it happens and what went wrong if it could not. */
export function useEnterSample(services: Pick<AppServices, "dataSource">, locale: Locale): { busy: boolean; failed: string | null; enter: () => void } {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const enter = () => {
    if (busy) return;
    setBusy(true);
    setFailed(null);
    services.dataSource.enterSample().catch((err: unknown) => {
      setFailed(SAMPLE[locale].switchFailed(err instanceof Error ? err.message || err.name : String(err)));
      setBusy(false);
    });
  };
  return { busy, failed, enter };
}

/** The one first-run screen, inside the Search screen while there is no seats.aero key. */
export function Welcome({ locale, onTrySample, busy = false, failed = null }: { locale: Locale; onTrySample: () => void; busy?: boolean; failed?: string | null }) {
  const w = WELCOME[locale];
  const s = SAMPLE[locale];
  return (
    <div className="ag-welcome" data-testid="welcome">
      <p className="ag-welcome-value">{w.value}</p>
      <Button id="welcome-sample" variant="primary" block onClick={onTrySample} loading={busy} loadingLabel={s.opening}>
        {s.tryIt}
      </Button>
      {/* Not in a build without a connection (VITE_AG_CONNECT=0, app/flags.ts). */}
      {CAN_CONNECT ? (
        <Link to="/settings/seats" className="ag-button ag-button-block">
          {w.connect}
        </Link>
      ) : null}
      {failed ? (
        <p role="alert" className="ag-callout ag-callout-danger">
          {failed}
        </p>
      ) : null}
    </div>
  );
}

/**
 * `#/example`: the old example's address, which now enters sample mode. Already in sample mode, it opens Search. A
 * switch that fails says why, with the way back to Search.
 */
export function EnterSample() {
  const services = useOutletContext<AppServices>();
  const locale = useLocale(services);
  const sample = isSample(services);
  const { failed, enter } = useEnterSample(services, locale);
  const started = useRef(false);
  useEffect(() => {
    if (sample || started.current) return;
    started.current = true;
    enter();
  }, [sample, enter]);
  if (sample) return <Navigate to="/" replace />;
  return (
    <div className="ag-welcome" lang={langTag(locale)}>
      <p className="ag-welcome-value" role="status">
        {failed ? "" : SAMPLE[locale].opening}
      </p>
      {failed ? (
        <>
          <p role="alert" className="ag-callout ag-callout-danger">
            {failed}
          </p>
          <Link to="/" className="ag-button ag-button-block">
            {RESULTS[locale].tabs.search}
          </Link>
        </>
      ) : null}
    </div>
  );
}
