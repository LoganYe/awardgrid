/**
 * Phase 6.5 — the Settings page (spec §5, docs/UI_PLAN.md §6.8): five sections separated by a
 * heading and space, with no cards and no borders around them.
 *
 * Everything is seeded demo data on the offline mock: the "demo" user has a seeded seats.aero
 * connection, the "connect" user none, the "rekey" user had a pasted key the move to Login with
 * Seats.aero removed, and the "linked" user has a fake Telegram chat id and quiet hours
 * (scripts/seed-e2e.ts).
 *
 * Connecting is NOT stubbed: Connect opens the mock's consent page (SEATS_OAUTH_CONSENT_URL),
 * which redirects to the app's callback, whose code is exchanged at the mock's token-service
 * stand-in (SEATS_OAUTH_TOKEN_SERVICE_URL); the mock then accepts the access token it issued.
 *
 * One request is stubbed: POST /api/telegram/link, because the app process runs with no
 * TELEGRAM_BOT_TOKEN and no TELEGRAM_BOT_USERNAME, so the route truthfully answers
 * `{ deepLink: null, mock: true }` and there is nothing for the page to encode. The stub returns
 * a link of the shape the real bot hands out, so the component, the in-repo QR encoder and the
 * waiting state run exactly as they do in production.
 *
 * This spec asserts; it does not photograph. Every capture of these states is declared in
 * `e2e/matrix.ts` and written by `e2e/screenshots.spec.ts` (#34) — one owner per file.
 */
import type { Page } from "@playwright/test";
import { request as playwrightRequest } from "@playwright/test";
import { en } from "@awardgrid/core/i18n/dictionaries/en";
import { zh } from "@awardgrid/core/i18n/dictionaries/zh";
import { applyTheme, expect, forgetLoginCookies, projectSuffix, test } from "./fixtures";
import { E2E_PASSWORD } from "./users";

/** A fake deep link of the shape the bot hands out (43-character one-time token). */
const FAKE_DEEP_LINK = `https://t.me/awardgrid_demo_bot?start=${"Ab3xY".repeat(8)}zqk`;

const sections = (page: Page) => page.locator("[data-settings-section]");
const keyRow = (page: Page, provider: string) => page.locator(`[data-key-row="${provider}"]`);
const seatsSection = (page: Page) => page.locator('[data-settings-section="seats"]');

/** One week of HKG → SEA in business from today: a small search the DEMO mock answers. */
const ONE_WEEK_HKG_SEA = () => {
  const today = new Date();
  const day = (offset: number) => new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  return {
    origins: ["HKG"],
    destinations: ["SEA"],
    date_from: day(0),
    date_to: day(6),
    cabins: ["J"],
    direct_only: false,
    include_filtered: false,
    min_cabin_pct: 100,
    sort_by: "miles_asc",
    raw_text: "HKG to SEA, next week, business",
    language: "en",
  };
};
const timezoneSelect = (page: Page) => page.getByRole("combobox", { name: en["settings.timezone"] });

/** The zone select is disclosure, not furniture: open it only when it is not already open. */
async function openZoneEditor(page: Page): Promise<void> {
  if ((await timezoneSelect(page).count()) > 0) return;
  await page.getByRole("button", { name: en["settings.timezone.change"] }).click();
  await expect(timezoneSelect(page)).toBeVisible();
}

/** Log in through the API with an explicit password (the round-trip below changes one). */
async function loginStatus(baseURL: string, username: string, password: string): Promise<number> {
  const ctx = await playwrightRequest.newContext({ baseURL });
  try {
    const res = await ctx.post("/api/auth/login", {
      headers: { origin: baseURL, "content-type": "application/json" },
      data: { username, password },
    });
    return res.status();
  } finally {
    await ctx.dispose();
  }
}

