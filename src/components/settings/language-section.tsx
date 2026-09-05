"use client";

/**
 * Language: EN / 中文. Saves to the account (PUT /api/settings sets the ag_locale cookie too)
 * and refreshes so the whole shell re-renders in the new language.
 */
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { errorText, isLocale, LOCALES, type Locale } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/client";
import { apiJson } from "./api";
import { NativeSelect } from "./native-select";
import { SettingsSection } from "./section";

export function LanguageSection({ locale }: { locale: Locale }) {
  const t = useT();
  const uiLocale = useLocale();
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState<Locale>(locale);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function change(next: string) {
    if (!isLocale(next) || next === value) return;
    const previous = value;
    setValue(next);
    setError(null);
    const res = await apiJson("/api/settings", { method: "PUT", body: { locale: next } });
    if (res.ok) {
      startTransition(() => router.refresh());
    } else {
      setValue(previous);
      setError(errorText(uiLocale, res.error));
    }
  }

  return (
    <SettingsSection id="language" title={t("settings.language")} description={t("settings.language.subtitle")}>
      <div className="flex max-w-xs flex-col gap-1.5">
        <Label htmlFor={id}>{t("locale.label")}</Label>
        <NativeSelect id={id} value={value} onChange={(e) => void change(e.target.value)} disabled={pending}>
          {LOCALES.map((loc) => (
            <option key={loc} value={loc}>
              {loc === "en" ? "English" : "中文（简体）"}
            </option>
          ))}
        </NativeSelect>
      </div>
      {error && (
        <Alert variant="destructive" aria-live="polite">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </SettingsSection>
  );
}
