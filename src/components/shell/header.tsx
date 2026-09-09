import Link from "next/link";
import { LocaleToggle } from "@/components/shell/locale-toggle";
import { MobileMenu } from "@/components/shell/mobile-menu";
import { Nav } from "@/components/shell/nav";
import { QuotaIndicator } from "@/components/shell/quota-indicator";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { UserMenu } from "@/components/shell/user-menu";
import { translator, type Locale } from "@awardgrid/core/i18n";

/**
 * The 48 px top bar (spec §2, docs/UI_PLAN.md §6.1). Text only — no logo, no icons.
 *   signed in, ≥ 768:  awardgrid   Grid Queries Settings        312 / 1,000 today  EN 中文  System  alice ▾
 *   signed in, < 768:  awardgrid                                 312 / 1,000        Menu
 *   signed out:        awardgrid                                                    EN 中文  System
 */
export function Header({ locale, username }: { locale: Locale; username: string | null }) {
  const t = translator(locale);
  return (
    <header className="relative z-30 h-topbar border-b border-line bg-bg">
      <div className="flex h-full items-center gap-6 px-gutter">
        <Link href="/grid" className="t-body shrink-0 font-medium text-fg">
          {t("app.name")}
        </Link>
        {username && <Nav className="hidden md:flex" />}
        <div className="ml-auto flex min-w-0 items-center gap-4">
          {username && <QuotaIndicator />}
          {username ? (
            <>
              <div className="hidden items-center gap-4 md:flex">
                <LocaleToggle />
                <ThemeToggle />
                <UserMenu username={username} />
              </div>
              <MobileMenu username={username} />
            </>
          ) : (
            <>
              <LocaleToggle />
              <ThemeToggle />
            </>
          )}
        </div>
      </div>
    </header>
  );
}
