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

/** EN / 中文 segmented toggle. Persists to the cookie and refreshes server components. */
export function LocaleToggle({ className }: { className?: string }) {
  const current = useLocale();
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function select(next: Locale) {
    if (next === current) return;
    writeLocaleCookie(next);
    startTransition(() => router.refresh());
  }

  return (
    <div
      role="group"
      aria-label={t("locale.label")}
      className={cn("inline-flex items-center rounded-md border border-border p-0.5 text-xs", className)}
      data-pending={pending || undefined}
    >
      {LOCALES.map((loc) => (
        <button
          key={loc}
          type="button"
          onClick={() => select(loc)}
          aria-pressed={loc === current}
          disabled={pending}
          className={cn(
            "rounded-[3px] px-1.5 py-0.5 leading-none transition-colors",
            loc === current ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t(loc === "en" ? "locale.en" : "locale.zh")}
        </button>
      ))}
    </div>
  );
}
