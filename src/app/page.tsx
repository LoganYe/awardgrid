import Link from "next/link";
import { redirect } from "next/navigation";
import { PageColumn } from "@/components/shell/page-column";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/next";
import { getT } from "@/lib/i18n/server";

/**
 * / — the front door (docs/UI_PLAN.md §6.10). Signed in, this is the one hop to the grid it has
 * always been; signed out, it is the only screen that says what this is, that there is no public
 * signup, and that every search runs on the visitor's own paid seats.aero Pro key. That last one
 * is the disclosure README's step 2 was missing: the operator sends a code and a URL, and until
 * now the URL led to a password form that explained none of it.
 *
 * The page reads no user data beyond the session, so it has no empty state and nothing on it
 * varies by user, key, quota or locale beyond the two dictionaries. The `.catch(() => null)`
 * mirrors src/app/layout.tsx:34: a SQLite blip must render the front door at the app's root URL,
 * never a 500. No `metadata` export — the layout's default title "awardgrid" applies, and a
 * `title` here would render "Home | awardgrid" through the `%s` template. No `searchParams`:
 * `/?code=…` is never read and never rendered; the operator keeps sending `/register?code=…`.
 */
export default async function Home() {
  const user = await getCurrentUser().catch(() => null);
  if (user) redirect("/grid");
  const { t } = await getT();
  return (
    <PageColumn className="py-8">
      <h1 className="t-title">{t("app.tagline")}</h1>
      <p className="t-body max-w-[72ch]">{t("home.lead")}</p>

      {/* Three blocks, no rules and no cards: §4 gives a border only where two kinds of
          information meet, and §6.8 Settings is the precedent — heading, 8 px, prose, and the
          24 px between blocks comes from PageColumn's own gap-6. */}
      <div className="flex flex-col gap-2">
        <h2 className="t-section">{t("home.invite.label")}</h2>
        <p className="t-body max-w-[72ch]">{t("home.invite.body")}</p>
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="t-section">{t("home.key.label")}</h2>
        <p className="t-body max-w-[72ch]">{t("home.key.body")}</p>
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="t-section">{t("home.limits.label")}</h2>
        <p className="t-body max-w-[72ch]">{t("home.limits.body")}</p>
      </div>

      {/*
       * Both controls go through Button (precedent: SaveQueryDialog.tsx:162) so they emit
       * `data-slot="button"`, which globals.css:262 grows to --row-touch under
       * `(max-width: 767px), (pointer: coarse)`. A bare <a className="link"> here would carry no
       * such rule and would sit under the 40 px floor — and `smallTargets` in
       * e2e/responsive.spec.ts exempts inline anchors (WCAG 2.5.8) from its measurement, so
       * nothing would have caught it. No line number: this change moves that guard down the file.
       *
       * `h-auto px-0` on the secondary is not decoration. cva emits size classes after variant
       * classes, so tailwind-merge drops variant="link"'s own `h-auto px-0` and the control
       * renders as a 32 px padded box; className is merged last and wins it back.
       */}
      <div className="flex flex-col items-start gap-4 md:flex-row md:items-center">
        <Button size="lg" nativeButton={false} render={<Link href="/login" />} className="w-full md:w-auto">
          {t("home.login_link")}
        </Button>
        <Button variant="link" nativeButton={false} render={<Link href="/register" />} className="h-auto px-0">
          {t("home.register_link")}
        </Button>
      </div>
    </PageColumn>
  );
}
