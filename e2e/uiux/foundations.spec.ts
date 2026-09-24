/**
 * T04 — shared tokens and base controls, light and dark (plan 01 T04; acceptance A06, A07).
 *
 * Runs against the fixture host's `foundations` scenario: the real iOS primitives (apps/ios/src/components/ui)
 * rendered in every state, not a production route. Colours are compared as computed values against the token
 * values, so a primitive that hard-codes a colour fails here. (One that read an older colour name would not, since
 * styles.css aliases those names to the same roles; primitives.test.ts checks statically that ui.css reads --ag-*
 * only.)
 */
import type { Browser, BrowserContextOptions, Locator, Page } from "@playwright/test";
import { evidenceShot, externalRequests, lockDownNetwork, openScenario } from "./helpers";
import { expect, test } from "./test";

/** "#RRGGBB" → the "rgb(r, g, b)" a computed style reports. */
function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

async function token(page: Page, name: string): Promise<string> {
  return (await page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name)).toUpperCase();
}

async function style(locator: Locator, prop: string): Promise<string> {
  return locator.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
}

/** A page in a context of its own (a different screen or pointer), locked down like the suite's own contexts. */
async function withContext(browser: Browser, options: BrowserContextOptions, body: (page: Page) => Promise<void>) {
  const context = await browser.newContext(options);
  try {
    await lockDownNetwork(context);
    const page = await context.newPage();
    await body(page);
    expect(externalRequests(page), "requests to hosts other than the loopback fixture host").toEqual([]);
  } finally {
    await context.close();
  }
}

/** How many line boxes an element's text occupies. */
async function lines(locator: Locator): Promise<number> {
  return locator.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
  });
}

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("not rendered");
  return b;
}

