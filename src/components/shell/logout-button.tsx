"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { clearAskSession } from "@/components/ask/history";
import { forgetWorkspacesOnDevice } from "@/components/workspace/storage";
import { useT } from "@awardgrid/core/i18n/client";
import { cn } from "@/lib/utils";

/**
 * "Log out": POST /api/auth/logout, then /login. A plain text button; the caller styles it.
 *
 * The redirect is a same-tab, same-origin navigation, so sessionStorage would survive it: the Ask
 * drawer's per-session history is cleared here, or the next person to log in on a shared machine
 * would open Ask and read the previous user's questions and answers.
 */
export function LogoutButton({ className, role }: { className?: string; role?: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } finally {
      setBusy(false);
      clearAskSession();
      // UI/UX v1 T18: every account's workspace leaves this browser too; saved options stay under their account.
      forgetWorkspacesOnDevice();
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <button type="button" role={role} onClick={logout} disabled={busy} className={cn("t-body rounded-lg text-fg disabled:text-fg-muted", className)}>
      {t("nav.logout")}
    </button>
  );
}
