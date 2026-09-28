/**
 * App Store screenshots for the next version's listing (v2). Not a behaviour test, and separate from the 1.0 set
 * (./appstore-screenshots.spec.ts, docs/release/appstore/1.0), which it leaves alone. It renders the real app in the
 * fixture host at the 6.9-inch iPhone size (440×956 pt at 3×), then frames each screen under a short caption on a
 * 1320×2868 px image, in English (en-US) and Chinese (zh-Hans), with a "Sample data" / "示例数据" label in the corner
 * of every image. The captions and labels are in scripts/growth/appstore-captions-next.ts. Each caption must pass the public-claims
 * gate (scripts/growth/validate-public-claims.mjs) on its own before its image is written; the root tests
 * (scripts/growth/store-captions-next.test.ts) check the same on every run, and the committed images' size.
 *
 *   UIUX_STORE_SHOTS_NEXT=docs/release/appstore/next UIUX_WEB=0 \
 *     pnpm exec playwright test --config=playwright.uiux.config.ts appstore-screenshots-next
 *
 * Skipped unless UIUX_STORE_SHOTS_NEXT names the output directory, so the suite never writes these files.
 *
 * Every figure in them is invented. The table, calendar, details and compare screens show SAMPLE_ROWS below: synthetic
 * rows for three origins × three destinations over two weeks, in business and first, generated here from a fixed
 * seed. They reach the fixture host's synthetic seats.aero transport as the `complete` scenario's rows: this spec
 * answers the host's own request for its two fixture JSON modules (availability-rows.json, scenarios.json) with those
 * files plus these rows, from the browser's routing, on loopback. Nothing is written to the fixture files, and every
 * other spec sees them unchanged. The watches, key and Ask screens use the host's scenarios as they are; the Ask shot
 * shows the proposal Ask makes, in the app's own words (the host's scripted answer text is English only). Nothing is
 * sent anywhere (./test.ts locks the network down as for every spec).
 */
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import scenarios from "../../packages/core/test/fixtures/uiux/scenarios.json" with { type: "json" };
import availability from "../../packages/core/test/fixtures/uiux/availability-rows.json" with { type: "json" };
import registry from "../../growth/product-facts.json" with { type: "json" };
import { formatFinding, scanContent } from "../../scripts/growth/validate-public-claims.mjs";
import { STORE_SHOTS_NEXT, type Shot } from "../../scripts/growth/appstore-captions-next";
import { openScenario, searchByText } from "./helpers";
import { expect, test } from "./test";

const OUT = process.env.UIUX_STORE_SHOTS_NEXT;
test.skip(!OUT, "App Store screenshots (next version): set UIUX_STORE_SHOTS_NEXT to the output directory");
test.use({ viewport: { width: 440, height: 956 }, deviceScaleFactor: 3 });

// ---------------------------------------------------------------------------------------------------------------
// Sample rows: three origins × three destinations, 2–15 November 2026, business and first. All invented.
// ---------------------------------------------------------------------------------------------------------------

const ORIGINS = ["HKG", "TPE", "PVG"] as const;
const DESTINATIONS = ["SEA", "SFO", "LAX"] as const;
const PROGRAMS = ["aeroplan", "alaska", "american", "united"] as const;
const FIRST_DAY = "2026-11-02";
const DAYS = 14;

