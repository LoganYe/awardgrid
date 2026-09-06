import Link from "next/link";
import pkg from "../../../package.json";
import { translator, type Locale } from "@/lib/i18n";

/**
 * One 32 px line on every page: "Data: seats.aero" │ v0.2.0 │ Legal. The vertical rules are
 * 1 px --line borders, 12 px tall — the only separator glyph in the app (spec §2).
 */
export function Footer({ locale }: { locale: Locale }) {
  const t = translator(locale);
  return (
    <footer className="mt-auto flex h-footer shrink-0 items-center border-t border-line px-gutter t-meta text-fg-muted">
      <span className="leading-3">{t("footer.attribution")}</span>
      <span className="ml-3 border-l border-line pl-3 leading-3">{t("footer.version", { version: pkg.version })}</span>
      <Link href="/legal" className="link ml-3 border-l border-line pl-3 leading-3">
        {t("footer.legal")}
      </Link>
    </footer>
  );
}
