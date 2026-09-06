/**
 * axe-core audit of the current UI. Runs on the desktop projects only, writes counts per impact
 * to docs/screenshots/v0.2/axe-summary.json (the 6.0 baseline stays untouched under before/)
 * and logs every serious/critical violation id. The §8 floor ("zero serious/critical") is
 * enforced now for the pages 6.1 restyled (login, register, legal) and the 6.2 grid results
 * page in both themes; settings and queries join once their sub-phases land — flip AXE_STRICT
 * (or set E2E_AXE_STRICT=1).
 */
import AxeBuilder from "@axe-core/playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { applyTheme, AXE_SUMMARY_FILE, expect, loginAs, openAskDrawer, openCellDrawer, openGridWithResults, test } from "./fixtures";

const AXE_STRICT = process.env.E2E_AXE_STRICT === "1";
const SUMMARY_FILE = AXE_SUMMARY_FILE;
/** Pages already held to the §8 floor (zero serious/critical) regardless of AXE_STRICT. */
const STRICT_PAGES = new Set([
  "login",
  "register",
  "legal",
  "grid-results",
  "grid-chip-editor",
  "grid-cell-drawer",
  "grid-ask-drawer",
  "queries",
  "queries-expanded",
  "queries-edit-drawer",
  "settings",
]);
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
  return { generated_at: new Date().toISOString(), note: "axe-core audit of the current UI; counts per impact per page and project (strict for login, register, legal and grid-results)", pages: {} };
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
  // Name the offending elements so a failure is actionable from the run log alone.
  for (const v of results.violations) {
    if (v.impact !== "critical" && v.impact !== "serious") continue;
    for (const node of v.nodes) console.log(`  ${v.id}: ${node.target.join(" ")} — ${node.failureSummary?.split("\n").slice(0, 2).join(" ") ?? ""}`);
  }

  const summary = readSummary();
  summary.generated_at = new Date().toISOString();
  summary.pages[`${test.info().project.name}/${key}`] = { url: page.url(), counts, violations };
  mkdirSync(path.dirname(SUMMARY_FILE), { recursive: true });
  writeFileSync(SUMMARY_FILE, `${JSON.stringify(summary, null, 2)}\n`);

  if (AXE_STRICT || STRICT_PAGES.has(key)) expect(bad, "serious/critical axe violations").toEqual([]);
}

/**
 * Most audits run on the desktop projects only. The two drawer audits are the exception: below
 * 768 px the same drawers become a full-height sheet and a bottom sheet with a drag handle
 * (spec §6) — different roles, different focus order, different touch targets — so the mobile
 * presentations are audited as well as the desktop ones.
 */
const MOBILE_TOO = new Set(["grid-cell-drawer", "grid-ask-drawer"]);

test.describe("axe", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith("desktop") && !MOBILE_TOO.has(testInfo.title), "desktop projects only");
    await applyTheme(page);
  });

  test("login", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
    await audit(page, "login");
  });

  test("register", async ({ page }) => {
    await page.goto("/register");
    await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
    await audit(page, "register");
  });

  test("legal", async ({ page }) => {
    await loginAs(page, "demo");
    await page.goto("/legal");
    await expect(page.getByRole("article")).toBeVisible();
    await audit(page, "legal");
  });

  test("grid-results", async ({ page }) => {
    await openGridWithResults(page);
    await audit(page, "grid-results");
  });

  /**
   * The grid with a chip editor open (6.3): the popover is the densest interactive surface on the
   * page — a search combobox, city group rows with per-airport toggles and the free-entry field —
   * and it renders over the grid, so its contrast and its names are audited in both themes.
   */
  test("grid-chip-editor", async ({ page }) => {
    await openGridWithResults(page);
    await page.locator('[data-chip="origins"]').click();
    await expect(page.locator('[data-slot="popover-content"]')).toBeVisible();
    await audit(page, "grid-chip-editor");
  });

  /**
   * The grid with the cell drawer open (6.4). At the desktop viewport the drawer pushes rather
   * than overlays, so the grid behind it is still in the accessibility tree: this audit covers
   * the drawer's own headings, the freshness marks, the caveat line and the action buttons AND
   * the page they sit beside, in both themes.
   */
  test("grid-cell-drawer", async ({ page }) => {
    await openGridWithResults(page);
    await openCellDrawer(page);
    await audit(page, "grid-cell-drawer");
  });

  /**
   * The grid with the Ask drawer open (6.4): context pills, the suggestion buttons, the composer
   * and the cost meter. The scripted stream is not involved — an empty, idle drawer is the state
   * every other one is drawn on top of.
   */
  test("grid-ask-drawer", async ({ page }) => {
    await openGridWithResults(page);
    await openAskDrawer(page);
    await audit(page, "grid-ask-drawer");
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

  /**
   * The expanded row (6.5): a disclosure holding the last diff as real grid cells — each in its
   * own one-cell grid with a caption — plus the run-history table. Two nested tabular structures
   * inside a row of a third is the densest markup on the page, so it is audited on its own.
   */
  test("queries-expanded", async ({ page }) => {
    await loginAs(page, "demo");
    await page.goto("/queries");
    await page.locator('[data-testid^="details-"]').first().click();
    await expect(page.locator('[id^="query-details-"]').first()).toBeVisible();
    await audit(page, "queries-expanded");
  });

  /**
   * The edit drawer (6.5) with a chip editor open over it: the drawer's own form plus the grid's
   * popover, which is where a focus-order or a name mistake would show up first.
   */
  test("queries-edit-drawer", async ({ page }) => {
    await loginAs(page, "demo");
    await page.goto("/queries");
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    const drawer = page.getByTestId("edit-query-drawer");
    await expect(drawer).toBeVisible();
    await drawer.locator('[data-chip="origins"]').click();
    await expect(page.locator('[data-slot="popover-content"]')).toBeVisible();
    await audit(page, "queries-edit-drawer");
  });
});
