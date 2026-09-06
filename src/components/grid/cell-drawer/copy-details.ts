/**
 * "Copy details" (spec §3.5): the drawer's one row rendered as a plain-text block a user can
 * paste into a chat, a note or a booking call. Pure and locale-aware — every number and date
 * goes through the same Intl formatters the drawer draws with, so what is copied is what was
 * on screen. The §4.4 confirmation line travels with the text: the link leaves the app, so the
 * caveat has to leave with it.
 *
 * `copyText` is the only impure part and is kept next to the builder so a caller does not have
 * to know about the textarea fallback (clipboard access needs a secure context; the fallback
 * covers plain-http self-hosting).
 */
import { formatFees, formatLongDate, formatMiles, formatSeats, type FormatLocale } from "@/lib/grid/format";
import { formatAge } from "@/lib/grid/freshness";
import { programDisplayName } from "@/lib/grid/ranking";
import type { AvailabilityRow } from "@/lib/grid/types";
import type { Translate } from "@/lib/i18n";

/**
 * Fees that are not known yet (the row carries no *TotalTaxes; they arrive with Get Trips).
 * An em dash, never the en dash the empty grid cell uses and never a bare blank — "we have no
 * number yet" and "there is nothing here" must not look alike.
 */
export const FEES_PENDING = "—";

/** Fees as the drawer and the copied block both spell them. */
export function drawerFees(row: Pick<AvailabilityRow, "fees_cents" | "currency">, locale: FormatLocale): string {
  return row.fees_cents === null ? FEES_PENDING : formatFees(row.fees_cents, row.currency, locale);
}

export interface CopyDetailsInput {
  row: AvailabilityRow;
  /** Booking or search URL resolved for this row, null when the program has none yet. */
  url: string | null;
  /** Epoch ms the ages are measured against (the page's ticking clock). */
  now: number;
  locale: FormatLocale;
  t: Translate;
}

/**
 * One line per fact, in the order the drawer shows them: route, date, cabin, program, miles,
 * fees, seats, seen-ago, URL, confirmation line. No labels — every line is self-describing
 * ("60,000 miles", "2 seats"), which survives a paste into a plain-text field better than a
 * key/value table would.
 */
export function buildCopyDetails({ row, url, now, locale, t }: CopyDetailsInput): string {
  return [
    `${row.origin} → ${row.dest}`,
    formatLongDate(row.date, locale),
    t(`grid.cabin.${row.cabin}`),
    programDisplayName(row.program),
    `${formatMiles(row.miles, locale)} ${t("grid.cell.miles")}`,
    `${drawerFees(row, locale)} ${t("grid.cell.fees")}`,
    formatSeats(row.seats_left, locale, t),
    t("grid.freshness.updated", { age: formatAge(row.computed_last_seen, now, locale) }),
    url ?? t("grid.drawer.no_link_yet"),
    t("grid.deeplink_caveat"),
  ].join("\n");
}

/**
 * Write `text` to the clipboard. Uses the async Clipboard API where it is available (HTTPS or
 * localhost) and falls back to a hidden textarea + execCommand otherwise. Returns false instead
 * of throwing so the caller can show "Couldn't copy" rather than a broken toast.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the textarea
  }
  if (typeof document === "undefined") return false;
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.setAttribute("aria-hidden", "true");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
