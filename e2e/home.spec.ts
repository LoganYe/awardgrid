/**
 * The front door at `/` (docs/UI_PLAN.md §6.10; HANDOFF.md §3.4 acceptance criteria 1, 2, 3, 9,
 * 10, 14 and 16).
 *
 * `/` is the only route in the product that branches on the session: signed out it renders, and
 * signed in it is the single redirect to /grid it has always been. Both halves are asserted on
 * the wire rather than through the browser's own redirect following, because "renders" and
 * "redirects" are a status code and a header and `page.goto` hides both. `page.request` shares
 * the browser context's cookie jar, so `loginAs` is all it takes to attach a session to one.
 *
 * The two controls are `Button`s that render a `<Link>`, so Base UI stamps `role="button"` on the
 * emitted `<a>`: `getByRole("link")` would find neither of them.
 */
import type { Page } from "@playwright/test";
import { en } from "../src/lib/i18n/dictionaries/en";
import { zh } from "../src/lib/i18n/dictionaries/zh";
import { expect, loginAs, queryBox, test } from "./fixtures";
import { E2E_PASSWORD } from "./users";

/** src/lib/auth/session.ts:11, inlined: importing that module pulls drizzle through the loader. */
const SESSION_COOKIE = "ag_session";

function baseURL(): string {
  const url = test.info().project.use.baseURL;
  if (!url) throw new Error("baseURL is not configured");
  return url;
}

/** Replace whatever is in the jar (an empty list leaves a clean signed-out context). */
async function withCookies(page: Page, cookies: { name: string; value: string }[]): Promise<void> {
  const domain = new URL(baseURL()).hostname;
  await page.context().clearCookies();
  if (cookies.length > 0) await page.context().addCookies(cookies.map((c) => ({ ...c, domain, path: "/" })));
}

