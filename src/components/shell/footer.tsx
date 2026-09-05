import Link from "next/link";
import { translator, type Locale } from "@/lib/i18n";

/** Required on every page (kickoff §0.2 #4): "Data: seats.aero" attribution + stale-data caveat. */
export function Footer({ locale }: { locale: Locale }) {
  const t = translator(locale);
  return (
    <footer className="mt-auto border-t border-border">
      <div className="mx-auto flex max-w-screen-2xl flex-col gap-1 px-3 py-3 text-xs text-muted-foreground sm:flex-row sm:items-baseline sm:gap-4 sm:px-4">
        <span className="shrink-0 font-medium text-foreground/80">{t("footer.attribution")}</span>
        <span className="min-w-0 flex-1">{t("footer.caveat")}</span>
        <span className="flex shrink-0 items-center gap-3">
          <span className="hidden lg:inline">{t("footer.no_affiliation")}</span>
          <Link href="/legal" className="underline-offset-2 hover:text-foreground hover:underline">
            {t("footer.legal")}
          </Link>
        </span>
      </div>
    </footer>
  );
}
