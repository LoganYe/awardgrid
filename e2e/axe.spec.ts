/**
 * axe-core audit of every page and every state (Phase 6.6, spec §8: "WCAG AA contrast in both
 * themes … zero serious/critical violations").
 *
 * Matrix: login · register · legal · grid-results · the eight chip editors · cell drawer · Ask
 * drawer · quota · no-key · empty results · parse failure · queries (list, expanded, edit
 * drawer, empty) · settings — each on **desktop-light, desktop-dark and mobile-light**. Dark
 * and light are separate runs because contrast is the violation these catch and the two themes
 * are two different palettes; mobile is a separate run because below 768 px the drawers become
 * sheets, the toolbar becomes a sheet and the focus order changes with them.
 *
 * The §8 floor is enforced by default (`E2E_AXE_STRICT` defaults to on; set it to "0" to collect
 * a report without failing). Counts per impact land in docs/screenshots/v0.2/axe-summary.json;
 * the 6.0 baseline stays untouched under before/axe-summary.json.
 */
import AxeBuilder from "@axe-core/playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { en } from "../src/lib/i18n/dictionaries/en";
import {
  applyTheme,
  AXE_SUMMARY_FILE,
  CANONICAL_QUERY_EN,
  expect,
  loginAs,
  openAskDrawer,
  openCellDrawer,
  openGridWithResults,
  submitQuery,
  test,
} from "./fixtures";

/**
 * The §8 floor, on by default since 6.6. `E2E_AXE_STRICT=0` turns it into a report-only run
 * (useful while triaging a new page); anything else — set or unset — enforces it.
 */
const AXE_STRICT = process.env.E2E_AXE_STRICT !== "0";

/**
 * The eight chips in spec order. Inlined rather than imported from chips-model.ts: that module
 * pulls data/places.json, which Playwright's loader cannot import without a JSON attribute
 * (e2e/fixtures.ts inlines the query codec for the same reason). chips.spec.ts pins the order
 * against the real constant, so a divergence here fails there.
 */
const CHIP_ORDER = ["origins", "destinations", "dates", "cabins", "programs", "direct_only", "min_cabin_pct", "sort"] as const;
const SUMMARY_FILE = AXE_SUMMARY_FILE;

type Impact = "critical" | "serious" | "moderate" | "minor";

interface PageSummary {
  url: string;
  /** When this page was last audited — so a reader can tell a fresh entry from a leftover one. */
  at: string;
  counts: Record<Impact, number>;
  violations: { id: string; impact: Impact | null; nodes: number; help: string }[];
}
interface Summary {
  generated_at: string;
  note: string;
  pages: Record<string, PageSummary>;
}

/**
 * What the file says about itself. Written on every audit, never read back from the file: the
 * summary is merged across tests and projects, so a note left in an older file would otherwise
 * outlive the run that was true of it (it did: the committed file still claimed the floor was
 * "strict for login, register and legal" long after 6.6 made it the default everywhere).
 */
const SUMMARY_NOTE =
  "axe-core audit of every page and state, on desktop-light, desktop-dark and mobile-light; zero serious/critical is enforced by default (E2E_AXE_STRICT=0 downgrades it to a report). Each page carries the time it was audited.";

function readSummary(): Summary {
  if (existsSync(SUMMARY_FILE)) {
    try {
      const previous = JSON.parse(readFileSync(SUMMARY_FILE, "utf8")) as Summary;
      // Merge this run's pages into the previous ones (the projects write one file between them),
      // but never inherit the previous run's description of what the file is, and drop entries
      // that this suite can no longer produce: a project that is not audited any more, or an
      // entry with no `at` (written before every entry was stamped — a renamed key, say). Both
      // rules are monotone: neither can delete something the current run has just written.
      const pages: Record<string, PageSummary> = {};
      for (const [key, value] of Object.entries(previous.pages ?? {})) {
        const project = key.split("/")[0] ?? "";
        if (!AUDITED_PROJECTS.has(project) || !value.at) continue;
        pages[key] = value;
      }
      return { ...previous, note: SUMMARY_NOTE, pages };
    } catch {
      /* rewrite below */
    }
  }
  return { generated_at: new Date().toISOString(), note: SUMMARY_NOTE, pages: {} };
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
  summary.pages[`${test.info().project.name}/${key}`] = { url: page.url(), at: summary.generated_at, counts, violations };
  mkdirSync(path.dirname(SUMMARY_FILE), { recursive: true });
  writeFileSync(SUMMARY_FILE, `${JSON.stringify(summary, null, 2)}\n`);

  if (AXE_STRICT) expect(bad, `serious/critical axe violations on ${key}`).toEqual([]);
}

