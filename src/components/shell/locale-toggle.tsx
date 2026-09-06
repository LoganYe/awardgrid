"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, LOCALES, type Locale } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/** Write the `ag_locale` cookie (readable by the server layout) — no PUT /api/settings here. */
export function writeLocaleCookie(locale: Locale): void {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
}

/**
 * EN / 中文 — two text buttons separated by space, the current one in --fg at weight 500, the
 * other in --fg-muted. No box, no separator glyph. Persists to the cookie and refreshes the
 * server components so the page re-renders in the chosen language. The buttons are never
 * disabled while that refresh runs (a disabled element drops keyboard focus); a second press is
 * ignored instead and the group is marked busy.
 */
export function LocaleToggle({ className }: { className?: string }) {
  const current = useLocale();
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function select(next: Locale) {
    if (pending || next === current) return;
    writeLocaleCookie(next);
    startTransition(() => router.refresh());
  }

  return (
    <div role="group" aria-label={t("locale.label")} className={cn("inline-flex items-center gap-3", className)} aria-busy={pending || undefined} data-pending={pending || undefined}>
      {LOCALES.map((loc) => (
        <button
          key={loc}
          type="button"
          lang={loc === "zh" ? "zh-CN" : "en"}
          onClick={() => select(loc)}
          aria-pressed={loc === current}
          className={cn("t-body rounded-lg px-0.5 py-1", loc === current ? "font-medium text-fg" : "text-fg-muted hover:text-fg")}
        >
          {t(loc === "en" ? "locale.en" : "locale.zh")}
        </button>
      ))}
    </div>
  );
}
