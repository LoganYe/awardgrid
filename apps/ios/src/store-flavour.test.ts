/**
 * The App Store flavour (app/flags.ts STORE, `npm run build:store`, which also sets VITE_AG_CONNECT=oauth: the account
 * is connected only through seats.aero's own sign-in, with no paste field) and the no-connection variant
 * (VITE_AG_CONNECT=0), as screens and routes. Each case stubs the environment, resets the module registry and imports the app afresh, so
 * the flags are read as a build would read them; the default flavour is rendered the same way beside it, so a case
 * that passes only because nothing rendered cannot pass.
 *
 * What the bundle itself carries is scripts/check-store-bundle.mjs's job (src/store-bundle-check.test.ts); the wording
 * of the source the store build is made from is store-copy.test.ts's.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Outlet, Route, Routes, type RouteObject } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureSnapshot } from "@awardgrid/core/test-fixtures/uiux/factory";
import type { WorkspaceState } from "@awardgrid/core/workspace/types";
import type { AppServices } from "./app/bootstrap";
import { SettingsStore } from "./app/settings-store";
import { MemoryKeyStore } from "./native/keychain";
import { searchViewFromSnapshot } from "./workspace/snapshot-view";
import { DEFAULT_PREFERENCES } from "./workspace/workspace-store";

type Flavour = { store?: boolean; connect?: "key" | "oauth" | "0" };

/** What `npm run build:store` builds: the App Store flavour, OAuth (package.json; flags.test.ts holds the script to it). */
const STORE_BUILD: Flavour = { store: true, connect: "oauth" };

/** The app's modules as a build of this flavour sees them. */
async function load({ store = false, connect = "key" }: Flavour) {
  vi.resetModules();
  vi.stubEnv("VITE_AG_STORE", store ? "1" : "");
  vi.stubEnv("VITE_AG_CONNECT", connect);
  const [app, settings, search, onboarding, settingsCopy, askRunning, keyCopy, connectScreen] = await Promise.all([
    import("./app/App"),
    import("./screens/SettingsScreen"),
    import("./screens/SearchScreen"),
    import("./screens/OnboardingScreen"),
    import("./screens/settings-copy"),
    import("./app/ask-running"),
    import("./screens/seats-key-copy"),
    import("./screens/SeatsConnectScreen"),
  ]);
  return { app, settings, search, onboarding, settingsCopy, askRunning, keyCopy, connectScreen };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** Every path in a route table, nested ones joined to their parent's. */
function paths(routes: RouteObject[], parent = ""): string[] {
  return routes.flatMap((route) => {
    const own = route.path === undefined ? parent : route.path.startsWith("/") || parent === "" ? route.path : `${parent.replace(/\/$/, "")}/${route.path}`;
    return [...(route.path === undefined ? [] : [own]), ...paths(route.children ?? [], own)];
  });
}

function at(path: string, element: ReturnType<typeof createElement>, services: AppServices, route = path.replace(/^\//, "")): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [path] },
      createElement(Routes, null, createElement(Route, { path: "/", element: createElement(Outlet, { context: services }) }, createElement(Route, route ? { path: route, element } : { index: true, element }))),
    ),
  );
}

function settingsServices(locale: "en" | "zh" = "en"): AppServices {
  // The Anthropic item throws if read: the App Store build must never touch it (effects do not run here, so this guards
  // any read made while rendering).
  const anthropicKeys = {
    get: () => {
      throw new Error("the Anthropic Keychain item was read");
    },
    set: async () => {},
    clear: async () => {},
  };
  return { keys: new MemoryKeyStore(), anthropicKeys, clearCache: async () => {}, settings: new SettingsStore({ deviceLocale: locale }), locale } as unknown as AppServices;
}

function searchServices(locale: "en" | "zh" = "en"): AppServices {
  const snapshot = fixtureSnapshot();
  const state: WorkspaceState = {
    revision: 1,
    draft: null,
    run: { kind: "idle" },
    displayedSnapshot: snapshot,
    previousSnapshot: null,
    selected: [],
    preferences: DEFAULT_PREFERENCES,
  };
  return {
    workspace: { subscribe: () => () => {}, getState: () => state },
    lastSearch: { get: () => ({ text: snapshot.query.raw_text, value: searchViewFromSnapshot(snapshot) }), set: () => {} },
    ask: { subscribe: () => () => {}, isRunning: () => false },
    favorites: { subscribe: () => () => {}, all: () => [] },
    now: () => new Date("2026-10-18T08:30:00.000Z"),
    locale,
  } as unknown as AppServices;
}

