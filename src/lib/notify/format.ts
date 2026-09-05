/**
 * Digest formatting for standing-query notifications (kickoff §6: "message = readable list of
 * new/cheaper cells + grid URL").
 *
 * Output is the Telegram HTML subset only: <b>, <i>, <code>, <a href>. Every dynamic field is
 * escaped. Program names are text (SOURCE_NAMES, kickoff §0.2 #4). Never more than
 * MAX_DIGEST_LINES cell lines; the remainder collapses to "+N more".
 *
 * Length guard (ARCHITECTURE §9.5: sendMessage rejects text over 4096 chars): the raw HTML is
 * kept at or under TELEGRAM_MAX_MESSAGE_CHARS — a conservative bound, since Telegram counts
 * characters after entity parsing. Cell lines are dropped first (they fold into "+N more");
 * when the grid URL alone is too long (it embeds the whole QueryObject, `raw_text` included)
 * the link falls back to `shortUrl` — the saved-queries page on the same origin by default.
 */
import { DEEPLINK_CAVEAT, formatAge, programDisplayName } from "@/lib/grid";
import type { AvailabilityRow } from "@/lib/grid/types";
import { t, type Locale } from "@/lib/i18n";
import { TELEGRAM_MAX_MESSAGE_CHARS } from "@/lib/notify/transport";

export const MAX_DIGEST_LINES = 15;

/** Minimal cell shape the digest needs; a full AvailabilityRow satisfies it. */
export type DigestCell = Pick<AvailabilityRow, "program" | "origin" | "dest" | "date" | "cabin" | "miles"> &
  Partial<Pick<AvailabilityRow, "seats_left" | "computed_last_seen" | "direct" | "airlines">>;

export interface PriceDrop {
  /** The cell as it was in the previous run. */
  before: DigestCell;
  /** The same (program, origin, dest, date, cabin) now, with the lower miles. */
  after: DigestCell;
}

export interface DigestDiff {
  new: DigestCell[];
  price_drops: PriceDrop[];
  /** Cells present last run and gone now — reported as a count only. */
  dropped: DigestCell[];
}

