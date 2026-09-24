/**
 * T15: AI context and trusted result references (plan 03 T15; docs/04 S09; acceptance A26).
 *
 * What the page says goes with a question is what the scripted Anthropic receives: the search, and results only when
 * attached, each named R1… and linked back to its own card. Opening the page sends nothing. The conversation reads
 * oldest first with the newest at the bottom; reading earlier content, a new answer does not move it. Leaving the
 * page does not stop a question. A new conversation asks first.
 */
import type { Page } from "@playwright/test";
import { anthropicContexts, evidenceShot, fakeKeyboard, keyboard, openScenario, requestLog, searchByText } from "./helpers";
import { expect, test } from "./test";

const SEARCH_TEXT = "Synthetic HKG to SEA October business and first";
const ANSWER = "R1 needs fewer miles than R2. Confirm on the program's own site before transferring points.";

async function searchAndSelectTwo(page: Page) {
  await searchByText(page, SEARCH_TEXT);
  const boxes = page.getByTestId("availability-list").getByRole("checkbox");
  await boxes.nth(0).check();
  await boxes.nth(1).check();
}

const openAsk = (page: Page) => page.getByTestId("results-header").getByRole("link").click();
const context = (page: Page) => page.getByTestId("ai-context");

test("opening the page sends nothing, and it says exactly what a question would send (A26)", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en", ai: true });
  await searchAndSelectTwo(page);
  const before = await requestLog(page);
  await openAsk(page);
  await expect(page.getByRole("heading", { level: 1, name: "Ask Claude" })).toBeFocused();
  // The approved sentence for a query-only payload, then the search in the results summary's words.
  await expect(context(page).locator(".ask-context-sends")).toHaveText("Only the query conditions will be sent.");
  await expect(context(page).locator(".ask-context-search")).toHaveText("Search: HKG → SEA · Oct 18 – 31 · Business, First");
  // Results are attached only when chosen.
  const attach = page.getByRole("checkbox", { name: "Attach the 2 selected results" });
  await expect(attach).not.toBeChecked();
  await attach.check();
  await expect(context(page).locator(".ask-context-sends")).toHaveText("Query and 2 selected options will be sent.");
  await page.getByRole("checkbox", { name: "Include this search" }).uncheck();
  await expect(context(page).locator(".ask-context-sends")).toHaveText("Only your question will be sent.");
  await expect(context(page).locator(".ask-context-search")).toHaveCount(0);
  await expect(attach).toBeDisabled();
  expect(await requestLog(page)).toEqual(before);
  expect(await anthropicContexts(page)).toEqual([]);
});