const headings = (html: string) => [...html.matchAll(/<h2 class="ag-settings-label"[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1]);
const ASK_WORDS = /\bAsk\b|Anthropic|Claude|AI assistance|AI ?辅助|AI 对话|AI（可选）|AI \(optional\)/;
/** The paste-a-key connection, in either language: the App Store build connects only through seats.aero's sign-in. */
const KEY_WORDS = /API key|API tab|\bPaste\b|paste the|Check and save|Key on file|\bkey\b|API 密钥|API 页|粘贴|密钥/;

describe("the App Store flavour compiles Ask out", () => {
  it("has no Ask route and no Anthropic key page; any other address opens Search", async () => {
    const store = (await load(STORE_BUILD)).app.appRoutes({} as AppServices);
    const all = paths(store);
    expect(all).not.toContain("/ask");
    expect(all).not.toContain("/settings/anthropic");
    expect(all).toEqual(expect.arrayContaining(["/", "/settings", "/settings/seats", "/watches", "/saved", "*"]));
    expect(store.at(-1)?.path).toBe("*");
    // The default build keeps both, for development, the probes and the UI/UX e2e.
    const full = paths((await load({})).app.appRoutes({} as AppServices));
    expect(full).toEqual(expect.arrayContaining(["/ask", "/settings/anthropic", "/settings/seats", "*"]));
  });

  it("Settings: no AI group and no Anthropic row, and the sentences that named Ask say only what this build does", async () => {
    const store = await load(STORE_BUILD);
    for (const locale of ["en", "zh"] as const) {
      const html = at("/settings", createElement(store.settings.SettingsScreen), settingsServices(locale));
      expect(html).not.toMatch(ASK_WORDS);
      expect(html).not.toContain("settings-row-anthropic");
      expect(html).toContain("settings-row-seats");
    }
    expect(headings(at("/settings", createElement(store.settings.SettingsScreen), settingsServices()))).toEqual(["Data connection", "Appearance and language", "Local data", "About"]);
    const t = store.settingsCopy.SETTINGS;
    for (const locale of ["en", "zh"] as const) {
      for (const text of [t[locale].cacheNote, t[locale].cacheCleared, t[locale].aboutSent, t[locale].notAffiliated]) {
        expect(text, text).not.toMatch(ASK_WORDS);
        expect(text, text).not.toMatch(KEY_WORDS);
      }
    }
    expect(t.en.cacheNote).toContain("This does not touch your seats.aero connection.");
    expect(t.zh.cacheCleared).toBe("缓存结果已清除，seats.aero 连接未受影响。");
    // The key flavour's store build (internal test builds only) words the same sentences for its key, still without Ask.
    const keyStore = await load({ store: true, connect: "key" });
    expect(keyStore.settingsCopy.SETTINGS.en.cacheNote).toContain("This does not touch your seats.aero key.");
    expect(keyStore.keyCopy.SEATS_KEY.en.confirmBody).toEqual(["Search stops until you add a key again.", "Today's call count is kept."]);

    // The default flavour: the AI group is there, and the same sentences name Ask where it applies.
    const full = await load({});
    expect(headings(at("/settings", createElement(full.settings.SettingsScreen), { ...settingsServices(), anthropicKeys: new MemoryKeyStore() } as AppServices))).toEqual([
      "Data connection",
      "AI (optional)",
      "Appearance and language",
      "Local data",
      "About",
    ]);
    expect(full.keyCopy.SEATS_KEY.en.confirmBody).toContain("AI assistance keeps its own key.");
    expect(full.settingsCopy.SETTINGS.en.notAffiliated).toContain("Anthropic");
  });

  it("Search: no AI assistance in the header and no 'Ask Claude about this search', in either language", async () => {
    const store = await load(STORE_BUILD);
    for (const locale of ["en", "zh"] as const) {
      const html = at("/", createElement(store.search.SearchScreen), searchServices(locale), "");
      expect(html).toContain('data-testid="availability-card"');
      expect(html).not.toMatch(/href="\/ask"/);
      expect(html).not.toMatch(ASK_WORDS);
    }
    const full = await load({});
    const html = at("/", createElement(full.search.SearchScreen), searchServices(), "");
    expect(html).toMatch(/<a\b[^>]*href="\/ask"[^>]*>.*AI assistance/);
    expect(html).toContain("Ask Claude about this search");
  });

  it("never asks the Ask service whether a question is running", async () => {
    const { askRunning } = await load(STORE_BUILD);
    const services = {
      get ask(): never {
        throw new Error("the Ask service was read");
      },
    } as unknown as AppServices;
    const Probe = () => createElement("p", null, String(askRunning.useAskRunning(services)));
    expect(renderToStaticMarkup(createElement(Probe))).toBe("<p>false</p>");
  });
});

describe("the App Store build connects only through seats.aero's own sign-in (VITE_AG_CONNECT=oauth)", () => {
  it("routes the OAuth connect page, a Connect seats.aero button with no paste field, in both languages", async () => {
    const store = await load(STORE_BUILD);
    const seats = store.app.appRoutes({} as AppServices).find((r) => r.path === "/")!.children!.find((c) => c.path === "settings/seats")!;
    expect((seats.element as { type: unknown }).type).toBe(store.connectScreen.SeatsConnectScreen);
    const account = { configured: true, connected: async () => false, connect: async () => ({ ok: true }), disconnect: async () => ({ ok: true }) };
    for (const [locale, button] of [
      ["en", "Connect seats.aero"],
      ["zh", "连接 seats.aero"],
    ] as const) {
      const html = at("/settings/seats", createElement(store.connectScreen.SeatsConnectScreen), { ...settingsServices(locale), seatsAccount: account } as unknown as AppServices);
      expect(html).toMatch(new RegExp(`<button[^>]*>[\\s\\S]*${button.replace(".", "\\.")}`));
      expect(html).not.toContain('type="password"');
      expect(html.replace(/<[^>]+>/g, " ")).not.toMatch(KEY_WORDS);
      expect(html).not.toMatch(ASK_WORDS);
    }
  });

  it("Settings' account row says Connected or Not connected, never characters of a key", async () => {
    const store = await load(STORE_BUILD);
    const html = at("/settings", createElement(store.settings.SettingsScreen), settingsServices());
    expect(html).toContain("settings-row-seats");
    expect(html).not.toMatch(/Key on file|已保存密钥/);
  });

  it("the key flavour (the default build, for development, the probes and e2e) keeps the paste field", async () => {
    const full = await load({});
    const seats = full.app.appRoutes({} as AppServices).find((r) => r.path === "/")!.children!.find((c) => c.path === "settings/seats")!;
    expect((seats.element as { type: unknown }).type).not.toBe(full.connectScreen.SeatsConnectScreen);
    expect(full.keyCopy.SEATS_KEY.en.placeholder).toBe("Paste your seats.aero API key");
  });
});

describe("VITE_AG_CONNECT=0 (no connection; prepared, not shipped)", () => {
  it("removes the seats.aero page and every way to it", async () => {
    const none = await load({ store: true, connect: "0" });
    expect(paths(none.app.appRoutes({} as AppServices))).not.toContain("/settings/seats");
    const settings = at("/settings", createElement(none.settings.SettingsScreen), settingsServices());
    expect(headings(settings)).toEqual(["Appearance and language", "Local data", "About"]);
    expect(settings).not.toContain("/settings/seats");
    const welcome = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(none.onboarding.Welcome, { locale: "en", onTrySample: () => {} })));
    expect(welcome).not.toContain("/settings/seats");
    // Sample data is still offered, first (release plan step 17).
    expect(welcome).toContain("Try with sample data");
    // With a connection (the App Store build's, seats.aero's own sign-in), the same three places link to it, after
    // the sample data.
    const key = await load(STORE_BUILD);
    expect(paths(key.app.appRoutes({} as AppServices))).toContain("/settings/seats");
    const keyed = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(key.onboarding.Welcome, { locale: "en", onTrySample: () => {} })));
    expect(keyed).toContain('href="/settings/seats"');
    expect(keyed.indexOf("Try with sample data")).toBeLessThan(keyed.indexOf('href="/settings/seats"'));
  });
});

