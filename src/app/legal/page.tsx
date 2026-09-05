import type { Metadata } from "next";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Markdown } from "@/components/shell/markdown";
import { getT } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Legal" };

/** Renders the repository's LEGAL.md (read with node:fs at request time; shipped in the image). */
export default async function LegalPage() {
  const { t } = await getT();
  let source: string;
  try {
    source = await readFile(path.join(process.cwd(), "LEGAL.md"), "utf8");
  } catch {
    source = `# ${t("legal.title")}\n\nLEGAL.md is missing from this deployment.`;
  }
  return (
    <article className="mx-auto max-w-3xl text-sm leading-relaxed text-foreground/90">
      <Markdown source={source} />
    </article>
  );
}
