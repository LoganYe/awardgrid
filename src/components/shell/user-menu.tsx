import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/next";
import { LogoutButton } from "@/components/shell/logout-button";
import { translator, type Locale } from "@/lib/i18n";

/**
 * Server component: username + logout when signed in, otherwise a login link.
 * Rendered inside <Suspense> by the header so the cookie read does not block the shell.
 * Only `username` reaches the client (User already omits the password hash).
 */
export async function UserMenu({ locale }: { locale: Locale }) {
  const t = translator(locale);
  const user = await getCurrentUser();
  if (!user) {
    return (
      <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground">
        {t("nav.login")}
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-1.5" title={t("nav.signed_in_as", { username: user.username })}>
      <span className="max-w-[10rem] truncate text-sm font-medium">{user.username}</span>
      <LogoutButton />
    </div>
  );
}
