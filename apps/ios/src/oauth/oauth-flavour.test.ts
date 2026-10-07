/**
 * The OAuth flavour (VITE_AG_CONNECT=oauth) as screens and routes, beside the key flavour, read the way a build reads
 * the flags (the environment stubbed, the modules imported afresh): the connect page is a "Connect seats.aero" button
 * with no paste field, Settings says "Connected" rather than characters of a key, the sentences that named the key
 * name the account and the 24-hour limit, and Saved says what opening an item past 24 hours does. In sample mode the
 * connect page is sample mode's own (the way back to the account), as in the key flavour.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Outlet, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_NOW, fixtureSnapshot } from "@awardgrid/core/test-fixtures/uiux/factory";
import { favoriteFromSnapshot } from "@awardgrid/core/workspace/favorites-store";
import type { FavoriteV1 } from "@awardgrid/core/workspace/types";
import type { AppServices } from "../app/bootstrap";
import { SettingsStore } from "../app/settings-store";
import { MemoryKeyStore } from "../native/keychain";
import { MemoryFileStore } from "../store/persistence";
import { PlansStore } from "../store/plans-store";
import { SlotFileStorage } from "../workspace/slot-storage";

async function load(connect: "key" | "oauth", store = true) {
  vi.resetModules();
  vi.stubEnv("VITE_AG_STORE", store ? "1" : "");
  vi.stubEnv("VITE_AG_CONNECT", connect);
  const [app, settings, connectScreen, copy, favorites, watches, search] = await Promise.all([
    import("../app/App"),
    import("../screens/SettingsScreen"),
    import("../screens/SeatsConnectScreen"),
    import("../screens/settings-copy"),
    import("../screens/FavoritesScreen"),
    import("../screens/watches-copy"),
    import("../search/search"),
  ]);
  return { app, settings, connectScreen, copy, favorites, watches, search };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

function at(path: string, element: ReturnType<typeof createElement>, services: AppServices, route = path.replace(/^\//, "")): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [path] },
      createElement(Routes, null, createElement(Route, { path: "/", element: createElement(Outlet, { context: services }) }, createElement(Route, { path: route, element }))),
    ),
  );
}

function services(over: Partial<AppServices> = {}): AppServices {
  return {
    keys: new MemoryKeyStore(),
    anthropicKeys: new MemoryKeyStore(),
    settings: new SettingsStore({ deviceLocale: "en" }),
    locale: "en",
    seatsAccount: { configured: true, connected: async () => false, connect: async () => ({ ok: true }), disconnect: async () => ({ ok: true }) },
    shortTermMs: 24 * 3600_000,
    now: () => new Date(FIXTURE_NOW),
    // Saved draws the trip plans too (release plan step 18): none here.
    plans: new PlansStore(new SlotFileStorage(new MemoryFileStore())),
    ...over,
  } as unknown as AppServices;
}

describe("the connect page", () => {
  it("OAuth: a Connect seats.aero button, what the connection means, and no paste field", async () => {
    const oauth = await load("oauth");
    const routes = oauth.app.appRoutes({} as AppServices);
    const seats = routes.find((r) => r.path === "/")!.children!.find((c) => c.path === "settings/seats")!;
    // The page loads on first open (its own chunk): the route holds the lazy page, not the key page.
    const child = (seats.element as { props: { children: { type: { $$typeof?: symbol } } } }).props.children;
    expect(child.type.$$typeof).toBe(Symbol.for("react.lazy"));
    const html = at("/settings/seats", createElement(oauth.connectScreen.SeatsConnectScreen), services());
    expect(html).toContain("Connect seats.aero");
    expect(html).toContain("24 hours");
    expect(html).toContain("never sees your seats.aero password");
    expect(html).not.toMatch(/type="password"|Paste|API key|Check and save/);
  });

  it("OAuth without a client ID: the button is off, and says why", async () => {
    const oauth = await load("oauth", false);
    const html = at("/settings/seats", createElement(oauth.connectScreen.SeatsConnectScreen), services({ seatsAccount: { configured: false, connected: async () => false, connect: async () => ({ ok: false, reason: "not_configured" }), disconnect: async () => ({ ok: true }) } }));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*Connect seats\.aero/);
    expect(html).toContain("made without a seats.aero client ID");
  });

  it("OAuth in sample mode: sample mode's own page, the way back to the account, with no Connect or Disconnect", async () => {
    const oauth = await load("oauth");
    const sample = services({ dataSource: { kind: "sample", coverage: null, enterSample: async () => {}, exitSample: async () => {} } });
    const html = at("/settings/seats", createElement(oauth.connectScreen.SeatsConnectScreen), sample);
    expect(html).toContain("Exit sample data to connect your account.");
    expect(html).toContain("Exit sample data");
    expect(html).not.toMatch(/Connect seats\.aero|Disconnect|type="password"|Paste/);
    // Settings' row says "Sample data", never "Connected" or "Not connected".
    const settings = at("/settings", createElement(oauth.settings.SettingsScreen), sample);
    expect(settings).toContain("Sample data");
    expect(settings).not.toMatch(/>Connected<|>Not connected</);
  });

  it("key: the paste field, as before; the OAuth page is not routed", async () => {
    const key = await load("key");
    const routes = key.app.appRoutes({} as AppServices);
    const seats = routes.find((r) => r.path === "/")!.children!.find((c) => c.path === "settings/seats")!;
    expect((seats.element as { type: unknown }).type).toBe(key.settings.SeatsKeyScreen);
    const html = at("/settings/seats", createElement(key.settings.SeatsKeyScreen), services({ seatsAccount: null, shortTermMs: null }));
    expect(html).toContain('type="password"');
    expect(html).not.toContain("Connect seats.aero");
  });
});

describe("the words that named the key", () => {
  it("OAuth: the account, the token service and the 24-hour limit, in both languages; key: as before", async () => {
    const oauth = (await load("oauth")).copy.SETTINGS;
    for (const locale of ["en", "zh"] as const) {
      for (const text of [oauth[locale].cacheNote, oauth[locale].cacheCleared, oauth[locale].aboutSent]) expect(text, text).not.toMatch(/API key|API 密钥|密钥/);
      expect(oauth[locale].aboutSent).toContain("awardgrid.dowhiz.com");
      expect(oauth[locale].aboutSent).toContain("24");
      // The cache note and its result also show in sample mode and before anything is connected: they say the
      // connection is untouched, never that an account is connected.
      for (const text of [oauth[locale].cacheNote, oauth[locale].cacheCleared]) expect(text, text).not.toMatch(/stays connected|still connected|保持连接/);
    }
    expect(oauth.en.cacheCleared).toBe("Cached results cleared. Your seats.aero connection is untouched.");
    expect(oauth.en.connected).toBe("Connected");
    const key = (await load("key")).copy.SETTINGS;
    expect(key.en.cacheNote).toContain("This does not touch your seats.aero key.");
    expect(key.en.aboutSent).toContain("seats.aero API key");
  });

  it("a refused connection is said as the connection, not a key: watches and the search engine's message", async () => {
    const oauth = await load("oauth");
    expect(oauth.watches.WATCHES.en.refused).toContain("did not accept the connection");
    expect(oauth.watches.WATCHES.zh.refusedNoBaseline).toContain("重新连接");
    const key = await load("key");
    expect(key.watches.WATCHES.en.refused).toContain("did not accept the API key");
  });
});

describe("Saved past 24 hours", () => {
  it("the card keeps the search and its summary, says the results were removed, and names what opening does", async () => {
    const oauth = await load("oauth");
    const snapshot = fixtureSnapshot();
    const removed: FavoriteV1 = { ...favoriteFromSnapshot(snapshot, FIXTURE_NOW, "f1"), rows: [], rowsRemoved: { at: FIXTURE_NOW, options: 3 } };
    const favorites = {
      subscribe: () => () => {},
      all: () => [removed],
      usage: () => ({ count: 1, maxItems: 100, bytes: 1000, maxBytes: 5 * 1024 * 1024 }),
      isReadOnly: () => false,
      unreadableCount: () => 0,
      forget: () => {},
    };
    const html = at("/saved", createElement(oauth.favorites.FavoritesScreen), services({ favorites } as unknown as Partial<AppServices>));
    expect(html).toContain("3 options when saved");
    expect(html).toContain("Results older than 24 hours are removed from this device");
    expect(html).toContain("Open and search again");
    expect(html).toContain("Results from seats.aero stay in a saved item for 24 hours");
    expect(html).not.toContain("Saved snapshot; availability may change");
  });
});
