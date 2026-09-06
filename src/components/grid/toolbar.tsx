"use client";

/**
 * Grid toolbar (spec §3.3, docs/UI_PLAN.md §6.2–§6.4): left, the rows toggle (Dates | Routes)
 * and the cabin chips (J | F | Both, mirroring the Cabins chip for the two cabins the grid
 * shows); center, the "Show dynamic pricing" switch (the query's include_filtered flag);
 * right, "Save as standing query" (the existing dialog trigger), "Export CSV" and "Ask".
 * `disabled` (the modified-query state, 6.3) dims and disables everything. Below 768 px the
 * controls collapse into a "Filters" bottom sheet.
 *
 * Under the toolbar, one status line while a search runs. Progressive per-program fill (spec
 * §3.4 "Alaska ✓ American ✓ Aeroplan …") is not applicable: /api/find answers in ONE batch,
 * so the line is a single "Searching seats.aero…" that disappears on completion (UI plan §11).
 *
 * Also here: the quota banner that sits above the toolbar when the daily limit is reached.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { SaveQueryDialog } from "@/components/queries/SaveQueryDialog";
import type { Orientation } from "@/lib/grid/types";
import { htmlLang, type Translate } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/client";
import type { Cabin, QueryObject } from "@/lib/query/schema";
import { formatCount } from "@/components/shell/quota-indicator-state";
import { useDensity } from "@/components/grid/use-roving-grid";

export type CabinMode = "J" | "F" | "both";

/** Which of the two premium cabins the grid shows, from the query's cabins; null when neither. */
export function cabinModeOf(cabins: readonly Cabin[]): CabinMode | null {
  const j = cabins.includes("J");
  const f = cabins.includes("F");
  return j && f ? "both" : j ? "J" : f ? "F" : null;
}

/** The cabins for a chip click: J / F / both replace the premium pair, other cabins stay as they are. */
export function cabinsForMode(cabins: readonly Cabin[], mode: CabinMode): Cabin[] {
  const rest = cabins.filter((c) => c !== "J" && c !== "F");
  const premium: Cabin[] = mode === "both" ? ["J", "F"] : [mode];
  return [...premium, ...rest];
}

export interface ToolbarProps {
  query: QueryObject;
  orientation: Orientation;
  onOrientation: (o: Orientation) => void;
  onCabins: (cabins: Cabin[]) => void;
  onIncludeFiltered: (value: boolean) => void;
  /** True when the dynamic-pricing scope is already cached (the toggle costs no calls); drives the muted note. */
  dynamicRowsAvailable: boolean;
  onExport: () => void;
  exporting: boolean;
  /** False while there is no grid to export (the quota state without cached results). */
  canExport?: boolean;
  onAsk?: () => void;
  /** Modified query not yet run: everything dimmed and disabled. */
  disabled?: boolean;
  /** Daily limit reached: Save is disabled with a tooltip. */
  quotaExceeded?: boolean;
  /** A search is in flight: the one-line status under the toolbar. */
  searching?: boolean;
}

function Segmented<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T | null; options: readonly { value: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="ag-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} disabled={disabled} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Controls({ query, orientation, onOrientation, onCabins, onIncludeFiltered, dynamicRowsAvailable, onExport, exporting, canExport = true, onAsk, disabled, quotaExceeded, stacked }: ToolbarProps & { stacked: boolean }) {
  const t = useT();
  const mode = cabinModeOf(query.cabins);
  const rows = (
    <Segmented
      label={t("grid.toolbar.rows")}
      value={orientation}
      options={[
        { value: "dates", label: t("grid.toolbar.rows_dates") },
        { value: "routes", label: t("grid.toolbar.rows_routes") },
      ]}
      onChange={onOrientation}
      disabled={disabled}
    />
  );
  const cabins = (
    <Segmented<CabinMode>
      label={t("grid.toolbar.cabins")}
      value={mode}
      options={[
        { value: "J", label: "J" },
        { value: "F", label: "F" },
        { value: "both", label: t("grid.toolbar.cabin_both") },
      ]}
      onChange={(m) => onCabins(cabinsForMode(query.cabins, m))}
      disabled={disabled}
    />
  );
  const dynamic = (
    <label className="ag-toolbar-group">
      <Switch size="sm" checked={query.include_filtered} disabled={disabled} onCheckedChange={(v) => onIncludeFiltered(v)} />
      <span>{t("grid.include_filtered")}</span>
    </label>
  );
  const dynamicNote = !query.include_filtered && !dynamicRowsAvailable ? <span className="ag-note">{t("grid.toolbar.dynamic_note")}</span> : null;
  const save = (
    <span title={quotaExceeded ? t("grid.toolbar.save_disabled_quota") : undefined} data-testid="save-query">
      <SaveQueryDialog query={query} disabled={disabled || quotaExceeded} />
    </span>
  );
  const exportBtn = (
    <Button type="button" variant="outline" size="xs" onClick={onExport} disabled={disabled || exporting || !canExport}>
      {exporting ? t("grid.exporting") : t("grid.export_csv")}
    </Button>
  );
  const ask = onAsk ? (
    <Button type="button" variant="outline" size="xs" onClick={onAsk} disabled={disabled}>
      {t("ask.open")}
    </Button>
  ) : null;

  if (stacked) {
    return (
      <div className="ag-filters">
        <div className="ag-filters-row">
          <span>{t("grid.toolbar.rows")}</span>
          {rows}
        </div>
        <div className="ag-filters-row">
          <span>{t("grid.toolbar.cabins")}</span>
          {cabins}
        </div>
        <div className="ag-filters-row">{dynamic}</div>
        {dynamicNote}
        <div className="ag-filters-row">
          {save}
          {exportBtn}
          {ask}
        </div>
      </div>
    );
  }
  return (
    <>
      <div className="ag-toolbar-group">
        <span className="ag-toolbar-label">{t("grid.toolbar.rows")}</span>
        {rows}
        {cabins}
      </div>
      <div className="ag-toolbar-center">
        {dynamic}
        {dynamicNote}
      </div>
      <div className="ag-toolbar-right">
        {save}
        {exportBtn}
        {ask}
      </div>
    </>
  );
}

