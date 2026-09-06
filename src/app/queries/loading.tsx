/**
 * The Queries page while its rows are being read (spec §4 "Loading: skeleton rows"). Same title
 * and same column, so the real table lands without a jump; the bars are static under
 * prefers-reduced-motion.
 */
import { QueriesSkeleton } from "@/components/queries/queries-table";
import { getT } from "@/lib/i18n/server";

export default async function QueriesLoading() {
  const { t } = await getT();
  return (
    <div className="flex w-full max-w-content flex-col gap-4">
      <h1 className="t-title">{t("saved.title")}</h1>
      <QueriesSkeleton />
    </div>
  );
}
