import Link from "next/link";
import { getT } from "@/lib/i18n/server";

export default async function NotFound() {
  const { t } = await getT();
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-sm text-muted-foreground">
      <p>{t("common.not_found")}</p>
      <Link href="/grid" className="underline underline-offset-2 hover:text-foreground">
        {t("nav.grid")}
      </Link>
    </div>
  );
}
