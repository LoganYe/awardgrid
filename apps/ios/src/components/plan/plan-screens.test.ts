/**
 * The trip planner's screens (release plan step 18): a plan shown as it was read — places with their airports (a
 * metro the parser expanded comes back as that metro), dates with the year and their span, cabins, other conditions
 * and the parser's notices — in English and Chinese; the Search screen's planner box; and Saved › Trip plans, whose
 * action is "Search" with a data source connected and "Try with sample data" without one. No Pro, subscribe or live
 * anywhere, and no link out of the app.
 *
 * Rendered through react-dom/server, as the other screen tests are: effects do not run, so nothing is read or sent.
 */
import { parseQuery } from "@awardgrid/core/query/parse";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Outlet, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { type AppServices, bootstrap } from "../../app/bootstrap";
import { resolveBoot } from "../../app/data-source";
import { MemoryKeyStore } from "../../native/keychain";
import { enterSampleData } from "../../sample/boot";
import { FavoritesScreen } from "../../screens/FavoritesScreen";
import { MemoryFileStore, SnapshotStore } from "../../store/persistence";
import { type PlanDraft, planFromDraft } from "../../store/plans-store";
import { PlanSearch } from "./PlanSearch";
import { PlanView } from "./PlanView";
import { SavedPlans } from "./SavedPlans";

const NOW = new Date("2026-10-18T08:30:00Z");
const TODAY = "2026-10-18";
/** What no screen of the App Store build may say (store-copy.test.ts holds the full lists). */
const PAID = /\bPro\b|subscri|订阅|upgrade|unlock|purchas|\bbuy\b|购买|解锁|付费|\bpaid\b|\blive\b|实时/i;

async function draft(text: string): Promise<PlanDraft> {
  const parsed = await parseQuery(text, { today: TODAY });
  return { text, query: parsed.query, notices: parsed.notices };
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, " ");

function view(plan: PlanDraft, locale: "en" | "zh" = "en"): string {
  return renderToStaticMarkup(createElement(PlanView, { plan, locale, today: TODAY, heading: { level: 3, text: "Plan", id: "plan-title" }, justRead: true }));
}

/** An element under the outlet the chrome gives screens. */
function at(services: AppServices, element: ReactElement): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(Routes, null, createElement(Route, { path: "/", element: createElement(Outlet, { context: services }) }, createElement(Route, { index: true, element }))),
    ),
  );
}

async function liveServices(locale: "en" | "zh" = "en"): Promise<AppServices> {
  return bootstrap({ keys: new MemoryKeyStore(), anthropicKeys: new MemoryKeyStore(), snapshots: new SnapshotStore(new MemoryFileStore()), now: () => NOW, fetchImpl: async () => new Response("{}"), anthropicFetch: async () => new Response("{}"), locale });
}

async function sampleServices(): Promise<AppServices> {
  const files = new MemoryFileStore();
  await enterSampleData(files);
  return bootstrap(await resolveBoot({ snapshots: new SnapshotStore(files), now: () => NOW, locale: "en", fetchImpl: async () => new Response("{}"), anthropicFetch: async () => new Response("{}") }, { beforeSwitch: async () => {}, reboot: () => {} }));
}

