"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { LocaleToggle } from "@/components/shell/locale-toggle";
import { LogoutButton } from "@/components/shell/logout-button";
import { Nav } from "@/components/shell/nav";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { useT } from "@awardgrid/core/i18n/client";
import { cn } from "@/lib/utils";

/**
 * Below 768 px the signed-in top bar keeps name, quota and this "Menu" button (spec §6). The
 * panel it reveals holds the nav, the language and theme toggles and "Log out"; it closes on
 * Escape and on navigation.
 */
export function MobileMenu({ username, className }: { username: string; className?: string }) {
  const t = useT();
  const pathname = usePathname();
  // The panel remembers the path it was opened on, so navigating closes it without an effect.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === pathname;
  const setOpen = (next: boolean) => setOpenedOn(next ? pathname : null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") setOpenedOn(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className={cn("contents", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
        className="t-body rounded-lg px-0.5 py-1 text-fg md:hidden"
      >
        {t(open ? "nav.menu_close" : "nav.menu")}
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute inset-x-0 top-full z-30 flex flex-col gap-4 border-b border-line bg-bg px-gutter py-4 md:hidden"
      >
        <Nav orientation="vertical" />
        <div className="flex items-center gap-6 border-t border-line pt-4">
          <LocaleToggle />
          <ThemeToggle />
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-line pt-4">
          <span className="t-body truncate text-fg-muted">{t("nav.signed_in_as", { username })}</span>
          <LogoutButton className="shrink-0 px-0.5 py-1" />
        </div>
      </div>
    </div>
  );
}
