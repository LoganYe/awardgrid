"use client";

/**
 * Top-bar quota indicator (Phase 6 spec §4.7, UI plan §6.1): `312 / 1,000 today`, neutral
 * below 800 calls, `--aging` from 800, `--error` from the soft limit (950). The state is also
 * spelled out in the accessible name, so color is never the only carrier. A tooltip lists the
 * reset time and the per-provider breakdown (seats.aero calls, Ask spend).
 *
 * Data: GET /api/usage on mount, every 60 s while the tab is visible, on window focus, and
 * whenever something dispatches `USAGE_CHANGED_EVENT` on `window` (call `notifyUsageChanged()`
 * after a grid run or an Ask answer). Renders nothing while loading, when signed out (401) or
 * when the first fetch fails; a later failure keeps the last known figure.
 *
 * Text only, tokens only: no icon, no brand color, no shadow.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { htmlLang } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/client";
import type { UsageSummary } from "@/lib/server/usage";
import { cn } from "@/lib/utils";
import { format, formatCount, formatUsd, resetLabel, stateFor, type QuotaState } from "./quota-indicator-state";

/** How often the indicator re-reads /api/usage while the tab is visible. */
export const USAGE_POLL_MS = 60_000;

/** Dispatch on `window` after anything that spends quota so every mounted indicator refetches. */
export const USAGE_CHANGED_EVENT = "awardgrid:usage-changed";

export function notifyUsageChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(USAGE_CHANGED_EVENT));
}

export interface QuotaIndicatorProps {
  className?: string;
  /** Test/preview hook: render this summary instead of fetching. Polling is skipped. */
  initial?: UsageSummary;
}

type Status = "loading" | "ready" | "signed_out";

const STATE_CLASS: Record<QuotaState, string> = {
  ok: "",
  warn: "text-aging",
  exceeded: "text-error",
};

export function QuotaIndicator({ className, initial }: QuotaIndicatorProps) {
  const t = useT();
  const locale = useLocale();
  const tag = htmlLang(locale);
  const [usage, setUsage] = useState<UsageSummary | null>(initial ?? null);
  const [status, setStatus] = useState<Status>(initial ? "ready" : "loading");
  const inflight = useRef<AbortController | null>(null);
  const stopped = useRef(false);

  const load = useCallback(async () => {
    if (stopped.current) return;
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    try {
      const res = await fetch("/api/usage", { cache: "no-store", credentials: "same-origin", signal: controller.signal });
      if (res.status === 401) {
        stopped.current = true;
        setUsage(null);
        setStatus("signed_out");
        return;
      }
      if (!res.ok) return;
      const body = (await res.json()) as UsageSummary;
      if (controller.signal.aborted) return;
      setUsage(body);
      setStatus("ready");
    } catch {
      // Network failure or abort: keep whatever was shown; the next tick retries.
    }
  }, []);

  useEffect(() => {
    if (initial) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer === null) timer = setInterval(() => void load(), USAGE_POLL_MS);
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void load();
        start();
      } else {
        stop();
      }
    };
    const refetch = () => void load();

    // First read on the next tick (the effect itself only subscribes; state lands from the fetch).
    const kick = setTimeout(refetch, 0);
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", refetch);
    window.addEventListener(USAGE_CHANGED_EVENT, refetch);
    return () => {
      clearTimeout(kick);
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", refetch);
      window.removeEventListener(USAGE_CHANGED_EVENT, refetch);
      inflight.current?.abort();
    };
  }, [initial, load]);

  if (status !== "ready" || !usage) return null;

  const { seats_aero: seats, ask } = usage;
  const state = stateFor(seats.used, seats.soft_limit, seats.limit);
  const reset = resetLabel(seats.reset_at, tag);
  /*
    The SOFT limit, not the hard allowance: the settings quota bar fills toward soft_limit and
    reads "32 of 950 used", so a top bar counting against 1,000 made the app disagree with
    itself about how much budget exists. The hard allowance stays in the tooltip and in the
    settings caption, which is where it is explained.
  */
  const full = t("quota.today", { count: format(seats.used, seats.soft_limit, tag) });
  const compact = format(seats.used, seats.soft_limit, tag, { compact: true });
  // Full-width comma in Chinese (UI plan §8: zh punctuation is full-width).
  const joiner = locale === "zh" ? "，" : ", ";
  const stateSuffix = state === "ok" ? "" : `${joiner}${t(state === "warn" ? "quota.state.warn" : "quota.state.exceeded")}`;
  const label =
    t("quota.aria", { used: formatCount(seats.used, tag), limit: formatCount(seats.soft_limit, tag), reset }) + stateSuffix;

  return (
    <TooltipProvider delay={300}>
      <Tooltip>
        <TooltipTrigger
          type="button"
          aria-label={label}
          data-quota-state={state}
          data-testid="quota-indicator"
          className={cn(
            "t-body inline-flex h-8 cursor-default items-center whitespace-nowrap border-0 bg-transparent px-1 tabular-nums text-fg",
            "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
            STATE_CLASS[state],
            className,
          )}
        >
          <span aria-hidden className="hidden sm:inline">
            {full}
          </span>
          <span aria-hidden className="sm:hidden">
            {compact}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="tabular-nums">
          <div className="flex flex-col gap-0.5 text-left">
            <span>{t("quota.tooltip.reset", { time: reset })}</span>
            <span>
              {t("quota.tooltip.seats", { used: formatCount(seats.used, tag), limit: formatCount(seats.limit, tag) })}
            </span>
            <span>{t("quota.tooltip.ask", { spent: formatUsd(ask.spent_usd, tag), cap: formatUsd(ask.cap_usd, tag) })}</span>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