/**
 * Three of the four projects. Dark and light are both audited because contrast is what these
 * runs catch; mobile-light is audited because below 768 px the drawers, the toolbar and the top
 * bar are different components with a different focus order. mobile-dark would only re-check the
 * palette mobile-light and desktop-dark already cover between them.
 */
const AUDITED_PROJECTS = new Set(["desktop-light", "desktop-dark", "mobile-light"]);

/** Wait for /queries to settle into the presentation this project's viewport gets. */
async function expectQueriesReady(page: Page): Promise<void> {
  const mobile = test.info().project.name.startsWith("mobile");
  await expect(page.getByTestId(mobile ? "queries-list" : "queries-table")).toBeVisible();
}

test.describe("axe", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(!AUDITED_PROJECTS.has(testInfo.project.name), "audited on desktop-light, desktop-dark and mobile-light");
    await applyTheme(page);
  });

  // ---- auth and legal ----

  test("login", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: en["auth.login.submit"] })).toBeVisible();
    await audit(page, "login");
  });

  test("register", async ({ page }) => {
    await page.goto("/register");
    await expect(page.getByRole("button", { name: en["auth.register.submit"] })).toBeVisible();
    await audit(page, "register");
  });

  test("legal", async ({ page }) => {
    await loginAs(page, "demo");
    await page.goto("/legal");
    await expect(page.getByRole("article")).toBeVisible();
    await audit(page, "legal");
  });

  // ---- grid ----

  test("grid-results", async ({ page }) => {
    await openGridWithResults(page, "demo", CANONICAL_QUERY_EN);
    await audit(page, "grid-results");
  });

  /**
   * The per-cabin cell layout (docs/UI_PLAN.md §6.2b). The grid's semantics are unchanged — one
   * gridcell per intersection, the same indices — but the cell now stacks one aria-hidden line
   * per cabin and the whole announcement is a longer aria-label, so the grid is audited again
   * with the mode on, at both audited widths.
   */
  test("grid-per-cabin", async ({ page }) => {
    await openGridWithResults(page, "demo", CANONICAL_QUERY_EN);
    const mobile = test.info().project.name.startsWith("mobile");
    let controls = page.getByRole("toolbar");
    if (mobile) {
      await controls.getByRole("button", { name: en["grid.toolbar.filters"] }).click();
      controls = page.getByRole("dialog");
      await expect(controls).toBeVisible();
    }
    await controls.getByRole("group", { name: en["grid.toolbar.cells"] }).getByRole("button", { name: en["grid.toolbar.cells_per_cabin"], exact: true }).click();
    if (mobile) {
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toBeHidden();
    }
    await expect(page.locator(".ag-cabin-line").first()).toBeAttached();
    await audit(page, "grid-per-cabin");
  });

  /**
   * All eight chip editors, in one page load. The popovers are the densest interactive surfaces
   * in the product — a search combobox with a listbox, city group rows with per-airport toggles,
   * a two-month range calendar, checkbox lists, a switch and a select — and every one of them
   * renders over the grid, so each is audited on its own rather than sampled.
   */
  test("grid-chip-editors", async ({ page }) => {
    await openGridWithResults(page, "demo", CANONICAL_QUERY_EN);
    for (const chip of CHIP_ORDER) {
      await page.locator(`[data-chip="${chip}"]`).click();
      await expect(page.locator('[data-slot="popover-content"]')).toBeVisible();
      await audit(page, `grid-chip-${chip}`);
      await page.keyboard.press("Escape");
      await expect(page.locator('[data-slot="popover-content"]')).toBeHidden();
    }
  });

  /**
   * The cell drawer (spec §3.5). At ≥ 1280 it pushes rather than overlays, so the grid beside it
   * is still in the accessibility tree and this audit covers both; below 768 the same drawer is a
   * full-height sheet with 40 px controls, which is why mobile-light runs it too.
   */
  test("grid-cell-drawer", async ({ page }) => {
    await openGridWithResults(page, "demo", CANONICAL_QUERY_EN);
    await openCellDrawer(page);
    await audit(page, "grid-cell-drawer");
  });

  /** The Ask drawer (spec §3.6): context pills, the suggestions, the composer and the cost meter. */
  test("grid-ask-drawer", async ({ page }) => {
    await openGridWithResults(page, "demo", CANONICAL_QUERY_EN);
    await openAskDrawer(page);
    await audit(page, "grid-ask-drawer");
  });

  test("grid-quota", async ({ page }) => {
    await loginAs(page, "quota");
    await page.goto("/grid");
    await submitQuery(page, CANONICAL_QUERY_EN);
    await expect(page.getByTestId("quota-banner")).toBeVisible({ timeout: 60_000 });
    await audit(page, "grid-quota");
  });

  test("grid-no-key", async ({ page }) => {
    await loginAs(page, "nokey");
    await page.goto("/grid");
    // The state is a left-aligned sentence plus a link button, not an alert box (§6.2).
    await expect(page.getByTestId("grid-no-key")).toContainText(en["grid.empty.no_key"]);
    await audit(page, "grid-no-key");
  });

  test("grid-empty-results", async ({ page }) => {
    await loginAs(page, "empty");
    await page.goto("/grid");
    await submitQuery(page, CANONICAL_QUERY_EN);
    await expect(page.getByTestId("grid-empty-results")).toBeVisible({ timeout: 60_000 });
    await audit(page, "grid-empty-results");
  });

  /**
   * Parse failure (spec §3.7): the sentences naming what could not be read, plus the manual-mode
   * chips "Build it with chips instead" opens — three of which are in their error state, which is
   * where an aria-invalid or a missing description would show up.
   */
  test("grid-parse-failure", async ({ page }) => {
    await loginAs(page, "demo");
    await page.goto("/grid");
    // Holiday words fall through to the language model, which is not configured in the harness.
    await submitQuery(page, "国庆去东京");
    await expect(page.getByTestId("parse-failure")).toBeVisible({ timeout: 60_000 });
    await audit(page, "grid-parse-failure");

    await page.getByTestId("build-with-chips").click();
    await expect(page.getByTestId("chips-error").first()).toBeVisible();
    await audit(page, "grid-manual-mode");
  });

  // ---- queries ----

  /**
   * Standing queries are a table at ≥ 768 px and a stacked card list below it, and the swap
   * happens on hydration (`useDensity` reads matchMedia in an effect, defaulting to desktop on
   * the server). Waiting for "a table" therefore passes on the server-rendered frame of a mobile
   * run and audits markup that is one frame from being replaced; the wait is for the presentation
   * this project is actually testing.
   */
  test("queries", async ({ page }) => {
    await loginAs(page, "demo");
    await page.goto("/queries");
    await expectQueriesReady(page);
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
    await expectQueriesReady(page);
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
    await expectQueriesReady(page);
    await page.getByRole("button", { name: en["saved.edit"], exact: true }).first().click();
    const drawer = page.getByTestId("edit-query-drawer");
    await expect(drawer).toBeVisible();
    await drawer.locator('[data-chip="origins"]').click();
    await expect(page.locator('[data-slot="popover-content"]')).toBeVisible();
    await audit(page, "queries-edit-drawer");
  });

  test("queries-empty", async ({ page }) => {
    await loginAs(page, "empty");
    await page.goto("/queries");
    await expect(page.getByTestId("queries-empty")).toBeVisible();
    await audit(page, "queries-empty");
  });

  // ---- settings ----

  test("settings", async ({ page }) => {
    await loginAs(page, "demo");
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: en["settings.title"] })).toBeVisible();
    await audit(page, "settings");
  });
});
