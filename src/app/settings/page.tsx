/**
 * /settings — keys (+ today's quota), Telegram linking + quiet hours, language, account.
 * Server component: requires a session (redirects to /login), reads masked key summaries and
 * the api_usage row, and hands only safe fields to the client sections. Nothing here can see
 * a plaintext key: listKeys() returns last4 + mask, and the User type omits the password hash.
 */
import type { Metadata } from "next";
import { AccountSection } from "@/components/settings/account-section";
import { KeysSection } from "@/components/settings/keys-section";
import { LanguageSection } from "@/components/settings/language-section";
import { TelegramSection } from "@/components/settings/telegram-section";
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
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <h1 className="text-lg font-semibold">{t("settings.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("settings.subtitle")}</p>
      </header>
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
      {/* Shows the language currently in effect (cookie); saving writes it to the account too. */}
      <LanguageSection locale={locale} />
      <AccountSection username={user.username} createdAt={user.createdAt} />
    </div>
  );
}