test("the payload is what the page said: search only, then the attached results as R1 and R2, each linked to its own card (A26)", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en", ai: true });
  await searchAndSelectTwo(page);
  const seats = (await requestLog(page)).seats;
  await openAsk(page);
  const composer = page.getByRole("textbox", { name: "Question for Claude" });

  await composer.fill("Which is cheaper?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.locator(".ask-entry").first()).toContainText(ANSWER);
  await expect(page.locator(".ask-entry").first()).toContainText("Sent with the search.");

  await page.getByRole("checkbox", { name: "Attach the 2 selected results" }).check();
  await expect(context(page)).toContainText("Also the earlier question and answer in this conversation.");
  await composer.fill("Compare these two.");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const second = page.locator(".ask-entry").nth(1);
  await expect(second).toContainText(ANSWER);
  await expect(second).toContainText("Sent with the search and 2 results:");
  expect(await anthropicContexts(page)).toEqual([
    { search: true, attached: [], earlier: 0, partial: false },
    { search: true, attached: ["R1", "R2"], earlier: 1, partial: false },
  ]);
  // Nothing was searched: the answer came from what was sent.
  expect((await requestLog(page)).seats).toBe(seats);

  // R1 is the card awardgrid holds, not the model's words, and opens that very card's details.
  const r1 = second.getByRole("listitem").filter({ hasText: /^R1/ }).getByRole("link");
  await expect(r1).toHaveText(/^R1HKG → SEA, .+ miles/);
  const name = await r1.textContent();
  await r1.click();
  await expect(page).toHaveURL(/#\/detail\//);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(decodeURIComponent(page.url())).toContain("/detail/");
  await page.getByRole("button", { name: "Return to AI assistance" }).click();
  await expect(page).toHaveURL(/#\/ask/);
  await expect(page.locator(".ask-entry").nth(1).getByRole("link").first()).toBeFocused();
  await expect(page.locator(".ask-entry").nth(1).getByRole("link").first()).toHaveText(name!);
});

test("newest at the bottom: reading earlier content, a new answer does not move the page, and says there is more", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await openScenario(page, "complete", "ios", { lang: "en", ai: true });
  await searchByText(page, SEARCH_TEXT);
  await openAsk(page);
  const composer = page.getByRole("textbox", { name: "Question for Claude" });
  for (const q of ["First question?", "Second question?", "Third question?"]) {
    await composer.fill(q);
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.locator(".ask-entry").filter({ hasText: q })).toContainText(ANSWER);
  }
  // At the end, the newest is in view.
  await expect(page.locator(".ask-entry").last()).toBeInViewport();
  await composer.fill("Fourth question?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  // The reader goes back to the start while the answer is out.
  await page.locator(".ask-scroll").evaluate((el) => el.scrollTo({ top: 0 }));
  await expect(page.locator(".ask-entry").filter({ hasText: "Fourth question?" })).toContainText(ANSWER);
  expect(await page.locator(".ask-scroll").evaluate((el) => el.scrollTop)).toBe(0);
  const more = page.getByRole("button", { name: "New content" });
  await expect(more).toBeVisible();
  await more.click();
  await expect(page.locator(".ask-entry").last()).toBeInViewport();
  await expect(more).toHaveCount(0);
});

test("leaving the page does not stop the question; a new conversation asks first", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en", ai: true });
  await searchByText(page, SEARCH_TEXT);
  await openAsk(page);
  await page.getByRole("textbox", { name: "Question for Claude" }).fill("Anything nonstop?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByTestId("results-header")).toContainText("AI assistance (working)");
  await expect(page.getByTestId("results-header")).toContainText(/^.*AI assistance$/);
  await openAsk(page);
  await expect(page.locator(".ask-entry")).toContainText(ANSWER);

  await page.getByRole("button", { name: "New conversation" }).click();
  const sheet = page.getByRole("dialog", { name: "Start a new conversation?" });
  await expect(sheet).toContainText("later questions are sent without them");
  await sheet.getByRole("button", { name: "Keep this conversation" }).click();
  await expect(page.locator(".ask-entry")).toHaveCount(1);
  await page.getByRole("button", { name: "New conversation" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "New conversation" }).click();
  await expect(page.locator(".ask-entry")).toHaveCount(0);
  await expect(page.getByText("Conversation cleared.")).toBeVisible();
});

test("in Chinese: the page, what is sent, the references and the question's own lines speak Chinese", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "zh", ai: true });
  await searchAndSelectTwo(page);
  await openAsk(page);
  await expect(page.getByRole("heading", { level: 1, name: "询问 Claude" })).toBeVisible();
  await page.getByRole("checkbox", { name: "附带已选的 2 个结果" }).check();
  await expect(context(page).locator(".ask-context-sends")).toHaveText("附带查询条件及2个所选选项。");
  await expect(context(page).locator(".ask-context-search")).toHaveText("查询：HKG → SEA · 10月18–31日 · 商务舱、头等舱");
  await page.getByRole("textbox", { name: "向 Claude 提问" }).fill("比较这两个。");
  await page.getByRole("button", { name: "提问", exact: true }).click();
  await expect(page.locator(".ask-entry")).toContainText("发送时附带了查询和 2 个结果：");
  // T17: a question's own lines speak Chinese too.
  await expect(page.locator(".ask-meta")).toContainText("次请求");
  await expect(page.locator(".ask-meta")).not.toHaveAttribute("lang", "en");
});

test("Back returns focus to the link that opened the page (review UI-1)", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en", ai: true });
  await searchByText(page, SEARCH_TEXT);
  const below = page.getByRole("link", { name: "Ask Claude about this search" });
  await below.click();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(below).toBeFocused();
  await openAsk(page);
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByTestId("results-header").getByRole("link")).toBeFocused();
});

test("a selection from an earlier search is said, not silently dropped (review CTX-4)", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en", ai: true });
  await searchAndSelectTwo(page);
  // The same search again: a new snapshot; the two chosen stay chosen, on the earlier one.
  await page.getByRole("button", { name: /^Search again/ }).click();
  await expect(page.locator(".ag-results[data-run]")).toHaveAttribute("data-run", "finished");
  await openAsk(page);
  await expect(context(page)).toContainText("The selected results are not all from the search on screen, so none can be attached.");
  await expect(page.getByRole("checkbox", { name: /^Attach/ })).toHaveCount(0);
  await expect(context(page).locator(".ask-context-sends")).toHaveText("Only the query conditions will be sent.");
});

