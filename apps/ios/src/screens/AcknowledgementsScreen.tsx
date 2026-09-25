/**
 * Acknowledgements (release handoff §3.5): the open-source software AwardGrid ships, each with the license text it is
 * used under, as MIT, ISC, Apache 2.0 and the OFL ask. The list is src/about/acknowledgements.json, written by
 * scripts/acknowledgements.mjs from the build's own source maps, the pods and the font, and checked against every
 * `pnpm build`, so it names what ships and nothing else.
 *
 * Loaded on demand (App.tsx), so the license texts stay out of the chunk every launch parses. The texts are English
 * and marked so on a Chinese page.
 */
import { useRef } from "react";
import { useOutletContext } from "react-router";
import entries from "../about/acknowledgements.json";
import type { AppServices } from "../app/bootstrap";
import { useFocusOnArrival } from "../app/focus";
import { langTag, useLocale } from "../app/locale";
import { BackToSettings } from "./SettingsScreen";
import { SETTINGS } from "./settings-copy";
import "./settings.css";

export interface Acknowledgement {
  name: string;
  version: string;
  license: string;
  kind: "npm" | "pod" | "font";
  notice: string;
  /** Present when the package shipped no license file and its standard text was written from package.json. */
  noticeFrom?: "package.json";
}

export const ACKNOWLEDGEMENTS: readonly Acknowledgement[] = entries as Acknowledgement[];

export function AcknowledgementsScreen() {
  const services = useOutletContext<AppServices>();
  const locale = useLocale(services);
  const t = SETTINGS[locale];
  const title = useRef<HTMLHeadingElement>(null);
  useFocusOnArrival(title);
  return (
    <div className="ag-settings" lang={langTag(locale)}>
      <BackToSettings label={t.back} from="acknowledgements" />
      <h1 ref={title} tabIndex={-1} className="ag-settings-title">
        {t.acknowledgements.title}
      </h1>
      <p className="ag-settings-copy">{t.acknowledgements.intro}</p>
      <ul className="ag-ack-list">
        {ACKNOWLEDGEMENTS.map((entry) => (
          <li key={entry.name} className="ag-settings-card ag-ack">
            <details>
              <summary>
                <span className="ag-ack-name" lang="en">
                  {entry.name}
                </span>
                <span className="ag-settings-muted">{t.acknowledgements.meta(entry.version, entry.license)}</span>
              </summary>
              <pre className="ag-ack-text" lang="en">
                {entry.notice}
              </pre>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