describe("a plan on screen", () => {
  it("English: what was typed, each city with its airports, the dates with the year and their span, the cabins", async () => {
    const html = view(await draft("Tokyo to New York next month first"));
    const said = text(html);
    expect(said).toContain("You typed: Tokyo to New York next month first");
    expect(html).toContain('<q lang="en">Tokyo to New York next month first</q>');
    expect(said).toMatch(/From Tokyo · NRT, HND To New York · JFK, EWR, LGA Dates Oct 18 – Nov 16, 2026 · 30 days Cabins First/);
    expect(said).toContain("Read on this device. Nothing was sent.");
    expect(html).not.toContain("plan-notices");
    expect(said).not.toMatch(PAID);
    expect(html).not.toMatch(/<a\b/);
  });

  it("Chinese: the same plan in Chinese, the typed text marked as Chinese", async () => {
    const html = view(await draft("东京到纽约 下个月 头等舱"), "zh");
    const said = text(html);
    expect(said).toContain("你输入的：");
    expect(html).toContain('<q lang="zh-CN">东京到纽约 下个月 头等舱</q>');
    expect(said).toMatch(/出发 东京 · NRT、HND 到达 纽约 · JFK、EWR、LGA 日期 2026年10月18日–11月16日 · 30 天 舱位 头等舱/);
    expect(said).toContain("已在本机识别，未发送任何内容。");
    expect(said).not.toMatch(PAID);
  });

  it("an airport on its own is named on its own; a city of several airports only when all of them are asked for", async () => {
    const said = text(view(await draft("HKG, SHA to NRT, next 30 days, business and first")));
    expect(said).toMatch(/From Hong Kong · HKG Shanghai · PVG, SHA To Narita · NRT Dates/);
    expect(said).toContain("Cabins Business, First");
  });

  it("other conditions, and the parser's notices, in each language", async () => {
    const plan = await draft("NRT to LHR 2026-11-01 to 2027-03-01 nonstop on United under 80000 miles business");
    const en = text(view(plan));
    expect(en).toContain("Also Nonstop · Programs: United MileagePlus · Up to 80,000 miles");
    expect(en).toContain("Date range truncated to 92 days (2026-11-01 to 2027-01-31).");
    expect(en).toContain("Dates Nov 1, 2026 – Jan 31, 2027 · 92 days");
    const zh = text(view(plan, "zh"));
    expect(zh).toContain("其他条件 直飞 · 会员计划：United MileagePlus · 最多 80,000 里程");
    expect(zh).toContain("日期范围已缩短为 92 天（2026-11-01 至 2027-01-31）。");
    expect(zh).toContain("2026年11月1日–2027年1月31日 · 92 天");
  });

  it("dates that have passed are said: all of them, or some", async () => {
    const all = text(view(await draft("LAX to Tokyo 2026-09-01 to 2026-09-10")));
    expect(all).toContain("Start date 2026-09-01 is before today (2026-10-18).");
    expect(all).toContain("These dates have passed.");
    const some = text(view(await draft("LAX to Tokyo 2026-10-10 to 2026-10-30"), "zh"));
    expect(some).toContain("其中部分日期已经过去。");
  });
});

describe("the Search screen's planner", () => {
  it("is a text box of its own: its label, a button that shows a plan (not the search's Run, not the screen's primary)", async () => {
    const services = await liveServices();
    const html = at(services, createElement(PlanSearch, { services, locale: "en" }));
    expect(html).toContain('data-testid="planner"');
    expect(html).toContain('<h2 id="planner-title" class="ag-planner-title">Plan a trip</h2>');
    expect(text(html)).toContain("Type a trip to see how AwardGrid reads it: airports, dates and cabins. Nothing is sent, and no account is needed.");
    expect(html).toMatch(/<label for="q" class="ag-field-label">Describe a trip<\/label>/);
    expect(html).toContain('<button data-testid="plan-run" type="button" class="ag-button"><span class="ag-button-label">Show plan</span></button>');
    expect(html).not.toContain("text-search-run");
    expect(html).not.toContain("ag-button-primary");
    const zh = at(services, createElement(PlanSearch, { services, locale: "zh" }));
    expect(text(zh)).toContain("规划行程");
    expect(text(zh)).toContain("查看规划");
    expect(text(zh)).not.toMatch(PAID);
  });
});

