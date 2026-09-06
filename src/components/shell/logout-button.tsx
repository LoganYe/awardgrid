"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/** "Log out": POST /api/auth/logout, then /login. A plain text button; the caller styles it. */
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
