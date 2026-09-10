/**
 * Fallback digest formatter — a plain Telegram-HTML rendering of a SnapshotDiff used when the
 * caller does not inject src/lib/notify/format.ts's `formatDigest` (same `DigestFormatter`
 * signature). Kept deliberately small: no i18n dictionary keys (the notify engineer owns
 * those), HTML-escaped, text program names only (kickoff §0.2 #4), ≤ 4096 chars: the number of
 * listed cells is capped and shrunk until the message fits; a grid URL that is itself too long
 * is replaced by the saved-queries page on the same origin.
 */
import { TELEGRAM_MAX_MESSAGE_CHARS } from "@/lib/notify/transport";
import { parseCellKey } from "@awardgrid/core/watch/diff";
import type { CellSnapshot, DigestFormatter, DigestInput } from "./types";

export const DIGEST_MAX_LINES = 25;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function cellLabel(cell: CellSnapshot): string {
  const k = parseCellKey(cell.key);
  if (!k) return cell.key;
  return `${k.origin}→${k.dest} ${k.date} ${k.cabin} · ${k.program}`;
}

function miles(n: number): string {
  return `${n.toLocaleString("en-US")} mi`;
}

function shortUrlFor(gridUrl: string): string {
  try {
    return `${new URL(gridUrl).origin}/queries`;
  } catch {
    return "/queries";
  }
}

export const defaultFormatDigest: DigestFormatter = (input: DigestInput): string => {
  const shrink = (url: string): string => {
    let html = render(input, DIGEST_MAX_LINES, url);
    for (let lines = DIGEST_MAX_LINES - 1; html.length > TELEGRAM_MAX_MESSAGE_CHARS && lines >= 0; lines -= 1) html = render(input, lines, url);
    return html;
  };
  const full = shrink(input.gridUrl);
  return full.length <= TELEGRAM_MAX_MESSAGE_CHARS ? full : shrink(shortUrlFor(input.gridUrl));
};

function render({ savedQuery, diff, locale }: DigestInput, maxLines: number, gridUrl: string): string {
  const zh = locale === "zh";
  const lines: string[] = [`<b>${escapeHtml(savedQuery.name)}</b>`];
  let budget = maxLines;

  if (diff.new.length > 0) {
    lines.push(zh ? `新出现 ${diff.new.length} 个：` : `${diff.new.length} new:`);
    for (const c of diff.new) {
      if (budget-- <= 0) break;
      const seats = c.seats_left > 0 ? ` · ${c.seats_left} ${zh ? "座" : "seats"}` : "";
      lines.push(`• ${escapeHtml(cellLabel(c))} — ${miles(c.miles)}${seats}`);
    }
  }
  if (diff.price_drops.length > 0) {
    lines.push(zh ? `降价 ${diff.price_drops.length} 个：` : `${diff.price_drops.length} cheaper:`);
    for (const d of diff.price_drops) {
      if (budget-- <= 0) break;
      lines.push(`• ${escapeHtml(cellLabel(d.after))} — ${miles(d.before.miles)} → ${miles(d.after.miles)} (−${d.pct}%)`);
    }
  }
  if (budget < 0) lines.push(zh ? "…（更多见表格）" : "… (more in the grid)");
  lines.push(`<a href="${escapeHtml(gridUrl)}">${zh ? "打开表格" : "Open grid"}</a>`);
  lines.push(zh ? "数据：seats.aero" : "Data: seats.aero");
  return lines.join("\n");
}
