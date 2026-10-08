/**
 * Sample mode on the screens (release plan step 17), rendered from real sample-mode services (booted over a memory
 * file store, searched through the sample transport) with react-dom/server: the banner with the approved sentence and
 * "Exit sample data"; "Sample data" where a source time would be; "Sample data · on this device" where "Data:
 * seats.aero" would be; no call counts and no quota line; no booking or program links; the coverage note and the
 * one-tap search; Settings' seats.aero row and page. The same screens in live mode show none of it.
 */
import { parseQuery } from "@awardgrid/core/query/parse";
import { QueryObject } from "@awardgrid/core/query/schema";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Outlet, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { type AppServices, bootstrap } from "../app/bootstrap";
import { SampleDataContext, isSample, resolveBoot } from "../app/data-source";
import { MemoryKeyStore } from "../native/keychain";
import { MemoryFileStore, SnapshotStore } from "../store/persistence";
import { AskScreen } from "../screens/AskScreen";
import { CompareScreen } from "../screens/CompareScreen";
import { DetailScreen } from "../screens/DetailScreen";
import { SAMPLE_STARTER_TEXT, SearchScreen, sampleStarterQuery } from "../screens/SearchScreen";
import { SeatsKeyScreen } from "../screens/SeatsKeyScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { WatchesScreen } from "../screens/WatchesScreen";
import { enterSampleData } from "./boot";
import { addDays } from "./shared";

const NOW = new Date("2026-10-18T08:30:00Z");
const TODAY = "2026-10-18";

async function sampleServices(locale: "en" | "zh" = "en"): Promise<AppServices> {
  const files = new MemoryFileStore();
  await enterSampleData(files);
  const options = await resolveBoot({ snapshots: new SnapshotStore(files), now: () => NOW, locale, fetchImpl: async () => new Response("{}"), anthropicFetch: async () => new Response("{}") }, { beforeSwitch: async () => {}, reboot: () => {} });
  return bootstrap(options);
}

/** Live services that answer with nothing: enough to render the same screens without sample mode. */
async function liveServices(): Promise<AppServices> {
  const keys = new MemoryKeyStore();
  await keys.set("live-test-key");
  return bootstrap({ keys, anthropicKeys: new MemoryKeyStore(), snapshots: new SnapshotStore(new MemoryFileStore()), now: () => NOW, fetchImpl: async () => new Response("{}"), anthropicFetch: async () => new Response("{}"), locale: "en" });
}

