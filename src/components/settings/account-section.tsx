"use client";

/** Account: username, member-since, and "sign out everywhere" (POST /api/auth/logout-all). */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { errorText } from "@/lib/i18n";
import { useLocale, useT } from "@/lib/i18n/client";
import { apiJson, formatDate } from "./api";
import { SettingsSection } from "./section";

export function AccountSection({ username, createdAt }: { username: string; createdAt: string }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function logoutAll() {
    setBusy(true);
    setError(null);
    const res = await apiJson<undefined>("/api/auth/logout-all", { method: "POST" });
    setBusy(false);
    if (res.ok || res.status === 401) {
      setOpen(false);
      router.push("/login");
      router.refresh();
    } else {
      setError(errorText(locale, res.error));
    }
  }

  return (
    <SettingsSection id="account" title={t("settings.account.title")}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{t("settings.account.username")}</dt>
        <dd className="font-medium">{username}</dd>
      </dl>
      <p className="text-xs text-muted-foreground">{t("settings.account.member_since", { date: formatDate(createdAt, locale) })}</p>
      <div className="flex flex-col gap-1.5">
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} disabled={busy}>
            {t("settings.account.logout_all")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t("settings.account.logout_all_hint")}</p>
      </div>
      {error && (
        <Alert variant="destructive" aria-live="polite">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.account.logout_all_title")}</DialogTitle>
            <DialogDescription>{t("settings.account.logout_all_body")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" size="sm" />}>{t("common.cancel")}</DialogClose>
            <Button variant="destructive" size="sm" onClick={logoutAll} disabled={busy}>
              {t("settings.account.logout_all")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}