test.describe("the front door at /", () => {
  test("signed out: 200 with the tagline as h1, in en and in zh", async ({ page }) => {
    await withCookies(page, []);
    const res = await page.request.get("/", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    expect(res.headers()["location"]).toBeUndefined();

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(en["app.tagline"]);
    await expect(page.getByRole("button", { name: en["home.login_link"], exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: en["home.register_link"], exact: true })).toBeVisible();

    await page.context().addCookies([{ name: "ag_locale", value: "zh", domain: new URL(baseURL()).hostname, path: "/" }]);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(zh["app.tagline"]);
  });

  /**
   * Criterion 9: exactly one h1 and three h2s, in source order, no level skipped. Asserted here
   * rather than left to axe, which reports a skipped LEVEL — a second h1, or the three blocks in
   * the wrong order, passes that audit.
   */
  test("signed out: one h1 and three h2s, in order, with no level skipped", async ({ page }) => {
    await withCookies(page, []);
    await page.goto("/");
    const headings = await page
      .locator("main :is(h1, h2, h3, h4, h5, h6)")
      .evaluateAll((els) => els.map((el) => ({ level: Number(el.tagName.slice(1)), text: (el.textContent ?? "").trim() })));
    expect(headings).toEqual([
      { level: 1, text: en["app.tagline"] },
      { level: 2, text: en["home.invite.label"] },
      { level: 2, text: en["home.key.label"] },
      { level: 2, text: en["home.limits.label"] },
    ]);
  });

  /**
   * Criterion 2, for a user with a key and for the keyless one. `nokey` is named by the criterion
   * because the front door must not duplicate the grid's own `grid.empty.no_key` state: a user
   * without a key is still a user, and /grid is where that is explained.
   */
  test("signed in: one 307 to /grid, and no front-door markup in the body", async ({ page }) => {
    for (const user of ["demo", "nokey"] as const) {
      await loginAs(page, user);
      const res = await page.request.get("/", { maxRedirects: 0 });
      expect(res.status(), user).toBe(307);
      expect(new URL(res.headers()["location"] ?? "", baseURL()).pathname, user).toBe("/grid");
      const body = await res.text();
      expect(body, user).not.toContain(en["app.tagline"]);
      expect(body, user).not.toContain(en["home.lead"]);
      // One hop, not two: /grid answers 200 with the same cookie.
      expect((await page.request.get("/grid", { maxRedirects: 0 })).status(), user).toBe(200);
    }
  });

  /**
   * Criterion 3, first two states. A malformed token fails TOKEN_RE and a well-shaped unknown one
   * finds no row; both return null (session.ts:46, :54) and are HTTP-indistinguishable from an
   * expired session, whose row-deleting branch (session.ts:55-58) is pinned by
   * src/lib/auth/session.test.ts and cannot be produced from here without opening the database.
   */
  test("a bad session cookie renders the front door, not a redirect and not a 500", async ({ page }) => {
    for (const [label, value] of [
      ["malformed", "not-a-session-token"],
      ["well-shaped but unknown", "x".repeat(43)],
    ] as const) {
      await withCookies(page, [{ name: SESSION_COOKIE, value }]);
      const res = await page.request.get("/", { maxRedirects: 0 });
      expect(res.status(), label).toBe(200);
      expect(res.headers()["location"], label).toBeUndefined();
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 }), label).toHaveText(en["app.tagline"]);
    }
  });

  /** Criterion 3, the third state: a session that existed and was revoked while the cookie lived on. */
  test("a revoked session cookie renders the front door", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-light", "one pass; it spends a real login");
    const url = baseURL();
    const domain = new URL(url).hostname;
    await withCookies(page, []);

    // A throwaway second session, so the worker's cached `demo` cookie is never the revoked one:
    // POST /api/auth/logout revokes only the token it is presented with (logout/route.ts:13).
    const login = await page.request.post("/api/auth/login", {
      headers: { origin: url, "content-type": "application/json" },
      data: { username: "demo", password: E2E_PASSWORD },
    });
    expect(login.ok()).toBe(true);
    const live = (await page.context().cookies()).find((c) => c.name === SESSION_COOKIE);
    expect(live?.value, "the login set a session cookie").toBeTruthy();
    expect((await page.request.get("/", { maxRedirects: 0 })).status(), "while the session is live").toBe(307);

    // Logout revokes the row AND expires the cookie, so put the dead token back in the jar.
    expect((await page.request.post("/api/auth/logout", { headers: { origin: url } })).status()).toBe(204);
    await page.context().addCookies([{ name: SESSION_COOKIE, value: live!.value, domain, path: "/" }]);

    const res = await page.request.get("/", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    expect(res.headers()["location"]).toBeUndefined();
  });

  /**
   * Criterion 14, scoped to what is achievable. The page declares no `searchParams` and reads
   * nothing from the query string, so the rendered page is identical — but Next serialises the
   * request's canonical URL and its search into the inline flight payload of every dynamic
   * document (`self.__next_f.push`), exactly as it already does for `/register?code=…`. So the
   * assertion is on the rendered page, not on the response bytes; the criterion as written was
   * not achievable and the reason is recorded in DECISIONS.md.
   */
  test("signed out: /?code=… renders the same page and never displays the code", async ({ page }) => {
    const code = "E2E-NOT-A-REAL-INVITE";
    await withCookies(page, []);
    await page.goto(`/?code=${code}`);
    const withCode = await page.locator("main").innerHTML();
    expect(await page.locator("body").innerText()).not.toContain(code);
    await page.goto("/");
    expect(await page.locator("main").innerHTML()).toBe(withCode);
  });

  /** Criterion 16: the signed-in path to a search is unchanged — one navigation, one hop. */
  test("signed in: / reaches the grid query box in one navigation", async ({ page, asUser }) => {
    await asUser("demo");
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe("/grid");
    const hop = response?.request().redirectedFrom();
    expect(hop, "the / to /grid hop").not.toBeNull();
    expect(hop?.redirectedFrom(), "a second hop").toBeNull();
    await expect(queryBox(page)).toBeVisible();
  });

  /**
   * Criterion 10's other half. e2e/responsive.spec.ts measures the floor at 390 px on
   * desktop-light, where only the `(max-width: 767px)` arm of globals.css:262 fires — and 390 px
   * on a mobile project would measure the same arm again. The viewport is widened to 874 px, the
   * landscape width issue #32 was filed about: `isMobile`/`hasTouch` are context-level so the
   * pointer stays coarse across a resize, which leaves `(pointer: coarse)` alone holding the floor.
   */
  test("every control on / clears 40 px under a coarse pointer alone", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith("mobile"), "the coarse-pointer arm of the floor");
    await withCookies(page, []);
    await page.setViewportSize({ width: 874, height: 390 });
    await page.goto("/");
    expect(await page.evaluate(() => matchMedia("(max-width: 767px)").matches), "the width arm must be out of range").toBe(false);
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), "the pointer arm must still match").toBe(true);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(en["app.tagline"]);
    const small = await page.locator("main :is(a[href], button, [role='button'])").evaluateAll((els) =>
      els
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { name: (el.textContent ?? "").trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) };
        })
        .filter((m) => m.w < 40 || m.h < 40)
        .map((m) => `${m.name} ${m.w}x${m.h}`),
    );
    expect(small).toEqual([]);
  });
});
