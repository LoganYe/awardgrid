import Link from "next/link";
import pkg from "../../../package.json";
import { translator, type Locale } from "@/lib/i18n";

/**
 * One 32 px line on every page: "Data: seats.aero" │ the version │ Legal. The version is read
 * from `package.json` at build time, so it is whatever the release actually is — never a literal
 * here that can drift from the tag. The vertical rules are
 * 1 px --line borders, 12 px tall — the only separator glyph in the app (spec §2).
 */
export function Footer({ locale }: { locale: Locale }) {
  const t = translator(locale);
  return (
    <footer className="mt-auto flex h-footer shrink-0 items-center gap-3 border-t border-line px-gutter t-meta text-fg-muted">
      <span className="leading-3">{t("footer.attribution")}</span>
      <Rule />
      <span className="leading-3">{t("footer.version", { version: pkg.version })}</span>
      <Rule />
      {/* `min-w-10` keeps the 40 px touch floor below 768 px, where globals.css turns every
          footer link into a flex box: the separator used to supply the missing width as padding. */}
      <Link href="/legal" className="link min-w-10 justify-center">
        {t("footer.legal")}
      </Link>
    </footer>
  );
}

/**
 * The rule is its own element, not a border on the item beside it: below 768 px every footer
 * link is a 40 px touch target (globals.css), and a border hung off the <Link> grew with it —
 * so the two separators disagreed, one 12 px and one full footer height.
 */
function Rule() {
  return <span aria-hidden="true" className="h-3 w-px shrink-0 bg-line" />;
}
