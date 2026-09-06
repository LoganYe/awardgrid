import Link from "next/link";
import { PageColumn } from "@/components/shell/page-column";
import { getT } from "@/lib/i18n/server";

export default async function NotFound() {
  const { t } = await getT();
  return (
    <PageColumn className="gap-2 py-8">
      <p className="t-body text-fg">{t("common.not_found")}</p>
      <p className="t-body">
        <Link href="/grid" className="link">
          {t("common.go_to_grid")}
        </Link>
      </p>
    </PageColumn>
  );
}
