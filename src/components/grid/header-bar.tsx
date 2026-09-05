"use client";

import { DownloadIcon, Rows3Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatAge } from "@/lib/grid/freshness";
import type { Grid, Orientation } from "@/lib/grid/types";
import { useLocale, useT } from "@/lib/i18n/client";
import type { QuotaSnapshot } from "@/lib/server/find";
import { cn } from "@/lib/utils";

export interface HeaderBarProps {
  grid: Grid;
  quota: QuotaSnapshot | null;
  now: number;
  orientation: Orientation;
  exporting: boolean;
  onToggleOrientation: () => void;
  onExport: () => void;
}

function formatReset(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(locale === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
}

/** Calls used this render · cache badge · oldest/newest seen · quota · CSV · orientation. */
export function HeaderBar({ grid, quota, now, orientation, exporting, onToggleOrientation, onExport }: HeaderBarProps) {
  const t = useT();
  const locale = useLocale();
  const { meta } = grid;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
      <span className="num">{t("grid.header.calls", { n: meta.api_calls_used })}</span>
      <Badge variant="outline" className={cn("font-normal", meta.served_from_cache ? "text-fresh" : "")}>
        {meta.served_from_cache ? t("grid.header.from_cache") : t("grid.header.fresh_pull")}
      </Badge>
      {meta.oldest_seen && meta.newest_seen ? (
        <span className="num">
          {t("grid.header.oldest", { age: formatAge(meta.oldest_seen, now, locale) })} · {t("grid.header.newest", { age: formatAge(meta.newest_seen, now, locale) })}
        </span>
      ) : (
        <span>{t("grid.header.no_data")}</span>
      )}
      {quota && (
        <span className="num" title={t("grid.quota_reset", { resetAt: formatReset(quota.resetAt, locale) })}>
          {t("grid.quota", { used: quota.used, limit: quota.limit })}
        </span>
      )}
      <span className="ml-auto flex items-center gap-1.5">
        <Button type="button" variant="outline" size="xs" onClick={onToggleOrientation} aria-label={t("grid.transpose")}>
          <Rows3Icon data-icon="inline-start" className={cn(orientation === "routes" && "rotate-90")} />
          {orientation === "dates" ? t("grid.rows_dates") : t("grid.rows_routes")}
        </Button>
        <Button type="button" variant="outline" size="xs" onClick={onExport} disabled={exporting}>
          <DownloadIcon data-icon="inline-start" />
          {exporting ? t("grid.exporting") : t("grid.export_csv")}
        </Button>
      </span>
    </div>
  );
}
