/**
 * /settings (spec §5, docs/UI_PLAN.md §6.8) — one 880 px column, four sections in this order:
 * API keys (+ today's quota), Telegram (linking + quiet hours), Account, Language and theme.
 * Headings and space separate them; there are no cards and no borders.
 *
 * Server component: requires a session (redirects to /login), reads masked key summaries and the
 * api_usage row, and hands only safe fields to the client sections. Nothing here can see a
 * plaintext key: listKeys() returns last4 + mask, and the User type omits the password hash.
 */
import type { Metadata } from "next";
import { AccountSection } from "@/components/settings/account-section";
import { KeysSection } from "@/components/settings/keys-section";
import { LanguageThemeSection } from "@/components/settings/language-theme-section";
import { TelegramSection } from "@/components/settings/telegram-section";
import { PageColumn } from "@/components/shell/page-column";
import { requireUser } from "@/lib/auth/next";
import { getT } from "@/lib/i18n/server";
import { listKeys } from "@/lib/keys";
import { getServerDb } from "@/lib/server/db";
import { telegramConfigured } from "@/lib/server/queries";
import { getTodayUsage } from "@/lib/server/usage";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  const { locale, t } = await getT();
  const db = getServerDb();
  const keys = listKeys(db, user.id);
  const usage = getTodayUsage(db, user.id);

  return (
    <PageColumn>
      <h1 className="t-title">{t("settings.title")}</h1>
      <KeysSection
        keys={keys}
        quota={{ used: usage.used, limit: usage.limit, hardLimit: usage.hardLimit, resetAt: usage.resetAt }}
      />
      <TelegramSection
        timezone={user.timezone}
        quietHoursStart={user.quietHoursStart}
        quietHoursEnd={user.quietHoursEnd}
        telegramLinked={user.telegramChatId !== null}
        telegramMock={!telegramConfigured()}
      />
      <AccountSection username={user.username} createdAt={user.createdAt} />
      {/* Shows the language currently in effect (cookie); choosing one writes it to the account too. */}
      <LanguageThemeSection locale={locale} />
    </PageColumn>
  );
}
