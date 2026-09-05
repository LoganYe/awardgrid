import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Footer } from "@/components/shell/footer";
import { Header } from "@/components/shell/header";
import { UserMenu } from "@/components/shell/user-menu";
import { htmlLang } from "@/lib/i18n";
import { LocaleProvider } from "@/lib/i18n/client";
import { getLocale } from "@/lib/i18n/server";

export const metadata: Metadata = {
  title: { default: "awardgrid", template: "%s · awardgrid" },
  description: "Private award-flight grid on seats.aero data.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
};

/**
 * Root layout. Reads the `ag_locale` cookie (so every route is dynamic — fine for a private,
 * authenticated app) and feeds the locale to client components through LocaleProvider.
 * System font stack only (no next/font — no network at build time).
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={htmlLang(locale)}>
      <body className="flex min-h-dvh flex-col">
        <LocaleProvider locale={locale}>
          <Header locale={locale} userSlot={<UserMenu locale={locale} />} />
          <main className="mx-auto w-full max-w-screen-2xl flex-1 px-3 py-4 sm:px-4">{children}</main>
          <Footer locale={locale} />
        </LocaleProvider>
      </body>
    </html>
  );
}
