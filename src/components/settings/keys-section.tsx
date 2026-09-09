"use client";

/**
 * API keys (spec §5.1, docs/UI_PLAN.md §6.8): one row per provider — seats.aero Pro required,
 * Duffel and Ignav optional. Each row is status text, the masked key, and Replace / Remove;
 * Remove confirms inline in the row (never a modal). Adding a seats.aero key validates it with
 * one cached-search call and reports either "Checked with seats.aero just now" or the exact
 * failure the API gave (rejected key, or unreachable). Today's quota sits under the rows.
 *
 * Secrets: the plaintext only lives in local state between paste and PUT, is cleared on success,
 * and never reaches a prop, a URL or a log. What comes back is the masked summary.
 */
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { InlineConfirm } from "@/components/queries/inline-confirm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KEY_PROVIDERS, type KeyProvider } from "@/lib/db/schema";
import { errorText, type I18nKey } from "@awardgrid/core/i18n";
import { useLocale, useT } from "@awardgrid/core/i18n/client";
import { apiJson, formatDate, formatDayMonth } from "./api";
import { QuotaBar, type QuotaView } from "./quota-bar";
import { SettingsNotice, SettingsSection } from "./section";

/** Exactly the fields the server's listKeys() returns — no key material by construction. */
export interface KeyRowData {
  provider: KeyProvider;
  last4: string;
  masked: string;
  createdAt: string;
}

export interface KeysSectionProps {
  keys: KeyRowData[];
  quota: QuotaView;
}

const PROVIDER_LABEL_KEY: Record<KeyProvider, I18nKey> = {
  seats_aero: "settings.keys.provider.seats_aero",
  duffel: "settings.keys.provider.duffel",
  ignav: "settings.keys.provider.ignav",
};

export function KeysSection({ keys, quota }: KeysSectionProps) {
  const t = useT();
  const byProvider = new Map(keys.map((k) => [k.provider, k]));
  return (
    <SettingsSection id="keys" title={t("settings.keys.title")}>
      <ul className="flex flex-col">
        {KEY_PROVIDERS.map((provider) => (
          <KeyRow key={provider} provider={provider} current={byProvider.get(provider) ?? null} />
        ))}
      </ul>
      <QuotaBar quota={quota} />
    </SettingsSection>
  );
}

type Notice = { kind: "ok" | "error"; text: string } | null;

function KeyRow({ provider, current }: { provider: KeyProvider; current: KeyRowData | null }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const isSeats = provider === "seats_aero";
  const label = t(PROVIDER_LABEL_KEY[provider]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    if (value.trim().length === 0) {
      setNotice({ kind: "error", text: errorText(locale, "key_empty") });
      return;
    }
    setBusy(true);
    setNotice(null);
    const res = await apiJson<KeyRowData>("/api/keys", { method: "PUT", body: { provider, key: value } });
    setBusy(false);
    if (res.ok) {
      setValue("");
      setShow(false);
      setOpen(false);
      // seats.aero keys are the only ones checked upstream, so only they can say "checked".
      setNotice({ kind: "ok", text: isSeats ? t("settings.keys.checked_now") : t("settings.keys.saved_ok_plain", { masked: res.data.masked }) });
      router.refresh();
    } else {
      setNotice({ kind: "error", text: errorText(locale, res.error, res.resetAt ? { resetAt: formatDate(res.resetAt, locale) } : undefined) });
    }
  }

  async function onRemove() {
    setBusy(true);
    setNotice(null);
    const res = await apiJson<undefined>(`/api/keys/${provider}`, { method: "DELETE" });
    setBusy(false);
    setConfirmRemove(false);
    if (res.ok) {
      setNotice({ kind: "ok", text: t("settings.keys.removed") });
      router.refresh();
    } else {
      setNotice({ kind: "error", text: errorText(locale, res.error) });
    }
  }

  const status = current
    ? t("settings.keys.added", { date: formatDayMonth(current.createdAt, locale) })
    : t("settings.keys.not_set");

  return (
    <li data-key-row={provider} className="flex flex-col gap-2 py-2">
      <div className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-1">
        {/*
          Fixed tracks at >= 768 px, not a wrap flex (docs/UI_PLAN.md §6.8 draws this section as
          a table). Each field used to start wherever the preceding variable-width provider name
          ended, so "required" and "optional" landed at three different x positions down three
          rows and nothing lined up into columns. Below 768 px there are no columns to line up
          with, so the row goes back to wrapping rather than spending four lines on four fields.
        */}
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-4 gap-y-0.5 sm:grid sm:grid-cols-[11rem_5rem_minmax(0,1fr)_auto]">
          <span className="t-body truncate font-medium">{label}</span>
          <span className="t-meta text-fg-muted">{t(isSeats ? "settings.keys.required" : "settings.keys.optional")}</span>
          <span className="t-meta truncate text-fg-muted" data-key-status={current ? "set" : "unset"}>
            {status}
          </span>
          {current && <span className="t-meta truncate text-fg">{current.masked}</span>}
        </div>
        {confirmRemove ? (
          // Shared with the Queries page (spec §11): Esc cancels, and dismissing puts focus
          // back on the Remove button rather than dropping it at the top of the document.
          <InlineConfirm
            question={t("settings.keys.remove_title", { provider: label })}
            confirmLabel={t("settings.keys.remove")}
            cancelLabel={t("common.keep")}
            busy={busy}
            size="sm"
            align="start"
            restoreFocusTo={`[data-key-row="${provider}"] [data-testid="remove-key"]`}
            onConfirm={() => void onRemove()}
            onCancel={() => setConfirmRemove(false)}
            data-testid="remove-key-confirm"
          />
        ) : (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={current ? "outline" : "default"}
              size="sm"
              aria-expanded={open}
              aria-controls={`${inputId}-form`}
              onClick={() => {
                setOpen((o) => !o);
                setNotice(null);
              }}
              disabled={busy}
            >
              {t(current ? "settings.keys.replace" : "settings.keys.add_action")}
            </Button>
            {current && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmRemove(true)} disabled={busy} data-testid="remove-key">
                {t("settings.keys.remove")}
              </Button>
            )}
          </div>
        )}
      </div>

      {open && (
        <form id={`${inputId}-form`} onSubmit={onSubmit} className="flex flex-col gap-2 pb-2" noValidate>
          <Label htmlFor={inputId}>{t("settings.keys.input_label")}</Label>
          <div className="flex max-w-md gap-2">
            <Input
              id={inputId}
              type={show ? "text" : "password"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              maxLength={2048}
              disabled={busy}
              aria-describedby={`${inputId}-hint`}
              autoFocus
            />
            <Button type="button" variant="ghost" size="sm" onClick={() => setShow((s) => !s)} disabled={busy}>
              {t(show ? "settings.keys.hide" : "settings.keys.show")}
            </Button>
          </div>
          <p id={`${inputId}-hint`} className="t-meta text-fg-muted">
            {t(isSeats ? "settings.keys.input_hint_seats" : "settings.keys.input_hint_optional")}
          </p>
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={busy || value.trim().length === 0}>
              {busy ? (isSeats ? t("settings.keys.validating") : t("settings.keys.saving")) : t("settings.keys.add")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setValue("");
                setShow(false);
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      )}

      {notice && <SettingsNotice kind={notice.kind}>{notice.text}</SettingsNotice>}
    </li>
  );
}
