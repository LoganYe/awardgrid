"use client";

/**
 * API keys section: one row per provider (seats.aero required, Duffel / Ignav optional).
 * Each row shows "••••1234 · added <date>" or "not set", an inline add/replace form
 * (password-type, paste-friendly) and a remove button behind a confirm dialog.
 *
 * Secrets: the plaintext only lives in local state between paste and PUT, is cleared on
 * success, and is never put into a prop, a URL or a log. What comes back is the masked summary.
 */
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KEY_PROVIDERS, type KeyProvider } from "@/lib/db/schema";
import { errorText, type I18nKey } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/client";
import { apiJson, formatDate } from "./api";
import { QuotaBar, type QuotaView } from "./quota-bar";
import { SettingsSection } from "./section";

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
    <SettingsSection id="keys" title={t("settings.keys.title")} description={t("settings.keys.subtitle")}>
      <ul className="flex flex-col divide-y divide-border">
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
      setNotice({
        kind: "ok",
        text: t(isSeats ? "settings.keys.saved_ok" : "settings.keys.saved_ok_plain", { masked: res.data.masked }),
      });
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
      setNotice({ kind: "error", text: errorText(locale, res.error, res.resetAt ? { resetAt: formatDate(res.resetAt, locale) } : undefined) });
    }
  }

  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="font-medium">{label}</span>
            <Badge variant={isSeats ? "default" : "outline"}>
              {t(isSeats ? "settings.keys.required" : "settings.keys.optional")}
            </Badge>
          </div>
          <span className="text-sm text-muted-foreground">
            {current ? (
              <span className="font-mono">
                {t("settings.keys.status_saved", { masked: current.masked, date: formatDate(current.createdAt, locale) })}
              </span>
            ) : (
              t("settings.keys.status_none")
            )}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
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
            {t(current ? "settings.keys.replace_action" : "settings.keys.add_action")}
          </Button>
          {current && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmRemove(true)} disabled={busy}>
              {t("settings.keys.remove")}
            </Button>
          )}
        </div>
      </div>

      {open && (
        <form id={`${inputId}-form`} onSubmit={onSubmit} className="flex flex-col gap-2 rounded-lg bg-muted/40 p-3" noValidate>
          <Label htmlFor={inputId}>{t("settings.keys.input_label")}</Label>
          <div className="flex gap-1.5">
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
              className="font-mono"
              disabled={busy}
              autoFocus
            />
            <Button type="button" variant="ghost" size="sm" onClick={() => setShow((s) => !s)} disabled={busy}>
              {t(show ? "settings.keys.hide" : "settings.keys.show")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t(isSeats ? "settings.keys.input_hint_seats" : "settings.keys.input_hint_optional")}
          </p>
          <div className="flex items-center gap-1.5">
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

      {notice && (
        <Alert variant={notice.kind === "error" ? "destructive" : "default"} aria-live="polite">
          <AlertDescription>{notice.text}</AlertDescription>
        </Alert>
      )}

      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.keys.remove_title", { provider: label })}</DialogTitle>
            <DialogDescription>{t("settings.keys.remove_body")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" size="sm" />}>{t("common.cancel")}</DialogClose>
            <Button variant="destructive" size="sm" onClick={onRemove} disabled={busy}>
              {t("settings.keys.remove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}
