/**
 * T17: Stop, interruption and the page's own lines (plan 03 T17; docs/04 S09; acceptance A28, A21).
 *
 * Stop reads "Stop subsequent steps" with its note: the request already out finishes and may be billed, and nothing
 * more is sent. A question the app was closed during is said as unfinished on the next launch and is not sent again
 * on its own. `ai-stopped` shows a question stopped while its request was out, with lower-bound counts.
 */
import { anthropicContexts, evidenceShot, openScenario, requestLog, searchByText } from "./helpers";
import { expect, test } from "./test";

const SEARCH_TEXT = "Synthetic HKG to SEA October business and first";

test("Stop stops the next steps: the approved words, the request out finishes, nothing more is sent (A28)", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en", ai: true });
  await searchByText(page, SEARCH_TEXT);
  await page.getByTestId("results-header").getByRole("link").click();
  await page.getByRole("textbox", { name: "Question for Claude" }).fill("Anything nonstop?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const stop = page.getByRole("button", { name: "Stop subsequent steps" });
  await expect(stop).toBeVisible();
  await expect(page.getByText("Requests already sent cannot be recalled and may still be billed.")).toBeVisible();
  await expect.poll(async () => (await requestLog(page)).anthropic).toBe(1);
  await stop.click();
  const entry = page.locator(".ask-entry");
  await expect(entry).toContainText("Stopped. Nothing more will be sent for this question. The request already sent to Anthropic still finishes and may be billed.");
  // What Anthropic never reported is not said as nothing.
  await expect(entry.locator(".ask-meta")).toContainText("at least 1 request");
  await page.waitForTimeout(700);
  expect((await requestLog(page)).anthropic).toBe(1);
  expect(await anthropicContexts(page)).toHaveLength(1);
});

test("a question the app was closed during is unfinished on the next launch and is not sent again (A28)", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en", ai: true });
  await searchByText(page, SEARCH_TEXT);
  await page.getByTestId("results-header").getByRole("link").click();
  await page.getByRole("textbox", { name: "Question for Claude" }).fill("Anything nonstop?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect.poll(async () => (await requestLog(page)).anthropic).toBe(1);
  // Closed while the answer is out.
  await openScenario(page, "complete", "ios", { lang: "en", ai: true, preserveStorage: true });
  await page.getByTestId("results-header").getByRole("link").click();
  const entry = page.locator(".ask-entry");
  await expect(entry).toContainText("This question did not finish because awardgrid was closed while it ran. Requests already sent may have been billed.");
  await expect(page.getByRole("button", { name: "Ask again" })).toBeVisible();
  await page.waitForTimeout(700);
  expect((await requestLog(page)).anthropic).toBe(0);
});

test("ai-stopped in Chinese: the ending, the lower-bound counts and Ask again all speak Chinese", async ({ page }) => {
  await openScenario(page, "ai-stopped", "ios", { lang: "zh" });
  await page.getByTestId("results-header").getByRole("link").click();
  const entry = page.locator(".ask-entry");
  await expect(entry).toContainText("已停止后续步骤。本问题不会再发送任何内容。已发给 Anthropic 的请求仍会完成，并可能计费。");
  await expect(entry.locator(".ask-meta")).toHaveText("Claude Opus 5 · 至少 1 次请求 · Anthropic 没有报告最后一个请求的用量");
  await expect(entry.locator(".ask-meta")).not.toHaveAttribute("lang", "en");
  await expect(entry.getByRole("button", { name: "重新提问" })).toBeVisible();
  expect((await requestLog(page)).anthropic).toBe(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: a stopped question in Chinese at 390`, async ({ page }) => {
    await openScenario(page, "ai-stopped", "ios", { theme, lang: "zh" });
    await page.getByTestId("results-header").getByRole("link").click();
    await expect(page.locator(".ask-entry")).toContainText("已停止后续步骤");
    await evidenceShot(page, `t17-stopped-${theme}`);
  });
}
