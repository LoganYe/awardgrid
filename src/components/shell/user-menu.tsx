"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { LogoutButton } from "@/components/shell/logout-button";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/**
 * `alice ▾` — the user menu (spec §2): a button showing the username, opening a small popover
 * with the account line and "Log out". The chevron is the one functional glyph in the top bar.
 * Popover ground --bg-raised with a 1 px --line-strong edge; opens with a 150 ms fade (0 under
 * reduced motion); Escape and outside clicks close it and focus returns to the button.
 */
export function UserMenu({ username, className }: { username: string; className?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    }
    if (e.key === "ArrowDown" && open) {
      e.preventDefault();
      rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    }
  }

  return (
    <div ref={rootRef} className={cn("relative", className)} onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t("nav.signed_in_as", { username })}
        onClick={() => setOpen((v) => !v)}
        className="t-body inline-flex max-w-40 items-center gap-1 rounded-lg px-0.5 py-1 text-fg"
      >
        <span className="truncate">{username}</span>
        <span aria-hidden className="text-fg-muted">
          ▾
        </span>
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={t("nav.account")}
          className="absolute top-full right-0 z-40 mt-1 min-w-40 rounded-xl border border-line-strong bg-bg-raised p-1 animate-in fade-in-0 slide-in-from-top-1 duration-150"
        >
          <div role="none" className="t-meta truncate px-2 py-1 text-fg-muted">
            {t("nav.signed_in_as", { username })}
          </div>
          <LogoutButton role="menuitem" className="w-full px-2 py-1.5 text-left hover:bg-bg" />
        </div>
      )}
    </div>
  );
}
