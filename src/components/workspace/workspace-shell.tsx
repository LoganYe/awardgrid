"use client";
/**
 * The Web workspace's navigation (UI/UX v1 T18; the 72-wide rail is T19): Search, Saved, Queries, Settings, and a
 * visible Log out. Logging out ends the session, then removes every account's workspace and conversation from this
 * browser before the login page mounts; saved options stay, each under its own account.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useT } from "@awardgrid/core/i18n/client";
import { clearAskSession } from "@/components/ask/history";
import { forgetWorkspacesOnDevice } from "./storage";

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const links = [
    { href: "/workspace", label: t("nav.workspace") },
    { href: "/workspace/saved", label: t("nav.favorites") },
    { href: "/queries", label: t("nav.queries") },
    { href: "/settings", label: t("nav.settings") },
  ];

  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } finally {
      clearAskSession();
      forgetWorkspacesOnDevice();
      setBusy(false);
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <div className="ag-web-shell">
      <nav className="ag-web-nav" aria-label={t("nav.menu")}>
        {links.map((link) => (
          <Link key={link.href} href={link.href} className="ag-web-nav-link" aria-current={pathname === link.href ? "page" : undefined}>
            {link.label}
          </Link>
        ))}
        <button type="button" className="ag-web-nav-link" disabled={busy} onClick={() => void logout()}>
          {t("nav.logout")}
        </button>
      </nav>
      <div className="ag-web-main">{children}</div>
    </div>
  );
}