test("dark primary uses light teal with dark foreground", async ({ page }) => {
  await openScenario(page, "foundations", "ios", { theme: "dark", lang: "zh" });
  await expect(page.getByTestId("primary-button-sample")).toBeVisible();
  const colors = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return [s.getPropertyValue("--ag-accent").trim(), s.getPropertyValue("--ag-on-accent").trim()];
  });
  expect(colors.map((x) => x.toUpperCase())).toEqual(["#63D2D6", "#102326"]);
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: primitives take their colours from the tokens`, async ({ page }) => {
    await openScenario(page, "foundations", "ios", { theme });
    const primary = page.getByTestId("primary-button-sample");
    expect(await style(primary, "background-color")).toBe(rgb(await token(page, "--ag-accent")));
    expect(await style(primary, "color")).toBe(rgb(await token(page, "--ag-on-accent")));
    const secondary = page.getByTestId("secondary-button-sample");
    expect(await style(secondary, "background-color")).toBe(rgb(await token(page, "--ag-surface")));
    expect(await style(secondary, "border-top-color")).toBe(rgb(await token(page, "--ag-control-border")));
    expect(await style(secondary, "color")).toBe(rgb(await token(page, "--ag-text")));
    expect(await style(page.getByTestId("danger-button-sample"), "color")).toBe(rgb(await token(page, "--ag-danger")));
    expect(await style(page.getByTestId("foundations-page"), "background-color")).toBe(rgb(await token(page, "--ag-canvas")));
    for (const tone of ["info", "warning", "danger", "success"] as const) {
      const notice = page.getByTestId(`notice-${tone}`);
      expect(await style(notice, "background-color"), tone).toBe(rgb(await token(page, `--ag-${tone}-soft`)));
      expect(await style(notice, "color"), tone).toBe(rgb(await token(page, `--ag-${tone}`)));
    }
    const input = page.getByTestId("input-sample");
    expect(await style(input, "border-top-color")).toBe(rgb(await token(page, "--ag-control-border")));
    await evidenceShot(page, `t04-foundations-${theme}`, { fullPage: true });
  });
}

test("touch sizes: 48 buttons and inputs, 44 icon buttons, 36 chips in 44 slots, 44 segmented control", async ({ page }) => {
  await openScenario(page, "foundations");
  expect((await box(page.getByTestId("primary-button-sample"))).height).toBeGreaterThanOrEqual(48);
  expect((await box(page.getByTestId("input-sample"))).height).toBeGreaterThanOrEqual(48);
  const icon = await box(page.getByRole("button", { name: "Close sample", exact: true }));
  expect(icon.width).toBeGreaterThanOrEqual(44);
  expect(icon.height).toBeGreaterThanOrEqual(44);
  const chip = page.getByRole("button", { name: "HKG Hong Kong" });
  expect((await box(chip)).height).toBeGreaterThanOrEqual(44);
  expect((await box(chip.locator(".ag-chip-face"))).height).toBeGreaterThanOrEqual(36);
  expect((await box(chip.locator(".ag-chip-face"))).height).toBeLessThan(44);
  const segments = page.getByRole("radiogroup", { name: "Result view" }).getByRole("radio");
  await expect(segments).toHaveCount(3);
  const widths = await Promise.all([0, 1, 2].map(async (i) => (await box(segments.nth(i))).width));
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
  expect((await box(segments.nth(0))).height).toBeGreaterThanOrEqual(44);
});

test("states: focus ring, disabled with its reason, loading keeps its width", async ({ page }) => {
  await openScenario(page, "foundations");
  const primary = page.getByTestId("primary-button-sample");
  await primary.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(primary).toBeFocused();
  expect(await style(primary, "outline-style")).toBe("solid");
  expect(await style(primary, "outline-width")).toBe("2px");
  expect(await style(primary, "outline-offset")).toBe("2px");
  expect(await style(primary, "outline-color")).toBe(rgb(await token(page, "--ag-accent")));

  const disabled = page.getByTestId("disabled-button-sample");
  await expect(disabled).toBeDisabled();
  await expect(disabled).toHaveAccessibleDescription("Add a departure date first");
  await expect(page.getByText("Add a departure date first")).toBeVisible();
  expect(await style(disabled, "opacity")).toBe("1");

  const idle = await box(page.getByTestId("loading-button-idle"));
  const busy = page.getByTestId("loading-button-busy");
  await expect(busy).toHaveAttribute("aria-busy", "true");
  expect(Math.abs((await box(busy)).width - idle.width)).toBeLessThanOrEqual(0.5);
});

test("loading keeps focus on the button and ignores clicks, Enter and Space", async ({ page }) => {
  await openScenario(page, "foundations");
  const busy = page.getByTestId("loading-button-busy");
  await expect(busy).toHaveAttribute("aria-disabled", "true");
  expect(await busy.evaluate((b) => (b as HTMLButtonElement).disabled)).toBe(false);
  await busy.focus();
  await expect(busy).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  await busy.click({ force: true });
  await expect(busy).toBeFocused();
  await expect(page.getByTestId("busy-clicks")).toHaveText("Busy clicks: 0");
});

test("disabled icon buttons, chips and segments stay legible, are not operable, and arrows skip them", async ({ page }) => {
  await openScenario(page, "foundations");
  const muted = rgb(await token(page, "--ag-text-muted"));
  const subtle = rgb(await token(page, "--ag-surface-subtle"));

  const icon = page.getByRole("button", { name: "Close sample (disabled)", exact: true });
  await expect(icon).toBeDisabled();
  expect(await style(icon, "color")).toBe(muted);
  expect(await style(icon, "opacity")).toBe("1");

  const outlined = page.getByRole("button", { name: "Outlined sample", exact: true });
  expect(Math.round((await box(outlined)).height)).toBe(48);
  expect(await style(outlined, "border-top-color")).toBe(rgb(await token(page, "--ag-control-border")));
  const outlinedOff = page.getByRole("button", { name: "Outlined sample (disabled)", exact: true });
  expect(await style(outlinedOff, "border-top-color")).toBe(rgb(await token(page, "--ag-divider")));
  expect(await style(outlinedOff, "background-color")).toBe(subtle);

  const field = page.getByTestId("disabled-input-sample");
  await expect(field).toBeDisabled();
  expect(await style(field, "opacity")).toBe("1");
  expect(await style(field, "-webkit-text-fill-color")).toBe(muted);

  const chip = page.getByRole("button", { name: "Mixed cabin" });
  await expect(chip).toBeDisabled();
  expect(await style(chip.locator(".ag-chip-face"), "color")).toBe(muted);
  expect(await style(chip.locator(".ag-chip-face"), "background-color")).toBe(subtle);

  const cabin = page.getByRole("radiogroup", { name: "Cabin" });
  const premium = cabin.getByRole("radio", { name: "Premium economy", exact: true });
  await expect(premium).toBeDisabled();
  expect(await style(premium, "color")).toBe(muted);
  await cabin.getByRole("radio", { name: "Economy", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(cabin.getByRole("radio", { name: "Business and first", exact: true })).toBeChecked();
  await expect(cabin.getByRole("radio", { name: "Business and first", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(cabin.getByRole("radio", { name: "Economy", exact: true })).toBeChecked();
});

test("chips: selection keeps the weight, only the check mark widens the chip; a filter chip reads quieter until on", async ({ page }) => {
  await openScenario(page, "foundations");
  const selected = page.getByRole("button", { name: "HKG Hong Kong" });
  const plain = page.getByRole("button", { name: "Programs" });
  await expect(selected).toHaveAttribute("aria-pressed", "true");
  expect(await style(selected.locator(".ag-chip-face"), "font-weight")).toBe(await style(plain.locator(".ag-chip-face"), "font-weight"));
  expect(await style(selected.locator(".ag-chip-face"), "background-color")).toBe(rgb(await token(page, "--ag-accent-soft")));

  const filter = page.getByRole("button", { name: "Nonstop only" });
  expect(await style(filter.locator(".ag-chip-face"), "color")).toBe(rgb(await token(page, "--ag-text-secondary")));
  const off = (await box(filter.locator(".ag-chip-face"))).width;
  await filter.click();
  await expect(filter).toHaveAttribute("aria-pressed", "true");
  expect(await style(filter.locator(".ag-chip-face"), "color")).toBe(rgb(await token(page, "--ag-accent")));
  // 16 pt check mark + 4 pt gap, nothing from the text.
  expect((await box(filter.locator(".ag-chip-face"))).width - off).toBeCloseTo(20, 0);
});

test("large text: the scale hook doubles type, and a long segment label wraps inside its third", async ({ page }) => {
  await openScenario(page, "foundations");
  const cabin = page.getByRole("radiogroup", { name: "Cabin" });
  const long = cabin.getByRole("radio", { name: "Business and first", exact: true });
  const size = async (l: Locator) => Number.parseFloat(await style(l, "font-size"));
  const [bodyAt1, labelAt1] = [await size(page.locator("body")), await size(long)];
  await page.evaluate(() => document.documentElement.style.setProperty("--ag-text-scale", "2"));
  expect(await size(page.locator("body"))).toBe(bodyAt1 * 2);
  expect(await size(long)).toBe(labelAt1 * 2);
  const viewport = page.viewportSize()!.width;
  const group = await box(cabin);
  expect(group.x + group.width).toBeLessThanOrEqual(viewport);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport);
  expect(await long.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await lines(long)).toBeGreaterThan(1);
});

test("a pinned theme pins color-scheme, whatever the system says", async ({ page }) => {
  await openScenario(page, "foundations", "ios", { theme: "light" });
  const root = page.locator("html");
  expect(await style(root, "color-scheme")).toBe("light");
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  expect(await style(root, "color-scheme")).toBe("dark");
  expect(await style(page.getByTestId("foundations-page"), "background-color")).toBe(rgb("#10161E"));

  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  expect(await style(root, "color-scheme")).toBe("light");
  expect(await style(page.getByTestId("foundations-page"), "background-color")).toBe(rgb("#F6F7F9"));
  await page.evaluate(() => document.documentElement.removeAttribute("data-theme"));
  expect(await style(root, "color-scheme")).toBe("dark");
});

test("segmented control: one tab stop, arrows move, selection shown by text and fill, not colour alone", async ({ page }) => {
  await openScenario(page, "foundations");
  const group = page.getByRole("radiogroup", { name: "Result view" });
  const list = group.getByRole("radio", { name: "List" });
  const calendar = group.getByRole("radio", { name: "Calendar" });
  await expect(list).toBeChecked();
  expect(await list.getAttribute("tabindex")).toBe("0");
  expect(await calendar.getAttribute("tabindex")).toBe("-1");
  expect(await style(list, "background-color")).not.toBe(await style(calendar, "background-color"));
  expect(await style(list, "font-weight")).not.toBe(await style(calendar, "font-weight"));
  await list.focus();
  await page.keyboard.press("ArrowRight");
  await expect(calendar).toBeChecked();
  await expect(calendar).toBeFocused();
  await page.keyboard.press("End");
  await expect(group.getByRole("radio", { name: "Matrix" })).toBeChecked();
  await page.keyboard.press("Home");
  await expect(list).toBeChecked();
});

test("input: label outside, help and error below and announced with the field", async ({ page }) => {
  await openScenario(page, "foundations");
  const field = page.getByRole("textbox", { name: "Departure airports" });
  await expect(field).toHaveAccessibleDescription(/Use 3-letter codes/);
  const invalid = page.getByRole("textbox", { name: "Return date" });
  await expect(invalid).toHaveAttribute("aria-invalid", "true");
  await expect(invalid).toHaveAccessibleDescription(/is not a real date/);
  const labelBox = await box(page.getByText("Return date", { exact: true }));
  const fieldBox = await box(invalid);
  expect(labelBox.y + labelBox.height).toBeLessThanOrEqual(fieldBox.y + 0.5);
});

test("sheet: focus moves in, Tab stays in, Esc closes and focus returns to the trigger", async ({ page }) => {
  await openScenario(page, "foundations");
  const trigger = page.getByRole("button", { name: "Open sample sheet" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Sample sheet" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Sample sheet" })).toBeFocused();
  expect(await style(dialog, "border-top-left-radius")).toBe("24px");
  const close = dialog.getByRole("button", { name: "Close" });
  expect((await box(close)).width).toBeGreaterThanOrEqual(44);
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("sheet: rendered into <body>, the page behind is inert, and Esc works after a click on the sheet's padding", async ({ page }) => {
  await openScenario(page, "foundations");
  const trigger = page.getByRole("button", { name: "Open sample sheet" });
  const pageBehind = page.getByTestId("foundations-page");
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Sample sheet" });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((d) => d.parentElement?.parentElement === document.body)).toBe(true);
  expect(await pageBehind.evaluate((el) => el.closest("[inert]") !== null)).toBe(true);
  // Inert means unreachable, not just marked: the trigger behind the sheet cannot take focus.
  expect(await trigger.evaluate((el) => (el.focus(), document.activeElement === el))).toBe(false);

  // Let the slide-in finish, then click the sheet's own left gutter: padding, not a control.
  await dialog.evaluate((d) => Promise.all(d.getAnimations().map((a) => a.finished)));
  const b = await box(dialog);
  await page.mouse.click(b.x + 6, b.y + b.height / 2);
  expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  // With focus on <body>, only a document-level listener can hear Esc.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(await pageBehind.evaluate((el) => el.closest("[inert]") !== null)).toBe(false);
  await expect(trigger).toBeFocused();
});

test("switch: a 44 target named by its label; on moves the thumb and fills the track, off does neither", async ({ page }) => {
  await openScenario(page, "foundations");
  const toggle = page.getByRole("switch", { name: "Nonstop only (sample)" });
  const b = await box(toggle);
  expect(b.width).toBeGreaterThanOrEqual(44);
  expect(b.height).toBeGreaterThanOrEqual(44);
  const track = toggle.locator(".ag-switch-track");
  const thumb = toggle.locator(".ag-switch-thumb");
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  expect(await style(track, "background-color")).toBe(rgb(await token(page, "--ag-control-border")));
  const offX = (await box(thumb)).x;
  // The label names the switch and clicking it toggles it.
  await page.getByText("Nonstop only (sample)").click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect.poll(async () => style(track, "background-color")).toBe(rgb(await token(page, "--ag-accent")));
  await expect.poll(async () => (await box(thumb)).x - offX).toBeGreaterThan(15);
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-checked", "false");
});

test("reduced motion: every duration is zero", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openScenario(page, "foundations");
  expect(await token(page, "--ag-motion-feedback")).toBe("0MS");
  expect(await style(page.getByTestId("primary-button-sample"), "transition-duration")).toMatch(/^0s/);
});

test("a fine pointer on a wide screen gets desktop control sizes", async ({ browser }) => {
  await withContext(browser, { viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false }, async (page) => {
    await openScenario(page, "foundations");
    expect(Math.round((await box(page.getByTestId("primary-button-sample"))).height)).toBe(40);
    expect(Math.round((await box(page.getByRole("button", { name: "Close sample", exact: true }))).height)).toBe(36);
  });
});

test("a wide touch screen (an iPad) keeps touch sizes, and fields keep 16 pt text so iOS does not zoom", async ({ browser }) => {
  await withContext(browser, { viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true }, async (page) => {
    await openScenario(page, "foundations");
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    expect(Math.round((await box(page.getByTestId("primary-button-sample"))).height)).toBe(48);
    expect(Math.round((await box(page.getByRole("button", { name: "Close sample", exact: true }))).height)).toBe(44);
    expect(Number.parseFloat(await style(page.getByTestId("input-sample"), "font-size"))).toBeGreaterThanOrEqual(16);
  });
});

test("hover (fine pointer) and pressed states: icon button, chip, selected chip, segment", async ({ browser }) => {
  await withContext(browser, { viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false, reducedMotion: "reduce" }, async (page) => {
    await openScenario(page, "foundations");
    const subtle = rgb(await token(page, "--ag-surface-subtle"));
    const soft = rgb(await token(page, "--ag-accent-soft"));
    const icon = page.getByRole("button", { name: "Close sample", exact: true });
    await icon.hover();
    expect(await style(icon, "background-color")).toBe(subtle);

    const plain = page.getByRole("button", { name: "Programs" });
    await plain.hover();
    expect(await style(plain.locator(".ag-chip-face"), "background-color")).toBe(subtle);
    const b = await box(plain);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    expect(await style(plain.locator(".ag-chip-face"), "background-color")).toBe(subtle);
    await page.mouse.up();

    const selected = page.getByRole("button", { name: "HKG Hong Kong" });
    await selected.hover();
    expect(await style(selected.locator(".ag-chip-face"), "background-color")).toBe(soft);
    const sb = await box(selected);
    await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
    await page.mouse.down();
    expect(await style(selected.locator(".ag-chip-face"), "background-color")).toBe(soft);
    await page.mouse.move(0, 0);
    await page.mouse.up();

    const calendar = page.getByRole("radiogroup", { name: "Result view" }).getByRole("radio", { name: "Calendar" });
    expect(await style(calendar, "color")).toBe(rgb(await token(page, "--ag-text-secondary")));
    await calendar.hover();
    expect(await style(calendar, "color")).toBe(rgb(await token(page, "--ag-text")));
  });
});

/*
 * The real shell, not the gallery: the screens T06–T11 have not rebuilt yet read the older colour names, which now
 * resolve to the Quiet Precision roles in every theme mode, so no screen shows two palettes (DECISIONS U-012).
 */
for (const theme of ["light", "dark"] as const) {
  test(`${theme}: the real shell's older colour names resolve to Quiet Precision, and the body uses the system face`, async ({ page }) => {
    await openScenario(page, "complete", "ios", { theme });
    const pairs: Array<[string, string]> = [
      ["--bg", "--ag-canvas"],
      ["--bg-raised", "--ag-surface"],
      ["--line", "--ag-divider"],
      ["--line-strong", "--ag-control-border"],
      ["--fg", "--ag-text"],
      ["--fg-muted", "--ag-text-secondary"],
      ["--accent", "--ag-accent"],
      ["--fresh", "--ag-success"],
      ["--aging", "--ag-warning"],
      ["--stale", "--ag-danger"],
      ["--error", "--ag-danger"],
      ["--radius-control", "--ag-radius-control"],
    ];
    for (const [old, role] of pairs) expect(await token(page, old), old).toBe(await token(page, role));
    const body = page.locator("body");
    expect(await style(body, "background-color")).toBe(rgb(await token(page, "--ag-canvas")));
    expect(await style(body, "font-family")).toMatch(/^system-ui/);
    expect(await style(body, "font-size")).toBe("16px");
    expect(await style(body, "line-height")).toBe("24px");
    // The line height is a ratio, so an older element with its own size gets lines to match (13 × 1.5).
    expect(
      await page.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.fontSize = "13px";
        document.querySelector("main")!.append(probe);
        const value = getComputedStyle(probe).lineHeight;
        probe.remove();
        return value;
      }),
    ).toBe("19.5px");
    // Native checkboxes take the same accent.
    expect(await style(page.locator("html"), "accent-color")).toBe(rgb(await token(page, "--ag-accent")));
    await evidenceShot(page, `t04-app-search-${theme}`, { fullPage: true });
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/settings/);
    await evidenceShot(page, `t04-app-settings-${theme}`, { fullPage: true });
  });
}

