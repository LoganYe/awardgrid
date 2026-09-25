"use client";
/**
 * The Web workspace's frame (UI/UX v1 T19; docs/04 S10; spec §17): a 72-wide rail on the left — Search, Queries,
 * Saved, and Settings and Log out at its foot — and the page beside it. Below 768 the rail is a bottom bar and the page
 * a single column. The rail is named "Workspace", apart from the site header's own navigation.
 *
 * Logging out ends the session, then removes every account's workspace and conversation from this browser before the
 * login page mounts (T18, U-053); saved options stay, each under its own account.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { BookmarkIcon, ListChecksIcon, LogOutIcon, SearchIcon, SettingsIcon } from "lucide-react";
import { useT } from "@awardgrid/core/i18n/client";
import { clearAskSession } from "@/components/ask/history";
import { forgetWorkspacesOnDevice } from "./storage";

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const top = [
    { href: "/workspace", label: t("nav.workspace"), Icon: SearchIcon },
    { href: "/queries", label: t("nav.queries"), Icon: ListChecksIcon },
    { href: "/workspace/saved", label: t("nav.favorites"), Icon: BookmarkIcon },
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

  const link = ({ href, label, Icon }: (typeof top)[number]) => (
    <Link key={href} href={href} className="ag-ws-rail-item" aria-current={pathname === href ? "page" : undefined}>
      <Icon aria-hidden className="ag-ws-rail-icon" />
      <span>{label}</span>
    </Link>
  );

  return (
    <div className="ag-ws">
      <nav className="ag-ws-rail" aria-label={t("workspace.rail")}>
        <div className="ag-ws-rail-inner">
          <div className="ag-ws-rail-top">{top.map(link)}</div>
          <div className="ag-ws-rail-foot">
            {link({ href: "/settings", label: t("nav.settings"), Icon: SettingsIcon })}
            <button type="button" className="ag-ws-rail-item" disabled={busy} onClick={() => void logout()}>
              <LogOutIcon aria-hidden className="ag-ws-rail-icon" />
              <span>{t("nav.logout")}</span>
            </button>
          </div>
        </div>
      </nav>
      <div className="ag-ws-body">{children}</div>
    </div>
  );
}
