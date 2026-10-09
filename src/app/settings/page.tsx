/**
 * /settings (spec §5, docs/UI_PLAN.md §6.8) — one 880 px column, five sections in this order:
 * seats.aero (Login with Seats.aero + today's quota), optional API keys (Duffel, Ignav), Telegram
 * (linking + quiet hours), Account, Language and theme. Headings and space separate them; there
 * are no cards and no borders.
 *
 * Server component: requires a session (redirects to /login), reads whether seats.aero is
 * connected (a boolean and a date, never a token), masked key summaries and the api_usage row,
 * and hands only safe fields to the client sections. `?seats=<outcome>` is how a seats.aero
 * sign-in that just came back ended (src/app/api/seats/oauth/callback/route.ts).
 */
import type { Metadata } from "next";
import { AccountSection } from "@/components/settings/account-section";
import { KeysSection } from "@/components/settings/keys-section";
import { LanguageThemeSection } from "@/components/settings/language-theme-section";
import { SeatsSection } from "@/components/settings/seats-section";
import { TelegramSection } from "@/components/settings/telegram-section";
import { PageColumn } from "@/components/shell/page-column";
import { requireUser } from "@/lib/auth/next";
import { getT } from "@/lib/i18n/server";
import { listKeys } from "@/lib/keys";
import { connectionStatus, isConnectOutcome, reconnectNoticeDue, seatsOAuthConfigFromEnv } from "@/lib/seats-oauth";
import { getServerDb } from "@/lib/server/db";
import { telegramConfigured } from "@/lib/server/queries";
import { getTodayUsage } from "@/lib/server/usage";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ seats?: string | string[] }> }) {
  const user = await requireUser();
  const { locale, t } = await getT();
  const db = getServerDb();
  const keys = listKeys(db, user.id);
  const usage = getTodayUsage(db, user.id);
  const seats = connectionStatus(db, user.id);
  const params = await searchParams;
  const outcome = Array.isArray(params.seats) ? params.seats[0] : params.seats;

  return (
    <PageColumn>
      <h1 className="t-title">{t("settings.title")}</h1>
      <SeatsSection
        userId={user.id}
        connected={seats.connected}
        connectedAt={seats.connectedAt}
        configured={seatsOAuthConfigFromEnv() !== null}
        reconnectNotice={reconnectNoticeDue(db, user.id)}
        outcome={isConnectOutcome(outcome) ? outcome : null}
        quota={{ used: usage.used, limit: usage.limit, hardLimit: usage.hardLimit, resetAt: usage.resetAt }}
      />
      <KeysSection keys={keys} />
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
