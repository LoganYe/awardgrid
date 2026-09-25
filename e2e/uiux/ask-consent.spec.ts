/**
 * Release D10: Ask asks before it sends anything to Anthropic (App Review Guideline 5.1.2(i)).
 *
 * With no permission given, Ask opens the consent sheet instead of sending: it names Anthropic, lists what a question
 * carries, says what never goes, and links Anthropic's privacy policy. Not now sends nothing and keeps the question in
 * the box; Allow sends that question and is remembered across a relaunch; withdrawing it on the Anthropic key page
 * brings the sheet back. The host's scripted Anthropic counts every request, so "nothing was sent" is a count of zero.
 */
import type { Page } from "@playwright/test";
import { openScenario, requestLog, searchByText } from "./helpers";
import { expect, test } from "./test";

const SEARCH_TEXT = "Synthetic HKG to SEA October business and first";
const ANSWER = "R1 needs fewer miles than R2. Confirm on the program's own site before transferring points.";

async function openAsk(page: Page) {
  await searchByText(page, SEARCH_TEXT);
  await page.getByTestId("results-header").getByRole("link").click();
}

test("the first question opens the consent sheet; Not now sends nothing and keeps the question", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en", ai: true, consent: false });
  await openAsk(page);
  const composer = page.getByRole("textbox", { name: "Question for Claude" });
  await composer.fill("Which is cheaper?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();

  const sheet = page.getByRole("dialog", { name: "Allow Ask to send data to Anthropic?" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Ask answers with Claude, an AI model run by Anthropic, on your own Anthropic API key.");
  await expect(sheet.getByRole("listitem")).toHaveText([
    "Your question, and the earlier questions and answers in this conversation",
    "The search you include, and any results you attach",
    "The seats.aero results Ask reads to answer",
  ]);
  await expect(sheet).toContainText("Your seats.aero key is never sent to Anthropic");
  await expect(sheet.getByRole("link", { name: "Anthropic's privacy policy" })).toHaveAttribute("href", "https://www.anthropic.com/legal/privacy");
  expect((await requestLog(page)).anthropic).toBe(0);

  await sheet.getByRole("button", { name: "Not now" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "Nothing was sent to Anthropic." })).toBeVisible();
  await expect(composer).toHaveValue("Which is cheaper?");
  expect((await requestLog(page)).anthropic).toBe(0);
  await expect(page.locator(".ask-entry")).toHaveCount(0);
});

test("Allow sends that question, and is remembered on the next launch", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en", ai: true, consent: false });
  await openAsk(page);
  await page.getByRole("textbox", { name: "Question for Claude" }).fill("Which is cheaper?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.getByRole("dialog", { name: "Allow Ask to send data to Anthropic?" }).getByRole("button", { name: "Allow and ask" }).click();
  await expect(page.locator(".ask-entry").first()).toContainText(ANSWER);
  expect((await requestLog(page)).anthropic).toBeGreaterThanOrEqual(1);

  // A relaunch keeping this device's files: the permission is still there, and no sheet comes first.
  await openScenario(page, "complete", "ios", { lang: "en", ai: true, preserveStorage: true });
  await openAsk(page);
  await page.getByRole("textbox", { name: "Question for Claude" }).fill("And the other one?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".ask-entry").last()).toContainText(ANSWER);
});

test("withdrawing on the Anthropic key page brings the sheet back before the next question", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "en", ai: true });
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: /Anthropic API key/ }).click();
  const permission = page.getByTestId("ask-permission");
  await expect(permission).toContainText("You allowed Ask to send data to Anthropic.");
  await permission.getByRole("button", { name: "Withdraw permission" }).click();
  await expect(permission).toContainText("Permission withdrawn.");
  await expect(permission).toContainText("Ask has not been allowed to send data to Anthropic.");

  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Search" }).click();
  await openAsk(page);
  await page.getByRole("textbox", { name: "Question for Claude" }).fill("Which is cheaper?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Allow Ask to send data to Anthropic?" })).toBeVisible();
  expect((await requestLog(page)).anthropic).toBe(0);
});

test("in Chinese, the sheet speaks Chinese and names Anthropic", async ({ page }) => {
  await openScenario(page, "complete", "ios", { lang: "zh", ai: true, consent: false });
  await openAsk(page);
  await page.getByRole("textbox", { name: "向 Claude 提问" }).fill("哪个更便宜？");
  await page.getByRole("button", { name: "提问", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "允许 AI 辅助向 Anthropic 发送数据？" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: "允许并提问" })).toBeVisible();
  await sheet.getByRole("button", { name: "暂不" }).click();
  await expect(page.getByRole("status").filter({ hasText: "没有向 Anthropic 发送任何内容。" })).toBeVisible();
  expect((await requestLog(page)).anthropic).toBe(0);
});
