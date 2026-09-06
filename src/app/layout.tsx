import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Footer } from "@/components/shell/footer";
import { Header } from "@/components/shell/header";
import { getCurrentUser } from "@/lib/auth/next";
import { htmlLang } from "@/lib/i18n";
import { LocaleProvider } from "@/lib/i18n/client";
import { getLocale } from "@/lib/i18n/server";
import { THEME_SCRIPT } from "@/lib/theme";
import { ThemeProvider } from "@/lib/theme/client";
import { getTheme } from "@/lib/theme/server";

export const metadata: Metadata = {
  title: { default: "awardgrid", template: "%s | awardgrid" },
  description: "Private award-flight grid on seats.aero data.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
};

/**
 * Root layout (spec §2). Reads the `ag_locale` and `ag_theme` cookies (every route is dynamic —
 * fine for a private, authenticated app) and the session, so the server renders
 * <html data-theme> and the signed-in top bar without a flash. The inline script in <head>
 * re-applies the cookie before paint for cached documents. Fonts are self-hosted (globals.css);
 * no next/font, no network.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const user = await getCurrentUser().catch(() => null);
  const theme = await getTheme(user?.theme);
  return (
    <html lang={htmlLang(locale)} data-theme={theme} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-dvh flex-col bg-bg text-fg">
        <LocaleProvider locale={locale}>
          <ThemeProvider theme={theme} persist={user !== null}>
            <Header locale={locale} username={user?.username ?? null} />
            <main className="flex w-full flex-1 flex-col px-gutter py-4">{children}</main>
            <Footer locale={locale} />
          </ThemeProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
