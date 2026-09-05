"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/**
 * Primary navigation — links only to pages that exist today. The "Ask" drawer (Phase 4) returns
 * here when its route lands: have GridApp read an `ask` search param before its ?q= sync runs.
 */
export const NAV_ITEMS = [
  { href: "/grid", key: "nav.grid" },
  { href: "/queries", key: "nav.saved" },
  { href: "/settings", key: "nav.settings" },
] as const;

export function Nav({ className }: { className?: string }) {
  const t = useT();
  const pathname = usePathname();
  return (
    <nav aria-label={t("nav.primary")} className={cn("flex items-center gap-0.5 overflow-x-auto", className)}>
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-2 py-1 text-sm whitespace-nowrap transition-colors hover:bg-muted hover:text-foreground",
              active ? "bg-muted font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {t(item.key)}
          </Link>
        );
      })}
    </nav>
  );
}