/** Change `username`'s password through the API, logging in with `from` first. */
async function changePasswordViaApi(baseURL: string, username: string, from: string, to: string): Promise<number> {
  const ctx = await playwrightRequest.newContext({ baseURL });
  try {
    const login = await ctx.post("/api/auth/login", {
      headers: { origin: baseURL, "content-type": "application/json" },
      data: { username, password: from },
    });
    if (!login.ok()) return login.status();
    const res = await ctx.post("/api/auth/password", {
      headers: { origin: baseURL, "content-type": "application/json" },
      data: { current: from, next: to },
    });
    return res.status();
  } finally {
    await ctx.dispose();
  }
}

test.describe("settings", () => {
  test.beforeEach(async ({ page }) => {
    await applyTheme(page);
  });

  test("five sections, headings and space, no cards", async ({ page, asUser }) => {
    await asUser("demo");
    await page.goto("/settings");
    await expect(page.getByRole("heading", { level: 1, name: en["settings.title"] })).toBeVisible();

    // Order: seats.aero, optional API keys, Telegram, Account, Language and theme.
    await expect(page.getByRole("heading", { level: 2 })).toHaveText([
      en["settings.seats.title"],
      en["settings.keys.title"],
      en["settings.telegram.title"],
      en["settings.account.title"],
      en["settings.language_theme.title"],
    ]);
    await expect(sections(page)).toHaveCount(5);

    // No card look: nothing draws a border or a shadow around a section.
    const count = await sections(page).count();
    for (let i = 0; i < count; i++) {
      const section = sections(page).nth(i);
      // Tailwind's preflight leaves every element border-style: solid at width 0; what matters
      // is that no section draws one, and that nothing fakes a card with a shadow.
      for (const side of ["top", "right", "bottom", "left"]) {
        await expect(section).toHaveCSS(`border-${side}-width`, "0px");
      }
      await expect(section).toHaveCSS("box-shadow", "none");
    }
    // The column is the shared 880 px reading column, left-aligned.
    const width = await page.locator("main > div").first().evaluate((el) => el.getBoundingClientRect().width);
    expect(width).toBeLessThanOrEqual(880);

    // seats.aero is connected (never a token on the page); no key row for it, ever.
    await expect(seatsSection(page).locator("[data-seats-status]")).toHaveAttribute("data-seats-status", "connected");
    await expect(seatsSection(page).getByRole("button", { name: en["settings.seats.disconnect"] })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("seats:ota:");
    await expect(keyRow(page, "seats_aero")).toHaveCount(0);
    // The two optional providers, one row each.
    await expect(keyRow(page, "duffel")).toContainText(en["settings.keys.not_set"]);
    await expect(keyRow(page, "ignav")).toContainText(en["settings.keys.not_set"]);
    await expect(page.getByRole("progressbar", { name: en["settings.quota.title"] })).toBeVisible();

  });

  test("optional keys: the add form, and no way to paste a seats.aero key", async ({ page, asUser, baseURL }) => {
    await asUser("demo");
    await page.goto("/settings");

    await keyRow(page, "duffel").getByRole("button", { name: en["settings.keys.add_action"] }).click();
    const duffelInput = keyRow(page, "duffel").getByLabel(en["settings.keys.input_label"]);
    await expect(duffelInput).toBeVisible();
    await expect(duffelInput).toHaveAttribute("type", "password");
    await keyRow(page, "duffel").getByRole("button", { name: en["common.cancel"] }).click();

    // The API refuses a seats.aero key outright: nothing is stored, nothing is sent to seats.aero.
    const res = await page.request.put(`${baseURL}/api/keys`, {
      headers: { origin: baseURL!, "content-type": "application/json" },
      data: { provider: "seats_aero", key: "demo-key-normal" },
    });
    expect([res.status(), await res.json()]).toEqual([400, { error: "invalid_provider" }]);
  });

  test("connect seats.aero: seats.aero's page, back connected, then disconnect", async ({ page, asUser }) => {
    await asUser("connect");
    await page.goto("/settings");
    const seats = seatsSection(page);
    await expect(seats.locator("[data-seats-status]")).toHaveAttribute("data-seats-status", "not_connected");

    // Connect: the mock's consent page answers at once with a redirect to the app's callback, which exchanges the
    // code and lands back here with the outcome, said once and then taken out of the address.
    await seats.getByRole("button", { name: en["settings.seats.connect"] }).click();
    await page.waitForURL(/\/settings/);
    await expect(seats.getByRole("status").filter({ hasText: en["settings.seats.outcome.connected"] })).toBeVisible();
    await expect(seats.locator("[data-seats-status]")).toHaveAttribute("data-seats-status", "connected");
    await expect.poll(() => new URL(page.url()).searchParams.has("seats")).toBe(false);
    await expect(page.locator("body")).not.toContainText("seats:ota:");

    // The issued token works: a search answers (the mock accepts only access tokens it issued, or seeded ones).
    const origin = new URL(page.url()).origin;
    const find = await page.request.post("/api/find", { headers: { origin, "content-type": "application/json" }, data: { query: ONE_WEEK_HKG_SEA() } });
    expect(find.status()).toBe(200);

    // Disconnect confirms inline, then the account is not connected and searching asks to connect again.
    await seats.getByRole("button", { name: en["settings.seats.disconnect"] }).click();
    await seats.getByTestId("seats-disconnect-confirm").getByRole("button", { name: en["settings.seats.disconnect"] }).click();
    await expect(seats.getByRole("status").filter({ hasText: en["settings.seats.disconnected"] })).toBeVisible();
    await expect(seats.locator("[data-seats-status]")).toHaveAttribute("data-seats-status", "not_connected");
    const after = await page.request.post("/api/find", { headers: { origin, "content-type": "application/json" }, data: { query: ONE_WEEK_HKG_SEA() } });
    expect([after.status(), (await after.json()).error]).toEqual([409, "no_key"]);
  });

  test("a removed key: the one-time notice on the grid and in Settings, until dismissed", async ({ page, asUser }) => {
    // The dismissal belongs to the account, not to a project: one project dismisses it.
    test.skip(test.info().project.name !== "desktop-light", "the notice is dismissed once per account");
    await asUser("rekey");
    await page.goto("/grid");
    await expect(page.getByTestId("grid-no-key")).toContainText(en["seats.reconnect_notice"]);
    await page.goto("/settings");
    const notice = seatsSection(page).getByTestId("seats-reconnect-notice");
    await expect(notice).toContainText(en["seats.reconnect_notice"]);
    await notice.getByRole("button", { name: en["settings.seats.dismiss"] }).click();
    await expect(notice).toHaveCount(0);
    await page.reload();
    await expect(seatsSection(page).getByTestId("seats-reconnect-notice")).toHaveCount(0);
    await page.goto("/grid");
    await expect(page.getByTestId("grid-no-key")).toContainText(en["grid.empty.no_key"]);
  });

  test("telegram: the deep link, the QR and the waiting line", async ({ page, asUser }) => {
    await asUser("demo");
    // The app has no bot configured, so stand in for the one call that mints the link.
    await page.route("**/api/telegram/link", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await route.fulfill({ json: { deepLink: FAKE_DEEP_LINK, mock: true } });
    });
    await page.goto("/settings");

    const telegram = page.locator("[data-telegram]");
    // The status answers "is my account linked?", not "how is the server configured": the
    // server-side caveat is the muted line under it.
    await expect(telegram.locator("[data-telegram-status]")).toHaveText(en["settings.telegram.status.not_linked"]);
    await expect(telegram.locator("[data-telegram-mock-explain]")).toHaveText(en["settings.telegram.mock_explain"]);
    await page.getByRole("button", { name: en["settings.telegram.link"] }).click();

    const invite = page.locator("[data-telegram-invite]");
    await expect(invite).toBeVisible();
    // The "open" control is an anchor styled as a button, so it carries the link itself.
    const openLink = invite.locator("a[href]");
    await expect(openLink).toHaveText(en["settings.telegram.open_link"]);
    await expect(openLink).toHaveAttribute("href", FAKE_DEEP_LINK);
    // The QR is an inline SVG from the in-repo encoder: named, square, and 160 px on the page.
    const qr = invite.getByRole("img", { name: en["settings.telegram.qr_alt"] });
    await expect(qr).toBeVisible();
    const box = await qr.boundingBox();
    expect(box?.width).toBe(160);
    expect(box?.height).toBe(160);
    await expect(invite.getByText(en["settings.telegram.qr_alt"])).toBeVisible();
    await expect(page.locator("[data-telegram-waiting]")).toContainText(en["settings.telegram.waiting_start"]);

  });

  test("telegram: a linked account, its quiet hours and the detected zone", async ({ page, asUser }) => {
    await asUser("linked");
    await page.goto("/settings");

    await expect(page.locator("[data-telegram-status]")).toHaveText(en["settings.telegram.status.linked"]);
    await expect(page.getByLabel(en["settings.quiet_hours.from"], { exact: true })).toHaveValue("22:00");
    await expect(page.getByLabel(en["settings.quiet_hours.to"], { exact: true })).toHaveValue("07:00");
    // Two fields and one muted line naming the zone — the timezone select is NOT a third field
    // (docs/UI_PLAN.md §12.11); it lives behind "Change time zone".
    const zoneLine = page.locator("[data-detected-zone]");
    await expect(zoneLine).toHaveAttribute("data-account-zone", "Asia/Shanghai");
    await expect(zoneLine).toContainText(en["settings.timezone_account"].replace("{tz}", "Asia/Shanghai"));
    await expect(timezoneSelect(page)).toHaveCount(0);

    // The override is still reachable: disclose it, take the browser's own zone (UTC here), save.
    await openZoneEditor(page);
    await expect(timezoneSelect(page)).toHaveValue("Asia/Shanghai");
    await expect(zoneLine).toHaveAttribute("data-detected-zone", "UTC");
    await page.getByRole("button", { name: en["settings.timezone.use_detected"] }).click();
    await expect(timezoneSelect(page)).toHaveValue("UTC");

    // Saving round-trips through PUT /api/settings, then the same again to put the zone back
    // (the button is disabled until something actually differs from what the server holds).
    const save = page.getByRole("button", { name: en["common.save"], exact: true });
    await save.click();
    await expect(page.getByText(en["settings.saved"])).toBeVisible();
    await expect(zoneLine).toContainText(en["settings.timezone_detected"].replace("{tz}", "UTC"));
    await openZoneEditor(page);
    await timezoneSelect(page).selectOption("Asia/Shanghai");
    await save.click();
    await expect(zoneLine).toHaveAttribute("data-account-zone", "Asia/Shanghai");

    // Unlink asks in the row, not in a modal.
    await page.getByRole("button", { name: en["settings.telegram.unlink"] }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText(en["settings.telegram.unlink_title"])).toBeVisible();
    await expect(page.getByRole("button", { name: en["common.keep"] })).toBeVisible();
    await page.getByRole("button", { name: en["common.keep"] }).click();
  });

  test("the settings confirmations behave like the Queries one: Esc cancels and focus comes back", async ({ page, asUser }) => {
    await asUser("demo");
    await page.goto("/settings");

    // Disconnecting seats.aero.
    const disconnect = seatsSection(page).getByTestId("seats-disconnect");
    await disconnect.click();
    const seatsConfirm = page.getByTestId("seats-disconnect-confirm");
    await expect(seatsConfirm).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(seatsConfirm.getByRole("button", { name: en["settings.seats.disconnect"], exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(seatsConfirm).toHaveCount(0);
    await expect(disconnect).toBeFocused();
    await expect(seatsSection(page).locator("[data-seats-status]")).toHaveAttribute("data-seats-status", "connected");

    // Logging out everywhere — the same component, so the same keyboard contract.
    const logoutAll = page.getByTestId("logout-all");
    await logoutAll.click();
    const logoutConfirm = page.getByTestId("logout-all-confirm");
    await expect(logoutConfirm).toBeVisible();
    await expect(logoutConfirm.getByRole("button", { name: en["settings.account.logout_all"], exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(logoutConfirm).toHaveCount(0);
    await expect(logoutAll).toBeFocused();
  });

  test("language and theme persist through the account", async ({ page, asUser }) => {
    await asUser("linked");
    await page.goto("/settings");

    await expect(page.getByRole("radio", { name: "English" })).toBeChecked();
    await expect(page.getByRole("radio", { name: en["theme.system"] })).toBeChecked();

    // Each project drives ITS OWN theme radio. Forcing dark here made the four "-light"
    // captures byte-identical to their dark twins, so the light rendering of this section was
    // documented nowhere (spec §9: every state in light AND dark).
    const { theme } = projectSuffix(test.info().project.name);
    await page.getByRole("radio", { name: en[theme === "dark" ? "theme.dark" : "theme.light"] }).check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

    // Chinese: the whole page re-renders from the server on the next request.
    await page.getByRole("radio", { name: "中文（简体）" }).check();
    await expect(page.getByRole("heading", { level: 1, name: zh["settings.title"] })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: zh["settings.keys.title"] })).toBeVisible();
    await expect(page.getByRole("button", { name: zh["settings.seats.disconnect"] })).toBeVisible();

    // Back to the defaults so the next test starts from English and the system theme.
    await page.getByRole("radio", { name: "English" }).check();
    await expect(page.getByRole("heading", { level: 1, name: en["settings.title"] })).toBeVisible();
    await page.getByRole("radio", { name: en["theme.system"] }).check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
  });

  test("account: change password, then log in with the new one", async ({ page, asUser }) => {
    const baseURL = test.info().project.use.baseURL ?? "";
    const NEW_PASSWORD = `${E2E_PASSWORD}-changed`;
    await asUser("linked");
    await page.goto("/settings");

    const account = page.locator('[data-settings-section="account"]');
    await expect(account.getByText("linked", { exact: true })).toBeVisible();
    await expect(account.getByText(en["auth.password_hint"])).toBeVisible();

    try {
      // The wrong current password fails inline, under the fields, never in a modal.
      await account.getByLabel(en["settings.account.current_password"]).fill("not-the-password");
      await account.getByLabel(en["settings.account.new_password"]).fill(NEW_PASSWORD);
      await account.getByRole("button", { name: en["settings.account.change_password"] }).click();
      await expect(account.getByRole("alert")).toHaveText(en["error.invalid_current"]);
      await expect(page.getByRole("dialog")).toHaveCount(0);

      // Too short is caught before the request leaves.
      await account.getByLabel(en["settings.account.current_password"]).fill(E2E_PASSWORD);
      await account.getByLabel(en["settings.account.new_password"]).fill("short");
      await account.getByRole("button", { name: en["settings.account.change_password"] }).click();
      await expect(account.getByRole("alert")).toHaveText(en["error.weak_password"]);

      // The real change: confirmed inline, and the fields are cleared.
      await account.getByLabel(en["settings.account.new_password"]).fill(NEW_PASSWORD);
      await account.getByRole("button", { name: en["settings.account.change_password"] }).click();
      await expect(account.getByText(en["settings.account.password_changed"])).toBeVisible();
      await expect(account.getByLabel(en["settings.account.current_password"])).toHaveValue("");
      // This device stays logged in on a rotated session.
      await page.reload();
      await expect(page.getByRole("heading", { level: 1, name: en["settings.title"] })).toBeVisible();

      // The old password is gone; the new one works.
      expect(await loginStatus(baseURL, "linked", E2E_PASSWORD)).toBe(401);
      expect(await loginStatus(baseURL, "linked", NEW_PASSWORD)).toBe(200);
    } finally {
      // Every other spec (and every later project) expects the seeded password.
      forgetLoginCookies("linked");
      const status = await changePasswordViaApi(baseURL, "linked", NEW_PASSWORD, E2E_PASSWORD);
      forgetLoginCookies("linked");
      expect([200, 401]).toContain(status);
    }
  });
});