describe("Settings › About over sample data (PR-D), in both flavours", () => {
  const sampleMode = (locale: "en" | "zh") => ({ ...settingsServices(locale), dataSource: { kind: "sample", coverage: null } }) as unknown as AppServices;
  /** The About group's sentences: the block before its links. */
  const about = (html: string) => {
    const group = html.slice(html.lastIndexOf('<section class="ag-settings-group"'));
    return [...group.matchAll(/<p class="ag-settings-copy[^"]*">([^<]*)<\/p>/g)].map((m) => m[1]);
  };
  const SAMPLE_EN = "Sample data is made on this device, and nothing is sent. Connecting a seats.aero account is optional.";
  const SAMPLE_ZH = "示例数据在本机生成，不会发送任何内容。连接 seats.aero 账户是可选的。";

  it("says the sample data is made on this device, nothing is sent and an account is optional; no 'Data: seats.aero'", async () => {
    for (const flavour of [STORE_BUILD, {}] as const) {
      const { settings } = await load(flavour);
      const en = about(at("/settings", createElement(settings.SettingsScreen), sampleMode("en")));
      expect(en, JSON.stringify(flavour)).toEqual([SAMPLE_EN, "Sample data · on this device", expect.stringContaining("not affiliated")]);
      const zh = about(at("/settings", createElement(settings.SettingsScreen), sampleMode("zh")));
      expect(zh, JSON.stringify(flavour)).toEqual([SAMPLE_ZH, "示例数据 · 仅在本机", expect.stringContaining("无关联")]);
      for (const line of [...en, ...zh]) expect(line).not.toMatch(/API key|API 密钥|Data: seats\.aero|数据：seats\.aero|Searches go to seats\.aero|发往 seats\.aero/);
    }
  });

  it("with an account, About keeps the account's sentences, in each flavour's wording", async () => {
    const store = await load(STORE_BUILD);
    expect(about(at("/settings", createElement(store.settings.SettingsScreen), settingsServices("en"))).slice(0, 2)).toEqual([
      "Searches go from this device to seats.aero through your connected seats.aero account. A small token service at awardgrid.dowhiz.com renews the connection and stores nothing. Results from seats.aero are kept on this device for 24 hours at most.",
      "Data: seats.aero",
    ]);
    expect(about(at("/settings", createElement(store.settings.SettingsScreen), settingsServices("zh"))).slice(0, 2)).toEqual([
      "查票请求通过你已连接的 seats.aero 账户从本机发往 seats.aero。awardgrid.dowhiz.com 上的一个小型令牌服务只负责续期连接，不保存任何内容。来自 seats.aero 的结果在本机最多保留 24 小时。",
      "数据：seats.aero",
    ]);
    // The key flavour's store build (internal test builds only): the key's own sentence.
    const keyStore = await load({ store: true, connect: "key" });
    expect(about(at("/settings", createElement(keyStore.settings.SettingsScreen), settingsServices("en")))[0]).toBe(
      "Searches go to seats.aero with your seats.aero API key. Keeping the key on this device does not keep searches off the network.",
    );
    const full = await load({});
    const fullAbout = about(at("/settings", createElement(full.settings.SettingsScreen), { ...settingsServices("en"), anthropicKeys: new MemoryKeyStore() } as AppServices));
    expect(fullAbout[0]).toMatch(/^Searches go to seats\.aero with your seats\.aero API key\. When you use AI assistance/);
    expect(fullAbout[1]).toBe("Data: seats.aero");
  });

  it("a build with no way to connect does not offer an account", async () => {
    const none = await load({ store: true, connect: "0" });
    const lines = about(at("/settings", createElement(none.settings.SettingsScreen), sampleMode("en")));
    expect(lines[0]).toBe("Sample data is made on this device, and nothing is sent.");
    expect(about(at("/settings", createElement(none.settings.SettingsScreen), sampleMode("zh")))[0]).toBe("示例数据在本机生成，不会发送任何内容。");
  });
});
