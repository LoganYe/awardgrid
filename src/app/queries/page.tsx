/**
 * /queries — the user's standing queries (spec §4, docs/UI_PLAN.md §6.7). Server component:
 * requires a session, reads the user's own rows plus each one's next run, last 20 runs and last
 * diff (data.ts), and hands plain JSON to the client table. No subtitle under the title: a page
 * title needs no pitch under it (docs/UI_PLAN.md §8).
 */
import type { Metadata } from "next";
import { QueriesTable } from "@/components/queries/queries-table";
import { requireUser } from "@/lib/auth/next";
import { getT } from "@/lib/i18n/server";
import { getServerDb } from "@/lib/server/db";
import { loadQueriesPageData } from "./data";

export const metadata: Metadata = { title: "Standing queries" };
export const dynamic = "force-dynamic";

export default async function QueriesPage() {
  const user = await requireUser();
  const { t } = await getT();
  const db = getServerDb();
  const { queries, details } = loadQueriesPageData(db, user.id);
  return (
    <div className="flex w-full max-w-content flex-col gap-4">
      <h1 className="t-title">{t("saved.title")}</h1>
      <QueriesTable initial={queries} details={details} telegramLinked={user.telegramChatId !== null} />
    </div>
  );
}
