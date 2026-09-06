"use client";

import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { Locale, Translate } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/client";
import { noticeKey } from "@/lib/notices";
import type { ApiFailure } from "@/components/grid/api";

const MISSING_KEYS = {
  origins: "grid.missing.origins",
  destinations: "grid.missing.destinations",
  date_from: "grid.missing.date_from",
  date_to: "grid.missing.date_to",
} as const;

function formatReset(iso: string, locale: Locale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(locale === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
}

/** One safe, translated sentence for any API failure (never echoes upstream bodies verbatim). */
export function failureText(t: Translate, locale: Locale, f: ApiFailure): string {
  switch (f.error) {
    case "no_key":
      return t("grid.empty.no_key");
    case "quota":
      return t("grid.empty.quota", { remaining: f.remaining ?? 0, requested: f.requested ?? 1, resetAt: f.resetAt ? formatReset(f.resetAt, locale) : "—" });
    case "parse": {
      const fields = (f.missing ?? []).map((m) => (m in MISSING_KEYS ? t(MISSING_KEYS[m as keyof typeof MISSING_KEYS]) : m));
      return fields.length > 0 ? `${t("grid.empty.parse")} ${t("grid.empty.parse_missing", { fields: fields.join(", ") })}` : t("grid.empty.parse");
    }
    case "seatsaero":
      return t("grid.empty.seatsaero", { kind: f.kind ?? "error" });
    case "unauthorized":
      return t("grid.empty.unauthorized");
    case "invalid_body":
      return t("grid.empty.invalid_body");
    case "network":
      return t("error.network");
    default:
      return t("grid.empty.internal");
  }
}

/**
 * Detail line for a parse failure: the server's structured notice rendered in the viewer's
 * language. `parse.missing` only restates the title (which already lists the fields), so it is
 * dropped; a legacy plain `message` is never shown verbatim (it is English-only).
 */
export function parseDetail(t: Translate, f: ApiFailure): string | null {
  if (f.error !== "parse" || !f.notice || f.notice.code === "parse.missing") return null;
  return t(noticeKey(f.notice.code), f.notice.vars);
}

/** Empty states (kickoff Phase 2): no key → Settings, quota, parse errors, upstream errors. */
export function FailureState({ failure, onRetry }: { failure: ApiFailure; onRetry?: () => void }) {
  const t = useT();
  const locale = useLocale();
  const text = failureText(t, locale, failure);
  const detail = parseDetail(t, failure);
  if (failure.error === "no_key") return <NoKeyState />;
  return (
    <Alert variant={failure.error === "parse" ? "default" : "destructive"} aria-live="polite">
      <AlertTitle>{text}</AlertTitle>
      {detail && <AlertDescription>{detail}</AlertDescription>}
      {failure.error === "unauthorized" && (
        <AlertDescription>
          <Link href="/login" className="link">
            {t("nav.login")}
          </Link>
        </AlertDescription>
      )}
      {onRetry && failure.error !== "parse" && failure.error !== "unauthorized" && failure.error !== "quota" && (
        <AlertDescription>
          <Button type="button" size="xs" variant="outline" onClick={onRetry}>
            {t("common.retry")}
          </Button>
        </AlertDescription>
      )}
    </Alert>
  );
}

/**
 * The three page-level states that replace the grid area share GridEmptyResults' treatment
 * (docs/UI_PLAN.md §6.2: "a 14 px sentence + link button, left-aligned, no box"; §4: nothing
 * gets a border for looking like a component). They used to be shadcn <Alert>s and dashed
 * centred boxes, which made the four states that replace the grid disagree with each other.
 */
export function NoKeyState() {
  const t = useT();
  return (
    <div className="ag-empty" role="status" aria-live="polite" data-testid="grid-no-key">
      <p>{t("grid.empty.no_key")}</p>
      <p>
        <Link href="/settings" className="ag-link">
          {t("grid.empty.no_key_cta")}
        </Link>
      </p>
    </div>
  );
}

export function StartState() {
  const t = useT();
  return (
    <div className="ag-empty" role="status">
      <p>{t("grid.empty.start")}</p>
    </div>
  );
}

export function NoResultsState() {
  const t = useT();
  return (
    <div className="ag-empty" role="status">
      <p>{t("grid.empty.no_results")}</p>
    </div>
  );
}

/** Quota reached with nothing cached to fall back on: the banner says it, this says what is missing. */
export function QuotaNoResultsState() {
  const t = useT();
  return (
    <div className="ag-empty" role="status" data-testid="grid-quota-empty">
      <p>{t("grid.empty.quota_blank")}</p>
    </div>
  );
}
