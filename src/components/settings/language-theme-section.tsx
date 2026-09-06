"use client";

/**
 * Language and theme (spec §5.4, docs/UI_PLAN.md §6.8): two radio groups, EN / 中文 and
 * System / Light / Dark. Both persist twice — a cookie so this device keeps the choice without a
 * round trip, and PUT /api/settings so a new device starts from it. The theme radios are bound
 * to useTheme(), the same state the top-bar control cycles, so the two never disagree.
 *
 * Radios rather than a cycling button: this is the explicit control, and every option has to be
 * visible and reachable by keyboard (arrow keys inside the group, one tab stop).
 */
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { writeLocaleCookie } from "@/components/shell/locale-toggle";
import { errorText, isLocale, LOCALES, type Locale } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/client";
import { THEMES, type Theme } from "@/lib/theme";
import { useTheme } from "@/lib/theme/client";
import { cn } from "@/lib/utils";
import { apiJson } from "./api";
import { SettingsNotice, SettingsSection } from "./section";

/**
 * One labelled radio in a segmented row: the chosen option carries the raised ground.
 *
 * The indicator is drawn, not left to the user agent. Under `color-scheme: dark` Chromium
 * paints an UNchecked native radio as a solid filled disc and the checked one as a ring with a
 * centre dot — the conventional reading inverted, and spec §8 forbids meaning that rides on the
 * ground colour alone. `appearance-none` plus an explicit ring / ring-and-dot makes the shape
 * say the same thing in both themes.
 */
function RadioOption({
  name,
  value,
  checked,
  onSelect,
  disabled,
  children,
  lang,
}: {
  name: string;
  value: string;
  checked: boolean;
  onSelect: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  lang?: string;
}) {
  return (
    <label
      lang={lang}
      data-checked={checked || undefined}
      className={cn(
        "t-body flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-line-strong px-2.5",
        checked ? "bg-bg-raised font-medium text-fg" : "bg-bg text-fg-muted",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="size-3.5 shrink-0 appearance-none rounded-full border border-line-strong bg-bg checked:border-fg checked:bg-fg checked:shadow-[inset_0_0_0_2px_var(--bg-raised)]"
      />
      {children}
    </label>
  );
}

export interface LanguageThemeSectionProps {
  /** The language currently in effect (cookie, else the account's). */
  locale: Locale;
}

export function LanguageThemeSection({ locale }: LanguageThemeSectionProps) {
  const t = useT();
  const uiLocale = useLocale();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const ids = useId();
  const [value, setValue] = useState<Locale>(locale);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function changeLocale(nextValue: string) {
    if (!isLocale(nextValue) || nextValue === value) return;
    const previous = value;
    setValue(nextValue);
    setError(null);
    // The cookie is this device's source of truth; the account copy follows it.
    writeLocaleCookie(nextValue);
    const res = await apiJson("/api/settings", { method: "PUT", body: { locale: nextValue } });
    if (res.ok) {
      startTransition(() => router.refresh());
    } else {
      writeLocaleCookie(previous);
      setValue(previous);
      setError(errorText(uiLocale, res.error));
    }
  }

  return (
    <SettingsSection id="language" title={t("settings.language_theme.title")}>
      {/* Below 768 px the 96 px label column plus its 16 px gap left ~262 px for three pills that
          need ~260 plus gaps, so the third wrapped onto a line of its own and the group stopped
          reading as one control. The label goes above the pills there instead. */}
      <fieldset className="flex flex-col items-start gap-1 sm:flex-row sm:gap-4" disabled={pending}>
        <legend className="sr-only">{t("locale.label")}</legend>
        {/* The label is its own column; the options wrap inside theirs, never under the label. */}
        <span className="t-body flex h-8 w-auto shrink-0 items-center text-fg-muted sm:w-24" aria-hidden="true">
          {t("locale.label")}
        </span>
        <div className="flex flex-wrap gap-2">
          {LOCALES.map((loc) => (
            <RadioOption
              key={loc}
              name={`${ids}-locale`}
              value={loc}
              lang={loc === "zh" ? "zh-CN" : "en"}
              checked={value === loc}
              disabled={pending}
              onSelect={() => void changeLocale(loc)}
            >
              {loc === "en" ? "English" : "中文（简体）"}
            </RadioOption>
          ))}
        </div>
      </fieldset>
      {error && <SettingsNotice kind="error">{error}</SettingsNotice>}

      <fieldset className="flex flex-col items-start gap-1 sm:flex-row sm:gap-4">
        <legend className="sr-only">{t("theme.label")}</legend>
        <span className="t-body flex h-8 w-auto shrink-0 items-center text-fg-muted sm:w-24" aria-hidden="true">
          {t("theme.label")}
        </span>
        <div className="flex flex-wrap gap-2">
          {THEMES.map((value_) => (
            <RadioOption
              key={value_}
              name={`${ids}-theme`}
              value={value_}
              checked={theme === value_}
              onSelect={() => setTheme(value_ as Theme)}
            >
              {t(value_ === "system" ? "theme.system" : value_ === "light" ? "theme.light" : "theme.dark")}
            </RadioOption>
          ))}
        </div>
      </fieldset>
      <p className="t-meta text-fg-muted">{t("settings.language.subtitle")}</p>
    </SettingsSection>
  );
}
