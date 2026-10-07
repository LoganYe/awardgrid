/**
 * "Data: seats.aero" over results that came from seats.aero (LEGAL.md: every screen that shows award data carries the
 * attribution), with "seats.aero" a link to https://seats.aero, beside the data it names. Like Settings' links to the
 * site's pages, it opens in Safari (`target="_blank"`, which Capacitor hands to the system), and a screen reader hears
 * that it does. The sentence is the caller's (core's approved `data.source`, or the chrome's own line); only the name
 * inside it becomes the link.
 *
 * Only over seats.aero's data: not on Settings, not on the example, and not over sample data.
 */
import type { ElementType } from "react";
import { SEATS_AERO_URL } from "../app/links";
import type { Locale } from "../app/locale";
import { SETTINGS } from "../screens/settings-copy";
import "./results/results.css";

const NAME = "seats.aero";

export function SeatsAttribution({ text, locale, as: Tag = "p", className }: { text: string; locale: Locale; as?: ElementType; className?: string }) {
  const at = text.indexOf(NAME);
  if (at < 0) return <Tag className={className}>{text}</Tag>;
  return (
    <Tag className={className}>
      {text.slice(0, at)}
      <a className="ag-attribution-link" href={SEATS_AERO_URL} target="_blank" rel="noreferrer noopener">
        {NAME}
        <span className="sr-only"> {SETTINGS[locale].opensInSafari}</span>
      </a>
      {text.slice(at + NAME.length)}
    </Tag>
  );
}
