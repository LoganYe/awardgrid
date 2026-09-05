/**
 * /queries — the user's standing queries (kickoff §8 "Saved Queries page": list, last run,
 * toggle, run now). Server component: requires a session, reads the user's own rows and the
 * Telegram link state, and hands plain JSON to the client table.
 */
import type { Metadata } from "next";
import { QueriesTable } from "@/components/queries/queries-table";
import { requireUser } from "@/lib/auth/next";
import { getT } from "@/lib/i18n/server";
import { getServerDb } from "@/lib/server/db";
import { listSavedQueries } from "@/lib/server/queries";

export const metadata: Metadata = { title: "Saved queries" };
export const dynamic = "force-dynamic";

export default async function QueriesPage() {
  const user = await requireUser();
  const { t } = await getT();
  const db = getServerDb();
  const queries = listSavedQueries(db, user.id);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <h1 className="text-lg font-semibold">{t("saved.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("saved.subtitle")}</p>
      </header>
      <QueriesTable initial={queries} telegramLinked={user.telegramChatId !== null} />
    </div>
  );
}
