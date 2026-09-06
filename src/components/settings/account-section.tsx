"use client";

/**
 * Account (spec §5.3): the username (read-only), a change-password form (current + new, the
 * length rule stated up front, errors inline under the field, "Password changed" on success),
 * and "Log out everywhere" with an inline confirm.
 *
 * Changing the password rotates this device's session and ends every other one — the route does
 * that, and the hint says so before the button is pressed. Neither password ever leaves this
 * component except in the POST body.
 */
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { InlineConfirm } from "@/components/queries/inline-confirm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorText } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/client";
import { apiChangePassword, apiJson, formatDate } from "./api";
import { SettingsNotice, SettingsSection } from "./section";

/** Mirrors the API rule (src/lib/auth/users.ts `weak_password`). */
const PASSWORD_MIN_LENGTH = 8;

export function AccountSection({ username, createdAt }: { username: string; createdAt: string }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const ids = useId();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [confirmLogoutAll, setConfirmLogoutAll] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    if (next.length < PASSWORD_MIN_LENGTH) {
      setNotice({ kind: "error", text: errorText(locale, "weak_password") });
      return;
    }
    setBusy(true);
    setNotice(null);
    const res = await apiChangePassword(current, next);
    setBusy(false);
    if (res.ok) {
      setCurrent("");
      setNext("");
      setNotice({ kind: "ok", text: t("settings.account.password_changed") });
      router.refresh();
    } else {
      setNotice({ kind: "error", text: errorText(locale, res.error) });
    }
  }

  async function logoutAll() {
    setBusy(true);
    setLogoutError(null);
    const res = await apiJson<undefined>("/api/auth/logout-all", { method: "POST" });
    setBusy(false);
    if (res.ok || res.status === 401) {
      setConfirmLogoutAll(false);
      router.push("/login");
      router.refresh();
    } else {
      setLogoutError(errorText(locale, res.error));
    }
  }

  const passwordErrorId = notice?.kind === "error" ? `${ids}-notice` : undefined;

  return (
    <SettingsSection id="account" title={t("settings.account.title")}>
      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-6 gap-y-1">
        <dt className="t-body text-fg-muted">{t("settings.account.username")}</dt>
        <dd className="t-body font-medium">{username}</dd>
        <dt className="t-meta text-fg-muted">{t("settings.account.member_since_label")}</dt>
        <dd className="t-meta text-fg-muted">{formatDate(createdAt, locale)}</dd>
      </dl>

      <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
        <h3 className="t-body font-medium">{t("settings.account.change_password")}</h3>
        <div className="flex flex-wrap gap-4">
          <div className="flex w-56 flex-col gap-1">
            <Label htmlFor={`${ids}-current`}>{t("settings.account.current_password")}</Label>
            <Input
              id={`${ids}-current`}
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              disabled={busy}
              aria-describedby={passwordErrorId}
            />
          </div>
          <div className="flex w-56 flex-col gap-1">
            <Label htmlFor={`${ids}-next`}>{t("settings.account.new_password")}</Label>
            <Input
              id={`${ids}-next`}
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              disabled={busy}
              aria-describedby={`${ids}-hint${passwordErrorId ? ` ${passwordErrorId}` : ""}`}
            />
            <p id={`${ids}-hint`} className="t-meta text-fg-muted">
              {t("auth.password_hint")}
            </p>
          </div>
        </div>
        {notice && (
          <SettingsNotice kind={notice.kind} id={`${ids}-notice`}>
            {notice.text}
          </SettingsNotice>
        )}
        <div>
          <Button type="submit" size="sm" disabled={busy || current.length === 0 || next.length === 0}>
            {busy ? t("auth.submitting") : t("settings.account.change_password")}
          </Button>
        </div>
        <p className="t-meta text-fg-muted">{t("settings.account.change_password_hint")}</p>
      </form>

      <div className="flex flex-col gap-1.5">
        {confirmLogoutAll ? (
          // The same inline confirmation the Queries page uses (spec §11), so Esc cancels here
          // too and focus goes back to the button that asked, on both pages.
          <InlineConfirm
            question={t("settings.account.logout_all_title")}
            confirmLabel={t("settings.account.logout_all")}
            cancelLabel={t("common.cancel")}
            busy={busy}
            size="sm"
            align="start"
            restoreFocusTo='[data-testid="logout-all"]'
            onConfirm={() => void logoutAll()}
            onCancel={() => setConfirmLogoutAll(false)}
            data-testid="logout-all-confirm"
          />
        ) : (
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirmLogoutAll(true)}
              disabled={busy}
              data-testid="logout-all"
            >
              {t("settings.account.logout_all")}
            </Button>
          </div>
        )}
        <p className="t-meta text-fg-muted">{t("settings.account.logout_all_hint")}</p>
        {logoutError && <SettingsNotice kind="error">{logoutError}</SettingsNotice>}
      </div>
    </SettingsSection>
  );
}
