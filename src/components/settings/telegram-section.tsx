"use client";

/**
 * Telegram (spec §5.2): the linking state (see ./telegram-link.tsx) and quiet hours — "two time
 * fields with the detected timezone shown", exactly that and no more. docs/UI_PLAN.md §12.11
 * names "quiet hours as a three-field row with a timezone select" as a generic-template tell to
 * remove, so the zone is a fact on one muted line (`Asia/Shanghai (detected)`), not a third
 * control competing with the two that matter.
 *
 * The override still exists, behind "Change time zone": an account read in a zone the browser
 * is not in is real (travel, a shared machine), and dropping the select outright would lose it.
 * It is disclosure, not furniture — closed until asked for. Saving goes through PUT /api/settings.
 *
 * The zone list comes from Intl.supportedValuesOf("timeZone") on the client through
 * useSyncExternalStore (server snapshot = a short fallback list), so hydration always agrees.
 */
import { useRouter } from "next/navigation";
import { useId, useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorText } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/client";
import { apiJson } from "./api";
import { NativeSelect } from "./native-select";
import { SettingsNotice, SettingsSection } from "./section";
import { TelegramLink } from "./telegram-link";

export interface TelegramSectionProps {
  timezone: string;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  telegramLinked: boolean;
  /** No TELEGRAM_BOT_TOKEN on the server: linking unavailable, alerts mocked. */
  telegramMock: boolean;
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

/** The browser's own zone, or "" where it cannot be read (and on the server). */
export function detectTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Hydration-safe client-only values: the server (and the first client render) see the fallback
// list and no detected zone; the client swaps both in without a setState-in-effect.
const subscribeNever = () => () => {};
let clientZones: string[] | null = null;
const getClientZones = () => (clientZones ??= supportedTimeZones());
const getServerZones = () => FALLBACK_ZONES;
let clientZone: string | null = null;
const getClientZone = () => (clientZone ??= detectTimeZone());
const getServerZone = () => "";

export function TelegramSection({ timezone, quietHoursStart, quietHoursEnd, telegramLinked, telegramMock }: TelegramSectionProps) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const ids = useId();
  const [tz, setTz] = useState(timezone);
  const [start, setStart] = useState(quietHoursStart ?? "");
  const [end, setEnd] = useState(quietHoursEnd ?? "");
  const allZones = useSyncExternalStore(subscribeNever, getClientZones, getServerZones);
  const detected = useSyncExternalStore(subscribeNever, getClientZone, getServerZone);
  const zones = useMemo(() => {
    const extra = [timezone, detected].filter((z) => z && !allZones.includes(z));
    return extra.length > 0 ? [...extra, ...allZones] : allZones;
  }, [allZones, timezone, detected]);
  const [busy, setBusy] = useState(false);
  const [editingZone, setEditingZone] = useState(false);
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
      body: { timezone: tz, quietHoursStart: start === "" ? null : start, quietHoursEnd: end === "" ? null : end },
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
    <SettingsSection id="telegram" title={t("settings.telegram.title")}>
      <TelegramLink linked={telegramLinked} mock={telegramMock} />

      <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
        <h3 className="t-body font-medium">{t("settings.quiet_hours.title")}</h3>
        <p className="t-meta text-fg-muted">{t("settings.quiet_hours.subtitle")}</p>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex w-32 flex-col gap-1">
            <Label htmlFor={`${ids}-start`}>{t("settings.quiet_hours.from")}</Label>
            <Input
              id={`${ids}-start`}
              type="time"
              step={60}
              value={start}
              onChange={(e) => setStart(e.target.value)}
              placeholder="22:00"
              disabled={busy}
              aria-invalid={halfSet || badFormat ? true : undefined}
            />
          </div>
          <div className="flex w-32 flex-col gap-1">
            <Label htmlFor={`${ids}-end`}>{t("settings.quiet_hours.to")}</Label>
            <Input
              id={`${ids}-end`}
              type="time"
              step={60}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              placeholder="07:00"
              disabled={busy}
              aria-invalid={halfSet || badFormat ? true : undefined}
            />
          </div>
        </div>
        {/* The zone the two fields are read in, as a fact rather than a control. */}
        <p className="flex flex-wrap items-center gap-3 t-meta text-fg-muted" data-detected-zone={detected} data-account-zone={tz}>
          <span>{t(tz === detected ? "settings.timezone_detected" : "settings.timezone_account", { tz })}</span>
          <button
            type="button"
            className="link"
            aria-expanded={editingZone}
            aria-controls={`${ids}-tz-editor`}
            disabled={busy}
            onClick={() => setEditingZone((o) => !o)}
          >
            {t(editingZone ? "settings.timezone.done" : "settings.timezone.change")}
          </button>
        </p>
        {editingZone && (
          <div id={`${ids}-tz-editor`} className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-56 flex-col gap-1">
              <Label htmlFor={`${ids}-tz`}>{t("settings.timezone")}</Label>
              <NativeSelect id={`${ids}-tz`} value={tz} onChange={(e) => setTz(e.target.value)} disabled={busy}>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {detected !== "" && detected !== tz && (
              <Button type="button" variant="outline" size="sm" onClick={() => setTz(detected)} disabled={busy}>
                {t("settings.timezone.use_detected")}
              </Button>
            )}
          </div>
        )}
        {(start === "" && end === "") || overnight ? (
          <p className="t-meta text-fg-muted">
            {start === "" && end === "" ? t("settings.quiet_hours.disabled") : t("settings.quiet_hours.overnight_hint")}
          </p>
        ) : null}
        {notice && <SettingsNotice kind={notice.kind}>{notice.text}</SettingsNotice>}
        <div className="flex items-center gap-2">
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
