/**
 * The one link an option's details may send the user out on (UI/UX v1 T10; docs/03 §4; spec §13 "外跳"). A tap on
 * it leaves the app for the program's website (Capacitor hands new-window navigation to Safari), so a link is made
 * only from what seats.aero returned for this option, or from a program search page this code builds itself, and
 * only when it is plainly a website:
 *
 *   - https:// only — never javascript:, data:, capacitor: or plain http;
 *   - none of whitespace, `<>"'\` (the Ask link rule, core ask/markdown.ts: a backslash is "/" to the URL parser,
 *     so `/\evil.invalid` would resolve off-site);
 *   - no user name or password, and a named host of at least two labels (a trailing root dot is ignored, so
 *     `localhost.` is still localhost) — not localhost, not an IP address.
 *
 * The URL is kept exactly as given, never normalised or rebuilt, and its host is returned so the button can say
 * where it goes. Anything else is no link: the details then offer to copy the search.
 */
import type { AvailabilityRow } from "../types";
import { hasProgramBuilder, resolveDeeplink } from "./index";

export interface TrustedLink {
  url: string;
  host: string;
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
/** Two or more ASCII labels (punycode included), letters in the last. */
const HOSTNAME = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9]$/i;

export function trustedExternalLink(raw: string | null | undefined): TrustedLink | null {
  if (typeof raw !== "string") return null;
  const url = raw.trim();
  if (url.length === 0 || url !== raw || /[\s<>"'\\]/.test(url)) return null;
  if (!url.startsWith("https://")) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") return null;
  const host = parsed.hostname.replace(/\.$/, "");
  if (!HOSTNAME.test(host) || IPV4.test(host) || host === "localhost" || host.endsWith(".localhost")) return null;
  return { url, host: parsed.host };
}

/**
 * The details' outbound link: seats.aero's primary booking link for this option (the first link when none is flagged,
 * the rule core seatsaero/normalize.ts tripsToFees uses), else the row's own booking link, else a program search page
 * this code builds (American only) — the first of them that is trusted. Null when none is. seats.aero's other booking
 * links are for other programs (a LifeMiles option also lists "Book via Aeroplan"), so they are never this option's.
 */
export function detailLink(row: AvailabilityRow, bookingLinks: ReadonlyArray<{ label?: string; link: string; primary: boolean }>): TrustedLink | null {
  const own = bookingLinks.find((l) => l.primary) ?? (bookingLinks.some((l) => l.primary) ? undefined : bookingLinks[0]);
  for (const candidate of [own?.link, row.booking_url]) {
    const link = trustedExternalLink(candidate);
    if (link) return link;
  }
  if (hasProgramBuilder(row.program)) return trustedExternalLink(resolveDeeplink({ ...row, booking_url: null }).url);
  return null;
}
