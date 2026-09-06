import type { Metadata } from "next";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Markdown, stripLeadingTitle } from "@/components/shell/markdown";
import { PageColumn } from "@/components/shell/page-column";
import { getT } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Legal" };

/**
 * Renders the repository's LEGAL.md in the 880 px column (read with node:fs at request time;
 * shipped in the image). The page owns the h1 (sentence case, localized); the file's own
 * "# LEGAL" line is dropped.
 */
export default async function LegalPage() {
  const { t } = await getT();
  let source: string;
  try {
    source = stripLeadingTitle(await readFile(path.join(process.cwd(), "LEGAL.md"), "utf8"));
  } catch {
    source = t("legal.missing");
  }
  return (
    <PageColumn>
      <article className="t-body text-fg">
        <h1 className="t-title">{t("legal.title")}</h1>
        <Markdown source={source} />
      </article>
    </PageColumn>
  );
}