test("the page is one column: no gaps, the header on screen, the composer above the keyboard and some conversation showing (review UI-2, UI-7)", async ({ page }) => {
  await fakeKeyboard(page);
  await page.setViewportSize({ width: 320, height: 568 });
  await openScenario(page, "complete", "ios", { lang: "en", ai: true });
  await searchAndSelectTwo(page);
  await openAsk(page);
  await page.getByRole("checkbox", { name: "Attach the 2 selected results" }).check();
  const composer = page.getByRole("textbox", { name: "Question for Claude" });
  await composer.fill("Compare these two.");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.locator(".ask-entry")).toContainText("R1 needs fewer miles");
  const edges = () =>
    page.evaluate(() => {
      const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
      const scroll = document.querySelector<HTMLElement>(".ask-scroll")!;
      return { header: box(".ask-header"), context: box(".ask-context"), scroll: box(".ask-scroll"), composer: box(".ask-composer"), scrollInner: scroll.clientHeight, bodyScroll: document.scrollingElement!.scrollTop };
    });
  let e = await edges();
  expect(e.header.bottom).toBeCloseTo(e.context.top, 0);
  expect(e.context.bottom).toBeCloseTo(e.scroll.top, 0);
  expect(e.scroll.bottom).toBeCloseTo(e.composer.top, 0);
  await composer.focus();
  await keyboard(page, 253);
  await expect.poll(async () => (await edges()).composer.bottom).toBeLessThanOrEqual(568 - 253 + 0.5);
  e = await edges();
  expect(e.header.top).toBeGreaterThanOrEqual(0);
  expect(e.bodyScroll).toBe(0);
  expect(e.scroll.height).toBeGreaterThanOrEqual(96);
  expect(e.context.height).toBeLessThanOrEqual(64.5);
});

test("large text at 320: the title and New conversation both show, nothing off the side; references are full-size targets (review UI-3, UI-4)", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openScenario(page, "complete", "ios", { lang: "en", ai: true });
  await searchAndSelectTwo(page);
  await openAsk(page);
  await page.getByRole("checkbox", { name: "Attach the 2 selected results" }).check();
  await page.getByRole("textbox", { name: "Question for Claude" }).fill("Compare these two.");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.locator(".ask-entry")).toContainText("R1 needs fewer miles");
  for (const link of await page.locator(".ask-ref-link").all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.evaluate(() => document.documentElement.style.setProperty("--ag-text-scale", "2"));
  const title = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
  const button = (await page.getByRole("button", { name: "New conversation" }).boundingBox())!;
  expect(title.width).toBeGreaterThan(40);
  expect(button.x + button.width).toBeLessThanOrEqual(320.5);
  const overlap = !(title.x + title.width <= button.x || button.x + button.width <= title.x || title.y + title.height <= button.y || button.y + button.height <= title.y);
  expect(overlap).toBe(false);
});

test("a missing key's way to Settings comes into view below a saved conversation (review UI-8)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await openScenario(page, "complete", "ios", { lang: "en", ai: true });
  await searchByText(page, SEARCH_TEXT);
  await openAsk(page);
  const composer = page.getByRole("textbox", { name: "Question for Claude" });
  for (const q of ["First question?", "Second question?", "Third question?"]) {
    await composer.fill(q);
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.locator(".ask-entry").filter({ hasText: q })).toContainText(ANSWER);
  }
  // Relaunched without an Anthropic key: the conversation is read back, and the key is what is missing.
  await openScenario(page, "complete", "ios", { lang: "en", preserveStorage: true });
  await page.getByTestId("results-header").getByRole("link").click();
  await expect(page.locator(".ask-entry")).toHaveCount(3);
  await expect(page.getByRole("link", { name: "Add an Anthropic key" })).toBeInViewport();
});

test("an answer is in the reading colour, not the secondary one (review UI-6)", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en", ai: true });
  await searchByText(page, SEARCH_TEXT);
  await openAsk(page);
  await page.getByRole("textbox", { name: "Question for Claude" }).fill("Anything nonstop?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.locator(".ask-answer p").first()).toBeVisible();
  const colours = await page.evaluate(() => ({
    answer: getComputedStyle(document.querySelector(".ask-answer p")!).color,
    question: getComputedStyle(document.querySelector(".ask-question")!).color,
  }));
  expect(colours.answer).toBe(colours.question);
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: Ask with attached results at 390`, async ({ page }) => {
    await openScenario(page, "complete", "ios", { theme, lang: "zh", ai: true });
    await searchAndSelectTwo(page);
    await openAsk(page);
    await page.getByRole("checkbox", { name: "附带已选的 2 个结果" }).check();
    await page.getByRole("textbox", { name: "向 Claude 提问" }).fill("比较这两个。");
    await page.getByRole("button", { name: "提问", exact: true }).click();
    await expect(page.locator(".ask-entry")).toContainText("R1");
    await expect(page.locator(".ask-entry .ask-answer")).toBeVisible();
    await evidenceShot(page, `t15-ask-${theme}`);
  });
}