/** A screen at `path`, under the outlet the chrome gives it, with the sample flag App provides. */
function at(services: AppServices, path: string, route: string, element: ReactElement): string {
  return renderToStaticMarkup(
    createElement(
      SampleDataContext.Provider,
      { value: isSample(services) },
      createElement(
        MemoryRouter,
        { initialEntries: [path] },
        createElement(Routes, null, createElement(Route, { path: "/", element: createElement(Outlet, { context: services }) }, createElement(Route, route ? { path: route, element } : { index: true, element }))),
      ),
    ),
  );
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("sample mode's Search screen", () => {
  it("carries the banner, says 'Sample data' on every row, and names neither seats.aero's data nor its calls", async () => {
    const services = await sampleServices();
    const found = await services.searchText("Hong Kong to Seattle next month, business");
    expect(found.ok).toBe(true);
    const html = at(services, "/", "", createElement(SearchScreen));
    const words = text(html);
    expect(html).toContain('data-testid="sample-banner"');
    expect(words).toContain("Sample data");
    expect(words).toContain("Illustrative data — not live availability");
    expect(words).toContain("Exit sample data");
    expect(words).toContain("Sample data · on this device");
    const cards = html.match(/data-testid="availability-card"/g)?.length ?? 0;
    expect(cards).toBeGreaterThan(5);
    expect(html.match(/<p class="ag-result-time">Sample data<\/p>/g)).toHaveLength(cards);
    expect(words).not.toMatch(/Source updated|Source update time|min ago|Data: seats\.aero|seats\.aero calls?|calls today/);
    expect(html).not.toContain("ag-attribution-link");
  });

  it("in Chinese too: no 来源 anywhere", async () => {
    const services = await sampleServices("zh");
    await services.searchText("香港到西雅图 未来一个月 商务舱");
    const words = text(at(services, "/", "", createElement(SearchScreen)));
    expect(words).toContain("示例数据 · 仅在本机");
    expect(words).toContain("退出示例数据");
    expect(words).not.toMatch(/来源|数据：seats\.aero|分钟前|调用/);
  });

  it("a search past what sample data covers says what it covers, and offers one tap to a search with rows", async () => {
    const services = await sampleServices();
    const query = QueryObject.parse({ origins: ["LIS"], destinations: ["SEA"], date_from: TODAY, date_to: addDays(TODAY, 29), cabins: ["J"], raw_text: "LIS to SEA", language: "en" });
    await services.runParsed("LIS to SEA", { query, warnings: [], notices: [] });
    const words = text(at(services, "/", "", createElement(SearchScreen)));
    expect(words).toContain("Sample data covers the 84 airports AwardGrid recognises, for the next 12 months.");
    expect(words).toContain("Try Hong Kong to Seattle, next 30 days, business");
    // Days past the window say the same.
    const late = QueryObject.parse({ origins: ["HKG"], destinations: ["SEA"], date_from: "2027-12-01", date_to: "2027-12-10", cabins: ["J"], raw_text: "late", language: "en" });
    await services.runParsed("late", { query: late, warnings: [], notices: [] });
    expect(text(at(services, "/", "", createElement(SearchScreen)))).toContain("Sample data covers the 84 airports");
  });

  it("the one tap's search has rows, and its words read back as the same search (so Search again rolls)", async () => {
    const parsed = await parseQuery(SAMPLE_STARTER_TEXT, { today: TODAY });
    const { raw_text: _a, language: _b, ...read } = parsed.query;
    const { raw_text: _c, language: _d, ...starter } = sampleStarterQuery(TODAY);
    expect(read).toEqual(starter);
    expect(starter).toMatchObject({ origins: ["HKG"], destinations: ["SEA"], date_from: TODAY, date_to: addDays(TODAY, 29), cabins: ["J"] });
    const services = await sampleServices();
    const found = await services.runParsed(SAMPLE_STARTER_TEXT, { query: sampleStarterQuery(TODAY), warnings: [], notices: [] });
    expect(found.ok && found.value.rows!.length).toBeGreaterThan(5);
  });

  it("the empty sample screen offers the one tap too; live mode shows none of sample mode", async () => {
    const sample = text(at(await sampleServices(), "/", "", createElement(SearchScreen)));
    expect(sample).toContain("Try Hong Kong to Seattle, next 30 days, business");
    expect(sample).toContain("Exit sample data");
    const live = await liveServices();
    const html = at(live, "/", "", createElement(SearchScreen));
    expect(html).not.toContain("sample-banner");
    expect(text(html)).not.toContain("Try Hong Kong to Seattle");
  });
});

describe("sample mode's details and comparison", () => {
  it("an option's details: the banner, 'Sample data' for the time, no program link, and says why", async () => {
    const services = await sampleServices();
    await services.searchText("LAX to Tokyo next month");
    const shown = services.workspace.getState().displayedSnapshot!;
    const row = shown.rows[0]!;
    const html = at(services, `/detail/${shown.id}/${encodeURIComponent(row.key)}`, "detail/:snapshotId/:rowKey", createElement(DetailScreen));
    const words = text(html);
    expect(html).toContain('data-testid="sample-banner"');
    expect(words).toContain("Sample options have no booking links.");
    expect(words).toContain("Sample data · on this device");
    expect(words).not.toMatch(/Program website|Check availability and fees on the program website|Source updated|Data: seats\.aero/);
    expect(html).not.toMatch(/<a [^>]*href="https?:/);
    expect(words).toContain("View flight itineraries");
  });

  it("an option's details with its itineraries drawn: no 'Loaded on this device' age, nor any other", async () => {
    const services = await sampleServices();
    await services.searchText("LAX to Tokyo next month");
    const shown = services.workspace.getState().displayedSnapshot!;
    const row = shown.rows[0]!;
    expect((await services.details.load({ snapshotId: shown.id, rowKey: row.key })).kind).toBe("loaded");
    const html = at(services, `/detail/${shown.id}/${encodeURIComponent(row.key)}`, "detail/:snapshotId/:rowKey", createElement(DetailScreen));
    const words = text(html);
    expect(html).toContain('data-testid="trip-card"');
    expect(words).toContain("Sample data · on this device");
    expect(words).not.toMatch(/Loaded on this device|just now|min ago|Source updated/);
  });

  it("the comparison: the banner, a 'Data' field saying 'Sample data', and no program links", async () => {
    const services = await sampleServices();
    await services.searchText("Hong Kong to Seattle next month, business");
    const shown = services.workspace.getState().displayedSnapshot!;
    for (const row of shown.rows.slice(0, 2)) services.workspace.setSelected({ snapshotId: shown.id, rowKey: row.key }, true);
    const html = at(services, "/compare", "compare", createElement(CompareScreen));
    const words = text(html);
    expect(html).toContain('data-testid="sample-banner"');
    expect(words).toContain("Sample options have no booking links.");
    expect(words).toContain(" Data Sample data Sample data ");
    // The program-website field is there, and says each option has no link.
    expect(words).toContain("Program website Sample options have no booking links. Sample options have no booking links.");
    expect(words).not.toMatch(/Source time|Source updated|Data: seats\.aero/);
    expect(html).not.toMatch(/<a [^>]*href="https?:/);
  });
});

describe("sample mode's Settings and Watches", () => {
  it("the seats.aero row says 'Sample data', and its page says to exit sample data to connect, with the way to", async () => {
    const services = await sampleServices();
    const settings = text(at(services, "/settings", "settings", createElement(SettingsScreen)));
    expect(settings).toMatch(/seats\.aero account\s+Sample data/);
    expect(settings).not.toContain("Key on file");
    const page = at(services, "/settings/seats", "settings/seats", createElement(SeatsKeyScreen));
    expect(text(page)).toContain("Exit sample data to connect your account.");
    expect(text(page)).toContain("Exit sample data");
    expect(page).not.toContain('type="password"');
  });

  it("About says what is true over sample data (PR-D): made on this device, nothing sent, an account optional", async () => {
    // The About group: from its heading to the end of the screen.
    const about = (words: string, heading: string) => words.slice(words.lastIndexOf(` ${heading} `));
    const settings = about(text(at(await sampleServices(), "/settings", "settings", createElement(SettingsScreen))), "About");
    expect(settings).toContain("Sample data is made on this device, and nothing is sent. Connecting a seats.aero account is optional.");
    expect(settings).toContain("Sample data · on this device");
    expect(settings).not.toMatch(/Searches go to seats\.aero|seats\.aero API key|Data: seats\.aero/);
    const zh = about(text(at(await sampleServices("zh"), "/settings", "settings", createElement(SettingsScreen))), "关于");
    expect(zh).toContain("示例数据在本机生成，不会发送任何内容。连接 seats.aero 账户是可选的。");
    expect(zh).toContain("示例数据 · 仅在本机");
    expect(zh).not.toMatch(/API 密钥|数据：seats\.aero/);
    // With an account, the account's sentences.
    const live = about(text(at(await liveServices(), "/settings", "settings", createElement(SettingsScreen))), "About");
    expect(live).toContain("Searches go to seats.aero with your seats.aero API key.");
    expect(live).toContain("Data: seats.aero");
    expect(live).not.toContain("Sample data is made on this device");
  });

  it("Watches gives the rule about checks close together without naming seats.aero's cache", async () => {
    const services = await sampleServices();
    const words = text(at(services, "/watches", "watches", createElement(WatchesScreen)));
    expect(words).toContain("A check sooner than 45 minutes after the previous one is skipped.");
    expect(words).not.toContain("seats.aero's cached data");
  });
});

describe("Ask in sample mode (internal builds; the App Store build has none)", () => {
  it("stays off under the banner: no question can be typed, and the screen says why", async () => {
    const services = await sampleServices();
    const html = at(services, "/ask", "ask", createElement(AskScreen));
    expect(html).toContain('data-testid="sample-banner"');
    expect(html).toContain('data-testid="ask-sample-off"');
    expect(text(html)).toContain("Ask is off while the app shows sample data. Exit sample data to use it with your own accounts.");
    expect(html).toMatch(/<textarea[^>]*disabled=""/);
    // It does not send the person to add an Anthropic key in sample mode.
    expect(text(html)).not.toContain("Add an Anthropic key");
  });
});
