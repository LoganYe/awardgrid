"use client";

import { useT } from "@awardgrid/core/i18n/client";
import { nextTheme, type Theme } from "@/lib/theme";
import { useTheme } from "@/lib/theme/client";
import { cn } from "@/lib/utils";

/**
 * The theme control: a text button whose label is the current state word (System / Light /
 * Dark); a click cycles to the next state. No icon — a word is understood without a tooltip.
 * The Settings page keeps the explicit three-way radios.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useT();
  const { theme, setTheme } = useTheme();
  const word = (value: Theme) => t(value === "system" ? "theme.system" : value === "light" ? "theme.light" : "theme.dark");
  const next = nextTheme(theme);
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={t("theme.switch", { current: word(theme), next: word(next) })}
      title={t("theme.switch", { current: word(theme), next: word(next) })}
      data-theme-toggle={theme}
      className={cn("t-body rounded-lg px-0.5 py-1 text-fg-muted hover:text-fg", className)}
    >
      {word(theme)}
    </button>
  );
}