/** A small deterministic generator (mulberry32) seeded from a string, so every run draws the same sample. */
function random(seed: string): () => number {
  let a = 0;
  for (const ch of seed) a = (Math.imul(a ^ ch.charCodeAt(0), 2654435761) + 1) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** One row as availability-rows.json holds it (the fixture host's SyntheticRow). */
interface Row {
  program: string;
  origin: string;
  dest: string;
  date: string;
  cabin: string;
  miles: number;
  fees_cents: number | null;
  currency: string | null;
  seats_left: number;
  direct: boolean;
  airlines: string[];
  computed_last_seen: string | null;
  source_id: string;
  booking_url: string | null;
  fetched_at: string;
  include_filtered: boolean;
  min_cabin_pct: number;
}

function sampleRows(): Row[] {
  const rows: Row[] = [];
  const now = Date.parse(availability.now);
  for (const origin of ORIGINS)
    for (const dest of DESTINATIONS)
      for (let day = 0; day < DAYS; day++) {
        const date = addDays(FIRST_DAY, day);
        const draw = random(`${origin}${dest}${date}`);
        // Business on every day from at least one program, so the table is full; first on some days.
        const businessFrom = PROGRAMS.filter(() => draw() < 0.45);
        if (businessFrom.length === 0) businessFrom.push(PROGRAMS[Math.floor(draw() * PROGRAMS.length)]!);
        const firstFrom = PROGRAMS.filter(() => draw() < 0.22);
        for (const program of PROGRAMS) {
          const cabins = [...(businessFrom.includes(program) ? ["J"] : []), ...(firstFrom.includes(program) ? ["F"] : [])];
          if (cabins.length === 0) continue;
          const seenHoursAgo = 2 + Math.floor(draw() * 20);
          const lastSeen = new Date(now - seenHoursAgo * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
          const direct = draw() < 0.7;
          const feesCents = 2000 + Math.floor(draw() * 60) * 250;
          for (const cabin of cabins)
            rows.push({
              program,
              origin,
              dest,
              date,
              cabin,
              // Skewed towards the dearer end, so the lowest of a day's options differs from day to day.
              miles: (cabin === "J" ? 60_000 : 90_000) + Math.floor(Math.sqrt(draw()) * 14) * 2_500,
              fees_cents: feesCents,
              currency: "USD",
              seats_left: 1 + Math.floor(draw() * 6),
              direct,
              airlines: ["ZZ"],
              computed_last_seen: lastSeen,
              source_id: `sample-${program}-${origin}${dest}-${date}`,
              booking_url: null,
              fetched_at: availability.now,
              include_filtered: false,
              min_cabin_pct: 100,
            });
        }
      }
  return rows;
}

const SAMPLE_ROWS = sampleRows();
/** The fixture scenario whose rows become the sample: no saved files, a key, and a transport that answers. */
const SAMPLE_SCENARIO = "complete";

/**
 * Answer the fixture host's requests for its two fixture JSON modules (Vite serves them as `…/<file>.json?import`) with
 * the sample added: availability-rows.json gains the rows, and the `complete` scenario lists them, and only them. Every
 * other request goes to the fixture host's server as usual. Returns how many of the two were answered, so a test can
 * fail if the host no longer asks for them this way.
 */
async function useSampleRows(page: Page) {
  const base = availability.rows.length;
  const rows = { ...availability, rows: [...(availability.rows as Row[]), ...SAMPLE_ROWS] };
  const manifest = {
    ...scenarios,
    scenarios: scenarios.scenarios.map((s) => (s.id === SAMPLE_SCENARIO ? { ...s, rowIndexes: SAMPLE_ROWS.map((_, i) => base + i) } : s)),
  };
  const jsModule = (value: unknown) => ({ status: 200, contentType: "text/javascript", body: `export default ${JSON.stringify(value)};\n` });
  let served = 0;
  await page.route(/\/packages\/core\/test\/fixtures\/uiux\/availability-rows\.json(\?|$)/, (route) => {
    served += 1;
    return route.fulfill(jsModule(rows));
  });
  await page.route(/\/packages\/core\/test\/fixtures\/uiux\/scenarios\.json(\?|$)/, (route) => {
    served += 1;
    return route.fulfill(jsModule(manifest));
  });
  return () => served;
}

// ---------------------------------------------------------------------------------------------------------------
// Captions and framing
// ---------------------------------------------------------------------------------------------------------------

const LOCALES = [
  {
    lang: "en",
    dir: "en-US",
    html: "en",
    sample: STORE_SHOTS_NEXT["en-US"].sample,
    search: "HKG, TPE and PVG to SEA, SFO and LAX, Nov 2 to Nov 15, business and first",
    typed: "香港、台北、浦东到西雅图、旧金山、洛杉矶 11月2日到11月15日 商务舱、头等舱",
    askSearch: "HKG to SEA in October, business and first",
    views: { list: "List", calendar: "Calendar", matrix: "Matrix" },
    viewOption: /^View option/,
    watches: /Watches/,
    connect: "Connect seats.aero",
    question: { label: "Question for Claude", text: "Is there anything later in the autumn?", ask: "Ask" },
    captions: STORE_SHOTS_NEXT["en-US"].captions,
  },
  {
    lang: "zh",
    dir: "zh-Hans",
    html: "zh-Hans",
    sample: STORE_SHOTS_NEXT["zh-Hans"].sample,
    search: "香港、台北、浦东到西雅图、旧金山、洛杉矶 11月2日到11月15日 商务舱、头等舱",
    typed: "香港、台北、浦东到西雅图、旧金山、洛杉矶 11月2日到11月15日 商务舱、头等舱",
    askSearch: "香港到西雅图 十月 商务舱、头等舱",
    views: { list: "列表", calendar: "日历", matrix: "矩阵" },
    viewOption: /^查看选项/,
    watches: /关注/,
    connect: "连接 seats.aero",
    question: { label: "向 Claude 提问", text: "秋天晚些时候还有吗？", ask: "提问" },
    captions: STORE_SHOTS_NEXT["zh-Hans"].captions,
  },
] as const;

type Locale = (typeof LOCALES)[number];

/** The 6.9-inch iPhone's safe areas (status bar and Dynamic Island above, home indicator below), as WKWebView sees them. */
async function phoneInsets(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride" as never, { insets: { top: 62, bottom: 34, left: 0, right: 0 } } as never);
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The listing image: the app's screen, scaled to 80% inside a rounded frame, under its caption, on the app's accent
 * colour, with the sample label in the top corner. Laid out in points on a 440×956 page and captured at 3×, like the
 * screen itself, so the file is 1320×2868.
 */
function frameHtml(l: Locale, caption: string, png: Buffer): string {
  return `<!doctype html>
<html lang="${l.html}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
  html, body { margin: 0; width: 440px; height: 956px; overflow: hidden; }
  body { position: relative; background: #006D77; color: #FFFFFF;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", sans-serif;
    -webkit-font-smoothing: antialiased; }
  .sample { position: absolute; top: 18px; right: 18px; padding: 4px 11px; border-radius: 999px;
    border: 1.5px solid rgba(255, 255, 255, 0.85); font-size: 13px; font-weight: 600; letter-spacing: 0.01em; line-height: 18px; }
  .caption { position: absolute; left: 32px; right: 32px; top: 50px; height: 112px; display: flex; align-items: center;
    justify-content: center; text-align: center; font-size: 29px; line-height: 1.2; font-weight: 700; letter-spacing: -0.01em;
    text-wrap: balance; }
  /* Chinese lines break after punctuation, never inside a word such as 余座. */
  :lang(zh) .caption { word-break: keep-all; }
  .screen { position: absolute; left: 44px; top: 176px; width: 352px; height: 764.8px; border-radius: 38px; overflow: hidden;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.12), 0 18px 40px rgba(0, 0, 0, 0.28); background: #F6F7F9; }
  .screen img { display: block; width: 352px; height: 764.8px; }
</style></head><body>
  <div class="sample">${escapeHtml(l.sample)}</div>
  <div class="caption">${escapeHtml(caption)}</div>
  <div class="screen"><img alt="" src="data:image/png;base64,${png.toString("base64")}"></div>
</body></html>`;
}

/** A caption is public copy: it has to pass the public-claims gate on its own, as the gate reads a public file. */
function gateFindings(caption: string): string[] {
  return scanContent(caption, { logical: "caption.md", registry }).map(formatFinding);
}

async function shot(page: Page, l: Locale, name: Shot) {
  const caption = l.captions[name];
  expect(gateFindings(caption), `caption ${l.dir}/${name}`).toEqual([]);
  const folder = path.join(OUT!, l.dir);
  fs.mkdirSync(folder, { recursive: true });
  // Let transitions and fonts finish; the listing shows the settled screen.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const screen = await page.screenshot({ animations: "disabled", caret: "hide" });
  const frame = await page.context().newPage();
  try {
    await frame.setContent(frameHtml(l, caption, screen), { waitUntil: "load" });
    await frame.evaluate(() => document.fonts.ready);
    await frame.screenshot({ path: path.join(folder, `${name}.png`), animations: "disabled" });
  } finally {
    await frame.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The screens
// ---------------------------------------------------------------------------------------------------------------

for (const l of LOCALES) {
  test(`${l.dir}: typed search, matrix, details, calendar and compare on the sample`, async ({ page }) => {
    await phoneInsets(page);
    const served = await useSampleRows(page);
    await openScenario(page, SAMPLE_SCENARIO, "ios", { lang: l.lang });
    expect(served(), "the fixture host loaded the sample rows").toBeGreaterThanOrEqual(2);

    // The Search screen with a sentence typed, before it runs.
    await page.locator("#q").fill(l.typed);
    await shot(page, l, "02-text");

    await searchByText(page, l.search);
    await expect(page.getByTestId("availability-card").first()).toBeVisible();

    const view = (name: string) => page.getByTestId("results-view").getByRole("radio", { name, exact: true });
    await view(l.views.matrix).click();
    await expect(page.getByTestId("matrix-view")).toBeVisible();
    await shot(page, l, "01-matrix");

    await view(l.views.calendar).click();
    await expect(page.getByTestId("calendar-view")).toBeVisible();
    await shot(page, l, "04-calendar");

    await view(l.views.list).click();
    await page.getByTestId("availability-card").first().getByRole("button", { name: l.viewOption }).click();
    await expect(page).toHaveURL(/#\/detail\//);
    await shot(page, l, "03-details");
    await page.goBack();

    const boxes = page.getByTestId("availability-list").getByRole("checkbox");
    for (let i = 0; i < 4; i++) await boxes.nth(i).check();
    await page.getByTestId("compare-tray").getByRole("link").click();
    await expect(page).toHaveURL(/#\/compare/);
    await shot(page, l, "05-compare");
  });

  test(`${l.dir}: watches`, async ({ page }) => {
    await phoneInsets(page);
    await openScenario(page, "watch-changes", "ios", { lang: l.lang });
    await page.getByRole("navigation").getByRole("link", { name: l.watches }).click();
    await expect(page.getByTestId("watch-card").first()).toBeVisible();
    await shot(page, l, "06-watches");
  });

  test(`${l.dir}: the seats.aero key`, async ({ page }) => {
    await phoneInsets(page);
    await openScenario(page, "no-seats-key", "ios", { lang: l.lang });
    // Without a key the app opens on its welcome; its first action is the page that asks for the Pro key.
    await page.getByTestId("welcome").getByRole("link", { name: l.connect }).click();
    await expect(page.getByRole("heading", { name: l.connect })).toBeVisible();
    await shot(page, l, "07-key");
  });

  test(`${l.dir}: Ask proposes a change to the search`, async ({ page }) => {
    await phoneInsets(page);
    await openScenario(page, "ai-pending", "ios", { lang: l.lang });
    await searchByText(page, l.askSearch);
    await page.getByTestId("results-header").getByRole("link").click();
    await page.getByRole("textbox", { name: l.question.label }).fill(l.question.text);
    await page.getByRole("button", { name: l.question.ask, exact: true }).click();
    await expect(page.getByTestId("query-change-proposal")).toHaveAttribute("data-status", "pending");
    await shot(page, l, "08-ask");
  });
}
