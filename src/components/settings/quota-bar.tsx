"use client";

/**
 * Today's seats.aero call count for the signed-in user against awardgrid's soft limit (950 of
 * the 1,000/day Pro allowance). Same three states as the top-bar indicator (§4.7): neutral
 * below 800, `--aging` from 800, `--error` from the soft limit. The state is spelled out in the
 * text as well as drawn, so color never carries it alone. Pure presentation; the figures come
 * from getTodayUsage() in the server page.
 */
import { stateFor, type QuotaState } from "@/components/shell/quota-indicator-state";
import { htmlLang } from "@awardgrid/core/i18n";
import { useLocale, useT } from "@awardgrid/core/i18n/client";
import { cn } from "@/lib/utils";

export interface QuotaView {
  used: number;
  limit: number;
  hardLimit: number;
  /** ISO timestamp of the next reset (UTC midnight). */
  resetAt: string;
}

const FILL_CLASS: Record<QuotaState, string> = {
  ok: "bg-fg",
  warn: "bg-aging",
  exceeded: "bg-error",
};

const TEXT_CLASS: Record<QuotaState, string> = {
  ok: "text-fg",
  warn: "text-aging",
  exceeded: "text-error",
};

function formatReset(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Absolute time in the viewer's zone; "UTC midnight" is spelled out in the caption.
  try {
    return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" }).format(d);
  } catch {
    return d.toISOString();
  }
}

export function QuotaBar({ quota }: { quota: QuotaView }) {
  const t = useT();
  const tag = htmlLang(useLocale());
  const state = stateFor(quota.used, quota.limit, quota.hardLimit);
  const pct = quota.limit > 0 ? Math.min(100, Math.round((quota.used / quota.limit) * 100)) : 0;

  return (
    <div className="flex max-w-md flex-col gap-1.5" data-quota-state={state}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <span className="t-body">{t("settings.quota.title")}</span>
        <span className={cn("t-body", TEXT_CLASS[state])}>{t("settings.quota.used", { used: quota.used, limit: quota.limit })}</span>
      </div>
      <div
        role="progressbar"
        aria-label={t("settings.quota.title")}
        aria-valuemin={0}
        aria-valuemax={quota.limit}
        aria-valuenow={Math.min(quota.used, quota.limit)}
        aria-valuetext={t("settings.quota.used", { used: quota.used, limit: quota.limit })}
        className="h-1 w-full overflow-hidden bg-bg-raised"
      >
        <div className={cn("h-full", FILL_CLASS[state])} style={{ width: `${pct}%` }} />
      </div>
      <p className="t-meta text-fg-muted">
        {quota.used === 0 ? t("settings.quota.none") : t("settings.quota.reset", { resetAt: formatReset(quota.resetAt, tag) })}{" "}
        {t("settings.quota.hint", { limit: quota.limit })}
      </p>
    </div>
  );
}
