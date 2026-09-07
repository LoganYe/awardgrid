/**
 * Phase 6.3 — the query bar and the eight chip editors (spec §3.1, §3.2, §3.7; docs/UI_PLAN.md
 * §6.2 and §6.2a). One test per state, asserting the semantics:
 * the chip order, the value summaries, the popover keyboard contract (Enter opens, Esc closes
 * and returns focus), the modified state (accent outline, Run affordance, disabled toolbar,
 * dimmed grid), "Reset to parsed", the empty-origins error, the parse failure and its
 * manual-mode escape hatch, the Examples popover and the loading skeleton.
 *
 * The URL rule from spec §3.2 is asserted here too: ?q= follows the query the grid was produced
 * from, so editing a chip must not change the link until the user runs it.
 *
 * This spec asserts; it does not photograph. Every capture of these states is declared in
 * `e2e/matrix.ts` and written by `e2e/screenshots.spec.ts` (#34) — one owner per file.
 */
import type { Locator, Page } from "@playwright/test";
import { en } from "../src/lib/i18n/dictionaries/en";
import { zh } from "../src/lib/i18n/dictionaries/zh";
import { applyTheme, CANONICAL_QUERY_EN, CANONICAL_QUERY_ZH, expect, loginAs, projectIndex, submitQuery, test, type E2eUsername } from "./fixtures";
import { E2E_CHIP_SLOW_USERS } from "./users";

/** The eight chips, in the order spec §3.2 pins (Mixed cabin added at index 6, issue #18). */
const CHIP_ORDER = ["origins", "destinations", "dates", "cabins", "programs", "direct_only", "min_cabin_pct", "sort"];

const chips = (page: Page) => page.locator("[data-chip]");
const chip = (page: Page, id: string) => page.locator(`[data-chip="${id}"]`);
const popover = (page: Page) => page.locator('[data-slot="popover-content"]');
const queryBar = (page: Page, locale: "en" | "zh" = "en") => page.getByRole("textbox", { name: locale === "zh" ? zh["grid.search"] : en["grid.search"] });

async function openChip(page: Page, id: string): Promise<Locator> {
  const trigger = chip(page, id);
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  await expect(popover(page)).toBeVisible();
  return popover(page);
}

/** Wait for a search to finish: the grid is up and no longer busy. */
async function settled(page: Page): Promise<void> {
  await expect(page.getByRole("grid")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("grid")).not.toHaveAttribute("aria-busy", "true", { timeout: 60_000 });
}

/** Log in, run the canonical query and wait for the results grid and its chips. */
async function openParsed(page: Page, opts: { zh?: boolean; user?: E2eUsername } = {}): Promise<void> {
  await loginAs(page, opts.user ?? "demo");
  if (opts.zh) {
    const baseURL = new URL(test.info().project.use.baseURL ?? "http://127.0.0.1:3400");
    await page.context().addCookies([{ name: "ag_locale", value: "zh", domain: baseURL.hostname, path: "/" }]);
  }
  await page.goto("/grid");
  if (opts.zh) {
    const box = queryBar(page, "zh");
    await box.fill(CANONICAL_QUERY_ZH);
    await box.press("Enter");
  } else {
    await submitQuery(page, CANONICAL_QUERY_EN);
  }
  await expect(chips(page).first()).toBeVisible({ timeout: 60_000 });
  await settled(page);
}

test.beforeEach(async ({ page }) => {
  await applyTheme(page);
});

