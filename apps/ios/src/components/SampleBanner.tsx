/**
 * The banner on every screen of sample mode (release plan step 17): "Sample data", the approved sentence under it
 * (core present.ts `demo.synthetic`, which the Review Notes quote), and "Exit sample data", which goes back to the
 * account: the choice is kept, sample/ is deleted and the app starts again on the person's own data.
 *
 * A labelled region, not an alert: it is read where it stands, and never announced again on its own. Nothing in live
 * mode: the component renders nothing there.
 */
import { copy } from "@awardgrid/core/workspace/present";
import { useId, useState } from "react";
import type { AppServices } from "../app/bootstrap";
import { isSample } from "../app/data-source";
import { type Locale, langTag } from "../app/locale";
import { SAMPLE } from "../sample/sample-copy";
import { Button } from "./ui";
import "./sample.css";

export function SampleBanner({ services, locale, className }: { services: Pick<AppServices, "dataSource">; locale: Locale; className?: string }) {
  const s = SAMPLE[locale];
  const title = useId();
  const [leaving, setLeaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  if (!isSample(services)) return null;
  const exit = async () => {
    setLeaving(true);
    setFailed(null);
    try {
      await services.dataSource.exitSample();
    } catch (err) {
      setFailed(s.switchFailed(err instanceof Error ? err.message || err.name : String(err)));
      setLeaving(false);
    }
  };
  return (
    <section className={["ag-sample-banner", className].filter(Boolean).join(" ")} aria-labelledby={title} data-testid="sample-banner" lang={langTag(locale)}>
      <div className="ag-sample-banner-text">
        <p className="ag-sample-banner-title" id={title}>
          {s.title}
        </p>
        <p className="ag-sample-banner-note">{copy("demo.synthetic", locale)}</p>
      </div>
      <Button className="ag-sample-banner-exit" onClick={() => void exit()} loading={leaving} loadingLabel={s.exiting}>
        {s.exit}
      </Button>
      {failed ? (
        <p role="alert" className="ag-sample-banner-failed">
          {failed}
        </p>
      ) : null}
    </section>
  );
}
