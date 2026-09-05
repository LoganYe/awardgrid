"use client";

/**
 * Today's seats.aero call count for the signed-in user against awardgrid's soft limit
 * (default 950 of the 1,000/day Pro allowance). Pure presentation; data comes from
 * getTodayUsage() in the server page.
 */
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

export interface QuotaView {
  used: number;
  limit: number;
  hardLimit: number;
  /** ISO timestamp of the next reset (UTC midnight). */
  resetAt: string;
}

function formatReset(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Absolute time in the viewer's zone; "UTC midnight" is spelled out in the caption.
  try {
    return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(d);
  } catch {
    return d.toISOString();
  }
}

export function QuotaBar({ quota }: { quota: QuotaView }) {
  const t = useT();
  const pct = quota.limit > 0 ? Math.min(100, Math.round((quota.used / quota.limit) * 100)) : 0;
  const remaining = Math.max(0, quota.limit - quota.used);
  const tone = pct >= 90 ? "bg-stale" : pct >= 60 ? "bg-aging" : "bg-fresh";
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="text-sm font-medium">{t("settings.quota.title")}</span>
        <span className="num text-sm">
          {t("settings.quota.used", { used: quota.used, limit: quota.limit })}
          <span className="text-muted-foreground"> · {t("settings.quota.remaining", { remaining })}</span>
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={t("settings.quota.title")}
        aria-valuemin={0}
        aria-valuemax={quota.limit}
        aria-valuenow={Math.min(quota.used, quota.limit)}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div className={cn("h-full rounded-full transition-[width]", tone)} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">
        {quota.used === 0 ? t("settings.quota.none") : t("settings.quota.reset", { resetAt: formatReset(quota.resetAt) })}
        {" · "}
        {t("settings.quota.hint", { limit: quota.limit })}
      </p>
    </div>
  );
}