test.describe("query bar and chips", () => {
  test("parsed: eight chips in spec order with their value summaries", async ({ page }) => {
    await openParsed(page);

    expect(await chips(page).evaluateAll((els) => els.map((el) => el.getAttribute("data-chip")))).toEqual(CHIP_ORDER);

    // Summaries (spec §3.2): city airports joined with "/", a date range with an en dash and a
    // day count, "all 26" programs, the switch as a word, the sort's own label.
    await expect(chip(page, "origins")).toContainText("NRT/HND");
    await expect(chip(page, "destinations")).toContainText("SEA");
    await expect(chip(page, "dates")).toContainText(" – ");
    await expect(chip(page, "dates")).toContainText(new RegExp(`\\(\\d+ ${en["grid.chips.days"].replace("{n} ", "")}\\)`));
    await expect(chip(page, "cabins")).toContainText("J");
    await expect(chip(page, "programs")).toContainText("all");
    await expect(chip(page, "direct_only")).toContainText(en["grid.chips.off"]);
    // At the API's default (100) the chip reads as a STATE beside "Direct only off", not a
    // number nobody chose (issue #18).
    await expect(chip(page, "min_cabin_pct")).toContainText(en["grid.chips.min_cabin_pct"]);
    // NOT "off": that is what Direct only beside it says for the opposite meaning (#18).
    await expect(chip(page, "min_cabin_pct")).toContainText(en["grid.chips.mixed_cabin_none"]);
    await expect(chip(page, "min_cabin_pct")).not.toContainText(en["grid.chips.off"]);
    await expect(chip(page, "sort")).toContainText(en["grid.sort.miles_asc"]);

    // "Parsed from: <raw text>" keeps the chips traceable to what the user typed (spec §3.1).
    await expect(page.getByTestId("parsed-from")).toContainText(CANONICAL_QUERY_EN);
    // Nothing is modified yet: no Run affordance in the row.
    await expect(page.getByTestId("chips-run")).toBeHidden();

  });

  test("parsed in Chinese: the chips and the parsed-from line read in the UI language", async ({ page }) => {
    await openParsed(page, { zh: true });
    await expect(chip(page, "origins")).toContainText("NRT/HND");
    await expect(chip(page, "direct_only")).toContainText(zh["grid.chips.off"]);
    await expect(page.getByTestId("parsed-from")).toContainText(CANONICAL_QUERY_ZH);
  });

  test("origins editor: opens from the keyboard, searches, and returns focus on Escape", async ({ page }) => {
    await openParsed(page);

    // Enter on the focused chip opens its editor (the chip is a button, spec §3.2).
    await chip(page, "origins").focus();
    await page.keyboard.press("Enter");
    const editor = popover(page);
    await expect(editor).toBeVisible();

    // City rows carry the group toggle and one toggle per airport ("TYO ▸ NRT ✓ HND ✓").
    // The city-group toggle names the city and says it takes every airport (not a bare "TYO").
    await expect(editor.getByRole("button", { name: new RegExp(`^TYO .*${en["grid.chips.select_city"].replace("{city}", "").trim()}$`) })).toBeVisible();
    await expect(editor.getByRole("button", { name: /^NRT/ })).toBeVisible();
    await expect(editor.getByRole("button", { name: /^HND/ })).toBeVisible();

    // Search finds a city by alias and offers it as an option. The field is a combobox: it owns
    // the results listbox and moves the active option with aria-activedescendant.
    await editor.getByRole("combobox", { name: en["grid.chips.search_places"] }).fill("osaka");
    await expect(editor.getByRole("option").first()).toContainText("OSA");


    await page.keyboard.press("Escape"); // clears the search
    await page.keyboard.press("Escape"); // closes the popover
    await expect(popover(page)).toBeHidden();
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-chip"))).toBe("origins");
  });

  test("dates editor: two months, presets and the day grid", async ({ page }) => {
    await openParsed(page);
    const editor = await openChip(page, "dates");

    await expect(editor.locator("table")).toHaveCount(2);
    await expect(editor.getByTestId("preset-30")).toBeVisible();
    await expect(editor.getByTestId("preset-60")).toBeVisible();
    await expect(editor.getByTestId("preset-90")).toBeVisible();
    await expect(editor.locator("[data-day]").first()).toBeVisible();

    // "next 30 days" is 30 days, counted inclusively — the chip, the editor's own note and the
    // "Next 30 days" preset all say the same number (src/lib/query/dates.ts, date-model.ts).
    await expect(chip(page, "dates")).toContainText(`(${en["grid.chips.days"].replace("{n}", "30")})`);
    await expect(editor.getByTestId("dates-summary")).toContainText(en["grid.chips.days"].replace("{n}", "30"));


    // Clicking the preset the query already describes changes nothing: the chip stays default.
    await editor.getByTestId("preset-30").click();
    await expect(editor.getByTestId("preset-30")).toHaveAttribute("aria-pressed", "true");
    await expect(chip(page, "dates")).toHaveAttribute("data-chip-state", "default");

    // A different preset rewrites the range and marks the query modified without running it.
    await editor.getByTestId("preset-60").click();
    await expect(chip(page, "dates")).toContainText(en["grid.chips.days"].replace("{n}", "60"));
    await expect(chip(page, "dates")).toHaveAttribute("data-chip-state", "modified");
  });

  test("dates editor: paging the months keeps a tab stop, and an over-long pick is clamped", async ({ page }) => {
    await openParsed(page);
    const editor = await openChip(page, "dates");

    const tabStops = () => editor.locator('[data-day][tabindex="0"]');
    await expect(tabStops()).toHaveCount(1);
    await editor.getByRole("button", { name: en["grid.chips.next_month"] }).click();
    await editor.getByRole("button", { name: en["grid.chips.next_month"] }).click();
    // The grid must stay reachable: the tab stop follows the visible window (blocker fix).
    await expect(tabStops()).toHaveCount(1);
    await expect(tabStops()).toBeVisible();

    // Every day announces its full date, not a bare number.
    const first = editor.locator("[data-day]").first();
    expect(await first.getAttribute("aria-label")).not.toBe(await first.textContent());

    // Pick a range far longer than the cap: the note, the day cells and the chip all report the
    // 92 days that will actually be searched, and the cap is a note, not an error.
    const days = editor.locator("[data-day]:not([disabled])");
    await days.first().click();
    for (let i = 0; i < 6; i += 1) await editor.getByRole("button", { name: en["grid.chips.next_month"] }).click();
    await days.last().click();
    const capped = en["grid.chips.days"].replace("{n}", "92");
    await expect(editor.getByTestId("dates-summary")).toContainText(capped);
    await expect(chip(page, "dates")).toContainText(capped);
    await expect(editor.getByText(en["grid.chips.date_cap"])).toBeVisible();
    await expect(chip(page, "dates")).not.toHaveAttribute("data-chip-state", "error");
  });

  test("programs editor: search, All, and the count in the chip", async ({ page }) => {
    await openParsed(page);
    const editor = await openChip(page, "programs");

    await expect(editor.getByRole("button", { name: new RegExp(en["grid.chips.programs_clear"]) })).toBeVisible();
    await editor.getByRole("textbox", { name: en["grid.chips.search_programs"] }).fill("alaska");
    const alaska = editor.getByRole("button", { name: /Alaska/ });
    await expect(alaska).toHaveCount(1);


    // "All" is on, so every box in the list is ticked and the click UNTICKS this one: 25 of 26
    // left. The editor used to draw 26 empty boxes under a chip reading "all 26", and a click
    // selected only that program — the checkbox and what it did disagreed.
    await expect(alaska).toHaveAttribute("aria-pressed", "true");
    await alaska.click();
    await expect(alaska).toHaveAttribute("aria-pressed", "false");
    await expect(chip(page, "programs")).toContainText("25 of 26");
    await expect(chip(page, "programs")).toHaveAttribute("data-chip-state", "modified");
    // Ticking it back is "all 26" again, and the chip goes back to its parsed state.
    await alaska.click();
    await expect(chip(page, "programs")).toContainText(en["grid.chips.programs_all_count"].replace("{n}", "26"));
    await expect(chip(page, "programs")).toHaveAttribute("data-chip-state", "default");
  });

  test("mixed cabin editor: a non-default value is legible on the page and survives the ?q= round trip", async ({ page }) => {
    // Its own account: this is the only test that runs the query twice, and on `demo` the two
    // extra calls moved the quota readout in every capture taken after it (issue #18 review).
    await openParsed(page, { user: "mixed" });
    // At rest the chip says "not allowed" and nothing is modified.
    await expect(chip(page, "min_cabin_pct")).toHaveAttribute("data-chip-state", "default");

    const editor = await openChip(page, "min_cabin_pct");
    const select = editor.getByRole("combobox", { name: en["grid.chips.min_cabin_pct"] });
    await expect(select).toBeVisible();
    // The hint says what the control does to the results, in the popover, not in a tooltip.
    // The hint carries the value it describes, so it is true at whatever the select holds.
    await expect(editor).toContainText(en["grid.chips.mixed_cabin_hint_none"]);
    await select.selectOption("0");
    await expect(editor).toContainText(en["grid.chips.mixed_cabin_hint_any"]);
    await select.selectOption("75");
    await expect(editor).toContainText(en["grid.chips.mixed_cabin_hint_min"].replace("{pct}", "75"));
    await page.keyboard.press("Escape");
    await expect(popover(page)).toBeHidden();

    // The whole point of the chip: a non-default value is readable without opening anything.
    await expect(chip(page, "min_cabin_pct")).toContainText(en["grid.chips.mixed_cabin_min"].replace("{pct}", "75"));
    await expect(chip(page, "min_cabin_pct")).toHaveAttribute("data-chip-state", "modified");
    await expect(page.getByTestId("chips-run")).toBeVisible();

    // Running carries it into the ?q= link, and reloading that link reads it back.
    await page.getByTestId("chips-run").click();
    await settled(page);
    await expect(chip(page, "min_cabin_pct")).toHaveAttribute("data-chip-state", "default");
    const shared = page.url();
    expect(shared).toContain("?q=");
    await page.goto(shared);
    await settled(page);
    await expect(chip(page, "min_cabin_pct")).toContainText(en["grid.chips.mixed_cabin_min"].replace("{pct}", "75"));
    await expect(page.getByTestId("chips-run")).toBeHidden();

    // Opening the editor and leaving it alone must NOT mark the query modified.
    await openChip(page, "min_cabin_pct");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("chips-run")).toBeHidden();
  });

  test("modified: outline, Run affordance, disabled toolbar, dimmed grid, and ?q= only after Run", async ({ page }) => {
    await openParsed(page);
    const before = page.url();
    expect(before).toContain("?q=");

    // Remove HND from the Tokyo group.
    const editor = await openChip(page, "origins");
    await editor.getByRole("button", { name: `HND ${en["grid.chips.selected"]}` }).click();
    await page.keyboard.press("Escape");
    await expect(popover(page)).toBeHidden();

    await expect(chip(page, "origins")).toHaveAttribute("data-chip-state", "modified");
    await expect(chip(page, "origins")).not.toContainText("HND");
    await expect(page.getByTestId("chips-run")).toBeVisible();
    await expect(page.getByTestId("chips-reset")).toBeVisible();
    await expect(page.getByRole("toolbar")).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator(".ag-wrap")).toHaveAttribute("data-dimmed", "true");
    // The link still points at the grid on screen (spec §3.2: the URL updates on run).
    expect(page.url()).toBe(before);


    await page.getByTestId("chips-run").click();
    await settled(page);
    await expect(page.getByTestId("chips-run")).toBeHidden();
    await expect(chip(page, "origins")).toHaveAttribute("data-chip-state", "default");
    expect(page.url()).not.toBe(before);
  });

  test("reset: 'Reset to parsed' restores the parser's output and clears the modified state", async ({ page }) => {
    await openParsed(page);
    const summary = await chip(page, "origins").textContent();

    const editor = await openChip(page, "origins");
    await editor.getByRole("button", { name: `HND ${en["grid.chips.selected"]}` }).click();
    await page.keyboard.press("Escape");
    await expect(chip(page, "origins")).toHaveAttribute("data-chip-state", "modified");

    await page.getByTestId("chips-reset").click();
    expect(await chip(page, "origins").textContent()).toBe(summary);
    await expect(chip(page, "origins")).toHaveAttribute("data-chip-state", "default");
    await expect(page.getByTestId("chips-run")).toBeHidden();
    await expect(page.getByRole("toolbar")).not.toHaveAttribute("aria-disabled", "true");

  });

  test("error: an empty Origins chip turns error-colored and says what to do", async ({ page }) => {
    await openParsed(page);
    const editor = await openChip(page, "origins");

    // Remove every city row.
    const remove = editor.getByRole("button", { name: new RegExp(`^${en["grid.chips.remove"]}`) });
    for (let i = await remove.count(); i > 0; i -= 1) await remove.first().click();

    await expect(editor.getByText(en["grid.chips.at_least_one_airport"])).toBeVisible();
    await expect(chip(page, "origins")).toHaveAttribute("data-chip-state", "error");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("chips-error")).toHaveText(en["grid.chips.at_least_one_airport"]);
    await expect(page.getByTestId("chips-run")).toBeDisabled();

  });

  test("parse failure: names what it could not read and keeps the text", async ({ page }) => {
    await loginAs(page, "demo");
    await page.goto("/grid");
    // Holiday words fall through to the language model, which is not configured here.
    await submitQuery(page, "国庆去东京");

    const failure = page.getByTestId("parse-failure");
    await expect(failure).toBeVisible();
    await expect(failure).toContainText(en["grid.parse_failure.dates"]);
    await expect(failure).toContainText(en["grid.parse_failure.origins"]);
    // The raw text is preserved in the bar, not echoed under it (UI_PLAN §6.2).
    await expect(queryBar(page)).toHaveValue("国庆去东京");
    await expect(chips(page)).toHaveCount(0);

  });

  test("manual mode: 'Build it with chips instead' opens all eight chips with the first editor", async ({ page }) => {
    await loginAs(page, "demo");
    await page.goto("/grid");
    await submitQuery(page, "国庆去东京");
    await page.getByTestId("build-with-chips").click();

    expect(await chips(page).evaluateAll((els) => els.map((el) => el.getAttribute("data-chip")))).toEqual(CHIP_ORDER);
    await expect(popover(page)).toBeVisible();
    await expect(page.getByTestId("parse-failure")).toBeHidden();

    // Three chips are blocking the run, so there are three messages — and each errored chip is
    // aria-invalid and points at its own (spec §8: no meaning by color alone).
    for (const id of ["origins", "destinations", "cabins"]) {
      await expect(chip(page, id)).toHaveAttribute("data-chip-state", "error");
      await expect(chip(page, id)).toHaveAttribute("aria-invalid", "true");
      const described = await chip(page, id).getAttribute("aria-describedby");
      expect(described).toBeTruthy();
      // Attribute selector, not "#id": React's useId puts characters in the id that a CSS id
      // selector would have to escape.
      await expect(page.locator(`[id="${described}"]`)).toBeVisible();
    }
    await expect(page.getByTestId("chips-error")).toHaveCount(3);

  });

  test("manual mode after a successful run: 'Build it with chips instead' still opens Origins", async ({ page }) => {
    await openParsed(page);
    // A second, unparseable query keeps the previous chips on screen; the escape hatch must
    // still open the first editor (the chip row is controlled, not seeded once).
    await submitQuery(page, "国庆去东京");
    await expect(page.getByTestId("parse-failure")).toBeVisible();
    await page.getByTestId("build-with-chips").click();
    await expect(popover(page)).toBeVisible();
    await expect(chip(page, "origins")).toHaveAttribute("data-chip-state", "error");
  });

  test("examples: the popover fills the bar and does not run", async ({ page }) => {
    await loginAs(page, "demo");
    await page.goto("/grid");
    await page.getByTestId("examples-trigger").click();
    const list = popover(page);
    await expect(list).toBeVisible();
    await expect(list.getByRole("button")).toHaveCount(3);

    // The popover fills the query bar, so it must not sit on top of it (spec §3.1).
    const covered = await page.evaluate(() => {
      const field = document.querySelector("textarea");
      if (!field) return "no field";
      const box = field.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return hit === field ? "field" : (hit?.getAttribute("data-slot") ?? hit?.tagName ?? "unknown");
    });
    expect(covered).toBe("field");


    await list.getByRole("button", { name: en["grid.example.three"] }).click();
    await expect(queryBar(page)).toHaveValue(en["grid.example.three"]);
    await expect(chips(page)).toHaveCount(0);
    expect(page.url()).not.toContain("?q=");
  });

  test("loading: the skeleton has the shape the chips describe", async ({ page }) => {
    // One slow user per project, and a set of its own: a cached answer from another project — or
    // from grid.spec's own loading test, which runs the same query — would skip this state.
    const user: E2eUsername = E2E_CHIP_SLOW_USERS[projectIndex(test.info().project.name)] ?? "slow5";
    await loginAs(page, user);
    await page.goto("/grid");
    await submitQuery(page, CANONICAL_QUERY_EN);

    const table = page.getByRole("grid");
    await expect(table).toHaveAttribute("aria-busy", "true", { timeout: 20_000 });
    // Rows are the dates from the Dates chip, columns the pairs from the airport chips.
    expect(Number(await table.getAttribute("aria-rowcount"))).toBeGreaterThanOrEqual(31);
    expect(Number(await table.getAttribute("aria-colcount"))).toBeGreaterThanOrEqual(7);
    await expect(chips(page).first()).toBeVisible();

  });
});