describe("Saved › Trip plans", () => {
  async function withPlans(services: AppServices, ...texts: string[]) {
    let i = 0;
    for (const t of texts) await services.plans.save(planFromDraft(await draft(t), NOW.toISOString(), `plan-${i++}`));
    return services;
  }

  it("is not drawn while there are none", async () => {
    const services = await liveServices();
    expect(at(services, createElement(SavedPlans, { services, locale: "en", hasKey: false, busy: null, onRemove: () => {} }))).toBe("");
  });

  it("with no data source: each plan offers 'Try with sample data', named with its route and dates, and Delete", async () => {
    const services = await withPlans(await liveServices(), "HKG to SEA next 30 days business");
    const html = at(services, createElement(SavedPlans, { services, locale: "en", hasKey: false, busy: null, onRemove: () => {} }));
    const said = text(html);
    expect(html).toContain('<h2 id="saved-plans-title" tabindex="-1" class="ag-saved-section-title">Trip plans</h2>');
    expect(said).toContain("1 of 100 plans");
    expect(said).toContain("Try with sample data opens the sample data on this device and searches the plan there. Nothing is sent.");
    expect(html).toContain('aria-label="Try with sample data: HKG → SEA, Oct 18 – Nov 16, 2026"');
    expect(html).toContain('aria-label="Delete plan: HKG → SEA, Oct 18 – Nov 16, 2026"');
    expect(html).toContain('id="plan-title-plan-0"');
    expect(said).toMatch(/Saved Oct 18, \d\d:30/);
    expect(html).not.toContain(">Search<");
    expect(said).not.toMatch(PAID);
  });

  it("with the account connected: 'Search', and what it sends; a plan whose dates have all passed cannot run, and says why", async () => {
    const services = await withPlans(await liveServices(), "HKG to SEA next 30 days business", "LAX to Tokyo 2026-09-01 to 2026-09-10");
    const html = at(services, createElement(SavedPlans, { services, locale: "en", hasKey: true, busy: null, onRemove: () => {} }));
    const said = text(html);
    expect(said).toContain("Search sends requests to seats.aero through your seats.aero account, and they count toward today's calls.");
    expect(html).toContain('aria-label="Search: HKG → SEA, Oct 18 – Nov 16, 2026"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Search: LAX → NRT, HND, Sep 1 – 10, 2026"|<button[^>]*aria-label="Search: LAX → NRT, HND, Sep 1 – 10, 2026"[^>]*disabled=""/);
    expect(said).toContain("These dates have passed.");
    expect(html).not.toContain("Try with sample data:");
    // Newest first.
    expect(html.indexOf("LAX → NRT, HND")).toBeLessThan(html.indexOf("HKG → SEA"));
  });

  it("before the key store has answered, only Delete is offered", async () => {
    const services = await withPlans(await liveServices(), "HKG to SEA next 30 days business");
    const html = at(services, createElement(SavedPlans, { services, locale: "en", hasKey: null, busy: null, onRemove: () => {} }));
    expect(html).not.toContain("Try with sample data:");
    expect(html).not.toContain('aria-label="Search:');
    expect(html).toContain("Delete plan:");
  });

  it("in sample mode, 'Search' runs on the sample data, and says so", async () => {
    const services = await withPlans(await sampleServices(), "LAX to Tokyo next month");
    const said = text(at(services, createElement(SavedPlans, { services, locale: "en", hasKey: true, busy: null, onRemove: () => {} })));
    expect(said).toContain("It searches the sample data on this device. Nothing is sent.");
    expect(said).not.toContain("seats.aero");
  });

  it("in Chinese", async () => {
    const services = await withPlans(await liveServices("zh"), "香港到西雅图 未来30天 商务舱");
    const html = at(services, createElement(SavedPlans, { services, locale: "zh", hasKey: false, busy: null, onRemove: () => {} }));
    const said = text(html);
    expect(said).toContain("行程规划");
    expect(said).toContain("已保存 1/100 个规划");
    expect(html).toContain('aria-label="试用示例数据：HKG → SEA，2026年10月18日–11月16日"');
    expect(html).toContain('aria-label="删除规划：HKG → SEA，2026年10月18日–11月16日"');
    expect(said).not.toMatch(PAID);
  });

  it("the Saved tab: plans first; with plans and no saved results it does not say nothing is saved", async () => {
    const empty = await liveServices();
    expect(text(at(empty, createElement(FavoritesScreen)))).toContain("Nothing saved yet");
    const services = await withPlans(await liveServices(), "HKG to SEA next 30 days business");
    const html = at(services, createElement(FavoritesScreen));
    expect(html).toContain('data-testid="saved-plans"');
    expect(text(html)).not.toContain("Nothing saved yet");
  });
});
