"use client";

/**
 * The cost meter (spec §3.6): "Today $0.42 of $2.00", refreshed after every answer from
 * GET /api/ask/usage. At the cap it also states the reason and the reset time, and the drawer
 * disables the input.
 *
 * This is the operator's own daily cap on the ask lane, not a price to the user: there is no
 * money or paywall logic anywhere in the product (§0.1).
 */
import type { AskUsageResponse } from "@/app/api/ask/wire";
import { formatUsd } from "@/components/ask/context";
import { useLocale, useT } from "@/lib/i18n/client";
import { intlLocale } from "@/lib/grid/format";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * "Oct 7, 00:00 UTC" — the cap resets at UTC midnight. `hourCycle: "h23"` keeps it 00:00 rather
 * than "12:00 AM", which is what makes the sentence readable without a "(midnight UTC)" gloss.
 */
export function formatReset(iso: string, locale: Locale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "00:00 UTC";
  return d.toLocaleString(intlLocale(locale), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC", timeZoneName: "short" });
}

/** True when the lane has nothing left today (the input is disabled and says why). */
export function atCap(usage: AskUsageResponse | null): boolean {
  return usage !== null && usage.capUsd > 0 && usage.remainingUsd <= 0;
}

export interface CostMeterProps {
  usage: AskUsageResponse | null;
  className?: string;
  /** The drawer points the disabled prompt box's `aria-describedby` here at the cap (§3.6). */
  id?: string;
}

export function CostMeter({ usage, className, id }: CostMeterProps) {
  const t = useT();
  const locale = useLocale();
  if (!usage) return null;
  const capped = atCap(usage);
  return (
    // At the cap the reason is its own line: run on to the meter and the two sentences read as
    // one ("Today $2.00 of $2.00 Today's Ask budget…").
    <p id={id} className={cn("t-meta", capped ? "text-error" : "text-fg-muted", className)} data-testid="ask-cost-meter">
      <span className="block">{t("ask.footer.today", { spent: formatUsd(usage.spentUsd), cap: formatUsd(usage.capUsd) })}</span>
      {capped && <span className="block">{t("ask.budget", { cap: formatUsd(usage.capUsd), resetAt: formatReset(usage.resetAt, locale) })}</span>}
    </p>
  );
}
