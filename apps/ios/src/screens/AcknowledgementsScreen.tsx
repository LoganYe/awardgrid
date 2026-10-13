/**
 * Acknowledgements (release handoff §3.5): the open-source software AwardGrid ships, each with the license text it is
 * used under, as MIT, ISC, Apache 2.0 and the OFL ask. The list is src/about/acknowledgements.json, written by
 * scripts/acknowledgements.mjs from the build's own source maps, the pods and the font, and checked against every
 * `pnpm build`, so it names what ships and nothing else. The App Store build (app/flags.ts STORE) has no Ask and ships
 * fewer packages, so it has a list of its own, acknowledgements.store.json, checked by every `npm run build:store`.
 *
 * Loaded on demand (App.tsx), so the license texts stay out of the chunk every launch parses. The texts are English
 * and marked so on a Chinese page.
 */
import { useRef } from "react";
import { useOutletContext } from "react-router";
import defaultEntries from "../about/acknowledgements.json";
import storeEntries from "../about/acknowledgements.store.json";
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

/**
 * This build's list. The condition is written out, as App.tsx's ASK_BUILT is, so each build carries its own list and
 * not the other: the App Store bundle names no package it does not ship (scripts/check-store-bundle.mjs).
 */
export const ACKNOWLEDGEMENTS: readonly Acknowledgement[] = (import.meta.env.VITE_AG_STORE === "1" ? storeEntries : defaultEntries) as Acknowledgement[];

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