export function Toolbar(props: ToolbarProps) {
  const t = useT();
  const density = useDensity();
  const [open, setOpen] = useState(false);
  const { disabled, searching } = props;
  return (
    <div className="flex flex-col gap-1">
      <div className="ag-toolbar" data-disabled={disabled ? "true" : "false"} role="toolbar" aria-label={t("grid.toolbar.label")} aria-disabled={disabled ? "true" : undefined}>
        {density === "mobile" ? (
          <>
            <Button type="button" variant="outline" size="xs" onClick={() => setOpen(true)} disabled={disabled} aria-haspopup="dialog" aria-expanded={open}>
              {t("grid.toolbar.filters")}
            </Button>
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetContent side="bottom">
                <SheetHeader>
                  <SheetTitle>{t("grid.toolbar.filters")}</SheetTitle>
                </SheetHeader>
                <Controls
                  {...props}
                  stacked
                  onAsk={
                    props.onAsk
                      ? () => {
                          setOpen(false);
                          props.onAsk?.();
                        }
                      : undefined
                  }
                />
              </SheetContent>
            </Sheet>
          </>
        ) : (
          <Controls {...props} stacked={false} />
        )}
      </div>
      {searching && (
        <p className="ag-status" role="status" aria-live="polite" data-testid="grid-searching">
          {t("grid.searching")}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quota banner (spec §3.7)
// ---------------------------------------------------------------------------

export interface QuotaBannerProps {
  /** ISO timestamp of the next reset. */
  resetAt: string | undefined;
  used?: number;
  limit?: number;
  now: number;
  /** True when a previously fetched grid is still on screen, i.e. the cached-results clause is true. */
  cached?: boolean;
}

/** "5 h 12 m" / "5 小时 12 分钟"; "0 m" once the reset is due. */
export function formatDuration(ms: number, t: Translate): string {
  const minutes = Math.max(0, Math.ceil(ms / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} ${t("grid.unit.h")} ${m} ${t("grid.unit.m")}` : `${m} ${t("grid.unit.m")}`;
}

/**
 * "seats.aero daily limit reached (950 of 1,000). Resets in 5 h 12 m." plus "Cached results are
 * still shown." only when there actually are any: the limit can be hit on the first search of
 * the day, and the banner must not describe a grid that is not there.
 * Used / limit come from the caller when known, otherwise from GET /api/usage.
 */
export function QuotaBanner({ resetAt, used, limit, now, cached = false }: QuotaBannerProps) {
  const t = useT();
  const locale = useLocale();
  const [fetched, setFetched] = useState<{ used: number; limit: number; resetAt: string } | null>(null);
  const needFetch = used === undefined || limit === undefined;
  useEffect(() => {
    if (!needFetch) return;
    const controller = new AbortController();
    fetch("/api/usage", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { seats_aero?: { used?: number; soft_limit?: number; limit?: number; reset_at?: string } } | null) => {
        const s = body?.seats_aero;
        if (s && typeof s.used === "number") setFetched({ used: s.used, limit: s.limit ?? s.soft_limit ?? 0, resetAt: s.reset_at ?? "" });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [needFetch]);
  const u = used ?? fetched?.used ?? 0;
  const l = limit ?? fetched?.limit ?? 0;
  const reset = resetAt ?? fetched?.resetAt ?? "";
  const resetMs = Date.parse(reset);
  const duration = Number.isNaN(resetMs) ? "?" : formatDuration(resetMs - now, t);
  const tag = htmlLang(locale);
  return (
    <div className="ag-quota" role="status" aria-live="polite" data-testid="quota-banner">
      {t("grid.quota_banner", { used: formatCount(u, tag), limit: formatCount(l, tag), duration })}
      {cached ? ` ${t("grid.quota_banner_cached")}` : ""}
    </div>
  );
}
