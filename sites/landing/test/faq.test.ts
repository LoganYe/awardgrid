/**
 * The FAQPage JSON-LD of every page is what the page shows. scripts/growth/sync-faq-schema.mjs --check runs on each
 * page that has a data-faq section, and once on the whole site, so a page without an FAQ carries no FAQPage either. A
 * visible question or answer edited without `node scripts/growth/sync-faq-schema.mjs --write` fails here, and so in CI
 * (the landing job runs these tests). The convention the pages follow is in the script's header.
 *
 * The pages with an FAQ are found here by a plain pattern, not by the script, so a page the script failed to find is
 * still checked. Nothing here writes a page; the one drift test works on a copy in a temp directory.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const SITE = path.join(import.meta.dirname, "..");
const REPO = path.join(SITE, "..", "..");
const SCRIPT = path.join(REPO, "scripts", "growth", "sync-faq-schema.mjs");

/** Every index.html of the site's source, found by walking it (build output, dependencies, public/, test/ and scripts/ aside). */
function sourcePages(dir = SITE, rel = ""): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        return ["dist", "node_modules", "public", "test", "scripts"].includes(entry.name) || entry.name.startsWith(".") ? [] : sourcePages(path.join(dir, entry.name), child);
      }
      return entry.isFile() && entry.name === "index.html" ? [child] : [];
    })
    .sort();
}

const read = (page: string) => readFileSync(path.join(SITE, page), "utf8");
/** Does the page (comments aside) hold an element with a data-faq attribute? */
const hasFaq = (html: string) => /<[a-z][a-z0-9-]*\b(?:[^'">]|"[^"]*"|'[^']*')*\sdata-faq\b/i.test(html.replace(/<!--[\s\S]*?-->/g, ""));
const PAGES = sourcePages();
const FAQ_PAGES = PAGES.filter((page) => hasFaq(read(page)));

const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: REPO, encoding: "utf8" });

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

describe("FAQPage JSON-LD (scripts/growth/sync-faq-schema.mjs --check)", () => {
  it("finds the site's pages, and the FAQ on the iPhone app's page in both languages", () => {
    expect(PAGES).toEqual(expect.arrayContaining(["index.html", "ios/index.html", "privacy/index.html", "support/index.html"]));
    expect(FAQ_PAGES).toEqual(expect.arrayContaining(["ios/index.html", "ios/zh-hans/index.html"]));
  });

  it.each(FAQ_PAGES)("%s: its FAQPage says what its FAQ shows", (page) => {
    const r = run("--check", path.join(SITE, page));
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/pages=1 with an FAQ=1 questions=[1-9]\d* out of date=0 markup errors=0 \(in sync\)/);
  });

  it("the whole site: every page with an FAQ in sync, and no FAQPage on a page without one", () => {
    const r = run("--check");
    expect(r.status, r.stdout + r.stderr).toBe(0);
    // The script read the same pages this test found, and found an FAQ on the same ones.
    expect(r.stdout).toContain(`pages=${PAGES.length} with an FAQ=${FAQ_PAGES.length} `);
    for (const page of FAQ_PAGES) expect(r.stdout).toContain(`sites/landing/${page} (`);
  });

  it("is not vacuous: an answer edited on a copy of a page with an FAQ fails the check", () => {
    const page = FAQ_PAGES[0];
    expect(page).toBeDefined();
    const html = read(page!);
    // The first answer's first paragraph: the first <p> after the section's first question.
    const edited = html.replace(/(<section\b[^>]*\bdata-faq\b[\s\S]*?<h3\b[\s\S]*?<\/h3>\s*<p\b[^>]*>)/i, "$1Edited. ");
    expect(edited).not.toBe(html);
    const dir = mkdtempSync(path.join(os.tmpdir(), "faq-drift-"));
    temps.push(dir);
    const file = path.join(dir, "index.html");
    writeFileSync(file, edited);
    const r = run("--check", file);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/FAQ_SCHEMA .*index\.html: question 1 .*FAQPage's answer is not the page's/);
  });
});