export interface FormatDigestInput {
  savedQuery: { name: string };
  diff: DigestDiff;
  locale: Locale;
  gridUrl: string;
  /** ISO timestamp (or epoch ms / Date) used for the "(2h ago)" ages. */
  now: string | number | Date;
  /** Link used when `gridUrl` does not fit in a message; defaults to `<origin of gridUrl>/queries`. */
  shortUrl?: string;
  /** Message size cap (raw HTML chars); defaults to Telegram's 4096. */
  maxChars?: number;
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

/** Escape for Telegram HTML (and for attribute values). */
export function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? "").replace(/[&<>"]/g, (c) => ESCAPES[c] ?? c);
}

/** 80000 → "80k", 57500 → "57.5k", 950 → "950". */
export function formatMiles(miles: number): string {
  if (!Number.isFinite(miles)) return "?";
  if (miles < 1000) return String(Math.round(miles));
  const k = miles / 1000;
  const rounded = Math.round(k * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}k`;
}

/** "2026-10-15" → "10-15"; anything unparseable is returned as-is. */
export function shortDate(date: string): string {
  const m = /^\d{4}-(\d{2}-\d{2})$/.exec(date);
  return m?.[1] ?? date;
}

function tail(cell: DigestCell, locale: Locale, now: FormatDigestInput["now"]): string {
  const parts: string[] = [];
  if (cell.seats_left && cell.seats_left > 0) parts.push(t(locale, "notify.digest.seats", { n: cell.seats_left }));
  const program = programDisplayName(cell.program);
  const age = cell.computed_last_seen ? ` (${formatAge(cell.computed_last_seen, now, locale)})` : "";
  parts.push(`${program}${age}`);
  return parts.map(escapeHtml).join(" · ");
}

function head(cell: DigestCell): string {
  return escapeHtml(`${cell.origin}→${cell.dest} ${shortDate(cell.date)} ${cell.cabin}`);
}

/** "HKG→SEA 10-15 F 80k · 2 seats · Alaska Mileage Plan (2h ago)" */
export function formatNewCellLine(cell: DigestCell, locale: Locale, now: FormatDigestInput["now"]): string {
  return `${head(cell)} <b>${escapeHtml(formatMiles(cell.miles))}</b> · ${tail(cell, locale, now)}`;
}

/** "HKG→SEA 10-15 F ↓ 95k→80k (-16%) · Alaska Mileage Plan (2h ago)" */
export function formatDropLine(drop: PriceDrop, locale: Locale, now: FormatDigestInput["now"]): string {
  const { before, after } = drop;
  const pct = before.miles > 0 ? Math.round(((before.miles - after.miles) / before.miles) * 100) : 0;
  const change = `↓ ${formatMiles(before.miles)}→${formatMiles(after.miles)} (-${pct}%)`;
  return `${head(after)} <b>${escapeHtml(change)}</b> · ${tail(after, locale, now)}`;
}

export function digestCaveat(locale: Locale): string {
  return locale === "zh" ? t("zh", "footer.caveat") : DEEPLINK_CAVEAT;
}

/** `https://host/grid?q=…` → `https://host/queries`; a relative or unparseable URL → "/queries". */
export function defaultShortUrl(gridUrl: string): string {
  try {
    return `${new URL(gridUrl).origin}/queries`;
  } catch {
    return "/queries";
  }
}

/**
 * Full digest. Sections appear only when non-empty. Structure:
 *   <b>awardgrid · {name}</b>
 *   <b>{n} new</b> / lines…
 *   <b>{n} cheaper</b> / lines…
 *   +N more
 *   {n} no longer available
 *   <a href="gridUrl">Open grid</a> · Data: seats.aero
 *   <i>caveat</i>
 */
export function formatDigest(input: FormatDigestInput): string {
  const max = input.maxChars ?? TELEGRAM_MAX_MESSAGE_CHARS;
  const fits = (html: string): boolean => html.length <= max;
  const shrink = (url: string): string => {
    let html = renderDigest(input, MAX_DIGEST_LINES, url);
    for (let lines = MAX_DIGEST_LINES - 1; !fits(html) && lines >= 0; lines -= 1) html = renderDigest(input, lines, url);
    return html;
  };
  const full = shrink(input.gridUrl);
  if (fits(full)) return full;
  return shrink(input.shortUrl ?? defaultShortUrl(input.gridUrl));
}

function renderDigest(input: FormatDigestInput, maxLines: number, gridUrl: string): string {
  const { locale, now, diff } = input;
  const out: string[] = [`<b>${escapeHtml(t(locale, "notify.digest.title", { name: input.savedQuery.name }))}</b>`];

  const budget = { left: maxLines, hidden: 0 };
  const take = <T>(items: T[], render: (item: T) => string, header: string): void => {
    if (items.length === 0) return;
    out.push(`<b>${escapeHtml(header)}</b>`);
    for (const item of items) {
      if (budget.left <= 0) {
        budget.hidden += 1;
        continue;
      }
      out.push(render(item));
      budget.left -= 1;
    }
  };

  take(diff.new, (c) => formatNewCellLine(c, locale, now), t(locale, "notify.digest.new_header", { n: diff.new.length }));
  take(
    diff.price_drops,
    (d) => formatDropLine(d, locale, now),
    t(locale, "notify.digest.drops_header", { n: diff.price_drops.length }),
  );
  if (budget.hidden > 0) out.push(escapeHtml(t(locale, "notify.digest.more", { n: budget.hidden })));
  if (diff.dropped.length > 0) out.push(escapeHtml(t(locale, "notify.digest.dropped", { n: diff.dropped.length })));

  out.push(
    `<a href="${escapeHtml(gridUrl)}">${escapeHtml(t(locale, "notify.digest.open_grid"))}</a> · ${escapeHtml(
      t(locale, "notify.digest.attribution"),
    )}`,
  );
  out.push(`<i>${escapeHtml(digestCaveat(locale))}</i>`);
  return out.join("\n");
}
