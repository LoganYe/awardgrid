"use client";

/**
 * Telegram card (placeholder until standing queries land in Phase 3 — the "Link Telegram"
 * button is disabled) plus quiet hours + time zone, which DO save via PUT /api/settings.
 * Time zone options come from Intl.supportedValuesOf("timeZone") on the client via
 * useSyncExternalStore (server snapshot = short fallback list, so hydration agrees).
 */
import { useRouter } from "next/navigation";
import { useId, useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorText } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/client";
import { apiJson } from "./api";
import { SettingsSection } from "./section";
import { NativeSelect } from "./native-select";

export interface TelegramSectionProps {
  timezone: string;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  telegramLinked: boolean;
}

interface SettingsResponse {
  settings: { locale: string; timezone: string; quietHoursStart: string | null; quietHoursEnd: string | null };
}

const FALLBACK_ZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Vancouver",
  "America/Toronto",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Taipei",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Singapore",
  "Australia/Sydney",
];

export function supportedTimeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  if (typeof intl.supportedValuesOf === "function") {
    try {
      const zones = intl.supportedValuesOf("timeZone");
      if (zones.length > 0) return zones.includes("UTC") ? zones : ["UTC", ...zones];
    } catch {
      // fall through
    }
  }
  return FALLBACK_ZONES;
}

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Hydration-safe zone list: the server (and the first client render) use the short fallback,
// the client then swaps in the full IANA list without a setState-in-effect.
const subscribeNever = () => () => {};
let clientZones: string[] | null = null;
const getClientZones = () => (clientZones ??= supportedTimeZones());
const getServerZones = () => FALLBACK_ZONES;

export function TelegramSection({ timezone, quietHoursStart, quietHoursEnd, telegramLinked }: TelegramSectionProps) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const ids = useId();
  const [tz, setTz] = useState(timezone);
  const [start, setStart] = useState(quietHoursStart ?? "");
  const [end, setEnd] = useState(quietHoursEnd ?? "");
  const allZones = useSyncExternalStore(subscribeNever, getClientZones, getServerZones);
  const zones = useMemo(() => (allZones.includes(timezone) ? allZones : [timezone, ...allZones]), [allZones, timezone]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const dirty = tz !== timezone || start !== (quietHoursStart ?? "") || end !== (quietHoursEnd ?? "");
  const halfSet = (start === "") !== (end === "");
  const badFormat = (start !== "" && !HHMM_RE.test(start)) || (end !== "" && !HHMM_RE.test(end));
  const overnight = useMemo(() => start !== "" && end !== "" && end < start, [start, end]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    if (halfSet || badFormat) {
      setNotice({ kind: "error", text: errorText(locale, "invalid_quiet_hours") });
      return;
    }
    setBusy(true);
    setNotice(null);
    const res = await apiJson<SettingsResponse>("/api/settings", {
      method: "PUT",
      body: {
        timezone: tz,
        quietHoursStart: start === "" ? null : start,
        quietHoursEnd: end === "" ? null : end,
      },
    });
    setBusy(false);
    if (res.ok) {
      setNotice({ kind: "ok", text: t("settings.saved") });
      router.refresh();
    } else {
      setNotice({ kind: "error", text: errorText(locale, res.error) });
    }
  }

  return (
    <SettingsSection id="telegram" title={t("settings.telegram.title")} description={t("settings.telegram.subtitle")}>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled aria-disabled="true">
          {t("settings.telegram.link")}
        </Button>
        <Badge variant="secondary">{telegramLinked ? t("settings.telegram.linked") : t("settings.telegram.coming_soon")}</Badge>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-medium">{t("settings.quiet_hours.title")}</h3>
          <p className="text-xs text-muted-foreground">{t("settings.quiet_hours.subtitle")}</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[8rem_8rem_minmax(0,1fr)]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-start`}>{t("settings.quiet_hours.from")}</Label>
            <Input
              id={`${ids}-start`}
              type="time"
              step={60}
              value={start}
              onChange={(e) => setStart(e.target.value)}
              placeholder="22:00"
              className="num"
              disabled={busy}
              aria-invalid={halfSet || badFormat ? true : undefined}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-end`}>{t("settings.quiet_hours.to")}</Label>
            <Input
              id={`${ids}-end`}
              type="time"
              step={60}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              placeholder="07:00"
              className="num"
              disabled={busy}
              aria-invalid={halfSet || badFormat ? true : undefined}
            />
          </div>
          <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-1">
            <Label htmlFor={`${ids}-tz`}>{t("settings.timezone")}</Label>
            <NativeSelect id={`${ids}-tz`} value={tz} onChange={(e) => setTz(e.target.value)} disabled={busy}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {start === "" && end === "" ? t("settings.quiet_hours.disabled") : overnight ? t("settings.quiet_hours.overnight_hint") : null}
        </p>
        {notice && (
          <Alert variant={notice.kind === "error" ? "destructive" : "default"} aria-live="polite">
            <AlertDescription>{notice.text}</AlertDescription>
          </Alert>
        )}
        <div className="flex items-center gap-1.5">
          <Button type="submit" size="sm" disabled={busy || !dirty}>
            {busy ? t("auth.submitting") : t("common.save")}
          </Button>
          {(start !== "" || end !== "") && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                setStart("");
                setEnd("");
              }}
            >
              {t("settings.quiet_hours.clear")}
            </Button>
          )}
        </div>
      </form>
    </SettingsSection>
  );
}
