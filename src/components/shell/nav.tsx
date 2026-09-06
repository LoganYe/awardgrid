"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/** Grid · Queries · Settings — three text links, the current one underlined (spec §2). */
export const NAV_ITEMS = [
  { href: "/grid", key: "nav.grid" },
  { href: "/queries", key: "nav.queries" },
  { href: "/settings", key: "nav.settings" },
] as const;

export function Nav({ className, orientation = "horizontal" }: { className?: string; orientation?: "horizontal" | "vertical" }) {
  const t = useT();
  const pathname = usePathname();
  return (
    <nav
      aria-label={t("nav.primary")}
      className={cn("flex", orientation === "vertical" ? "flex-col gap-2" : "items-center gap-5", className)}
    >
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "t-body whitespace-nowrap py-1 hover:text-fg",
              active ? "text-fg underline decoration-fg decoration-2 underline-offset-[6px]" : "text-fg-muted",
            )}
          >
            {t(item.key)}
          </Link>
        );
      })}
    </nav>
  );
}
