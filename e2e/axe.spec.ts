/**
 * axe-core audit of the CURRENT UI (Phase 6.0 baseline). Runs on the desktop projects only,
 * writes counts per impact to docs/screenshots/v0.2/before/axe-summary.json and logs every
 * serious/critical violation id. It does NOT fail yet: the §8 floor ("zero serious/critical")
 * becomes an assertion once 6.6 lands — flip AXE_STRICT below (or set E2E_AXE_STRICT=1).
 */
import AxeBuilder from "@axe-core/playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { applyTheme, BEFORE_DIR, expect, loginAs, openGridWithResults, test } from "./fixtures";

const AXE_STRICT = process.env.E2E_AXE_STRICT === "1";
const SUMMARY_FILE = path.join(BEFORE_DIR, "axe-summary.json");
type Impact = "critical" | "serious" | "moderate" | "minor";

interface PageSummary {
  url: string;
  counts: Record<Impact, number>;
  violations: { id: string; impact: Impact | null; nodes: number; help: string }[];
}
interface Summary {
  generated_at: string;
  note: string;
  pages: Record<string, PageSummary>;
}

function readSummary(): Summary {
  if (existsSync(SUMMARY_FILE)) {
    try {
      return JSON.parse(readFileSync(SUMMARY_FILE, "utf8")) as Summary;
    } catch {
      /* rewrite below */
    }
  }
  return { generated_at: new Date().toISOString(), note: "axe-core baseline of the v0.1 UI before Phase 6; counts per impact, not yet enforced", pages: {} };
}

async function audit(page: Page, key: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const counts: Record<Impact, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  const violations = results.violations.map((v) => {
    const impact = (v.impact ?? null) as Impact | null;
    if (impact) counts[impact] += 1;
    return { id: v.id, impact, nodes: v.nodes.length, help: v.help };
  });
  const bad = violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  console.log(`axe ${test.info().project.name} ${key}: ${JSON.stringify(counts)}${bad.length ? ` serious/critical: ${bad.map((v) => `${v.id}(${v.nodes})`).join(", ")}` : ""}`);

  const summary = readSummary();
  summary.generated_at = new Date().toISOString();
  summary.pages[`${test.info().project.name}/${key}`] = { url: page.url(), counts, violations };
  mkdirSync(BEFORE_DIR, { recursive: true });
  writeFileSync(SUMMARY_FILE, `${JSON.stringify(summary, null, 2)}\n`);

  if (AXE_STRICT) expect(bad, "serious/critical axe violations").toEqual([]);
}

test.describe("axe baseline", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith("desktop"), "desktop projects only");
    await applyTheme(page);
  });

  test("login", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
    await audit(page, "login");
  });

  test("grid-results", async ({ page }) => {
    await openGridWithResults(page);
    await audit(page, "grid-results");
  });

  test("settings", async ({ page }) => {
    await loginAs(page, "demo");
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await audit(page, "settings");
  });

  test("queries", async ({ page }) => {
    await loginAs(page, "demo");
    await page.goto("/queries");
    await expect(page.getByRole("table")).toBeVisible();
    await audit(page, "queries");
  });
});
