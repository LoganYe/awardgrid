import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { LocaleToggle } from "@/components/shell/locale-toggle";
import { Nav } from "@/components/shell/nav";
import { translator, type Locale } from "@/lib/i18n";

/** Text-only app header: name · nav · locale toggle · user menu. No logos, no images. */
export function Header({ locale, userSlot }: { locale: Locale; userSlot: ReactNode }) {
  const t = translator(locale);
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-11 max-w-screen-2xl items-center gap-3 px-3 sm:px-4">
        <Link href="/grid" className="shrink-0 font-mono text-sm font-semibold tracking-tight">
          {t("app.name")}
        </Link>
        <Nav className="-mx-1 min-w-0 flex-1" />
        <div className="flex shrink-0 items-center gap-2">
          <LocaleToggle />
          <Suspense fallback={<span className="h-4 w-12 rounded bg-muted" aria-hidden />}>{userSlot}</Suspense>
        </div>
      </div>
    </header>
  );
}