test("sheet: Tab and Shift+Tab wrap over the controls that really take focus, ending with a segmented control", async ({ page }) => {
  await openScenario(page, "foundations");
  await page.getByRole("button", { name: "Open filter sheet" }).click();
  const dialog = page.getByRole("dialog", { name: "Filter sheet" });
  const close = dialog.getByRole("button", { name: "Close" });
  const checked = dialog.getByRole("radio", { name: "Miles" });
  await checked.focus();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(checked).toBeFocused();
  // From the title, Shift+Tab goes to the last real stop, not out of the sheet.
  await dialog.getByRole("heading", { name: "Filter sheet" }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(checked).toBeFocused();
});

test("sheet: a field that focuses itself keeps focus, and closing returns focus to the trigger", async ({ page }) => {
  await openScenario(page, "foundations");
  const trigger = page.getByRole("button", { name: "Open filter sheet" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Filter sheet" });
  await expect(dialog.getByRole("textbox", { name: "Search note" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("sheet: a tap on the scrim closes it and returns focus to the trigger; a right-click does not close it", async ({ page }) => {
  await openScenario(page, "foundations");
  const trigger = page.getByRole("button", { name: "Open sample sheet" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Sample sheet" });
  await dialog.evaluate((d) => Promise.all(d.getAnimations().map((a) => a.finished)));
  await page.mouse.click(40, 40, { button: "right" });
  await expect(dialog).toBeVisible();
  await page.mouse.click(40, 40);
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("sheet: focus that lands outside is brought back; with the opener gone, focus goes to <main>", async ({ page }) => {
  await openScenario(page, "foundations");
  await page.getByRole("button", { name: "Open sample sheet" }).click();
  const dialog = page.getByRole("dialog", { name: "Sample sheet" });
  await page.evaluate(() => {
    const stray = document.createElement("button");
    stray.textContent = "stray";
    stray.id = "stray";
    document.body.append(stray);
    stray.focus();
  });
  await expect(dialog.getByRole("heading", { name: "Sample sheet" })).toBeFocused();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Open from a vanishing button" }).click();
  const vanishing = page.getByRole("dialog", { name: "Vanishing opener" });
  await expect(vanishing).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(vanishing).toHaveCount(0);
  await expect(page.getByTestId("foundations-page")).toBeFocused();
});

test("a live notice mounts empty and then fills, so the change is announced", async ({ page }) => {
  await openScenario(page, "foundations");
  await page.evaluate(() => {
    const seen: Array<string | null> = [];
    (window as unknown as { __liveMounts: Array<string | null> }).__liveMounts = seen;
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes) if (node instanceof HTMLElement && node.matches('.ag-notice[role="status"]')) seen.push(node.textContent);
    }).observe(document.body, { childList: true, subtree: true });
  });
  await page.getByRole("button", { name: "Save sample" }).click();
  await expect(page.getByTestId("live-notice")).toHaveText("Saved just now.");
  await expect(page.getByTestId("live-notice")).toHaveAttribute("role", "status");
  expect(await page.evaluate(() => (window as unknown as { __liveMounts: Array<string | null> }).__liveMounts)).toEqual([""]);
});
