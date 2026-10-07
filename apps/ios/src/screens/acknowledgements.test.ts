/**
 * Settings › About (release D7, handoff §3.5): the privacy policy and support pages, the non-affiliation sentence,
 * and the licenses of what ships. The list itself is checked against the bundle by `pnpm build`
 * (scripts/acknowledgements.mjs --check); here, that it holds what the handoff found shipping, each with its license's
 * own words, and that the pages render it in both languages.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Outlet, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import type { AppServices } from "../app/bootstrap";
import { PRIVACY_POLICY_URL, SITE_URL, SUPPORT_URL } from "../app/links";
import { SettingsStore } from "../app/settings-store";
import { MemoryKeyStore } from "../native/keychain";
import { ACKNOWLEDGEMENTS, AcknowledgementsScreen } from "./AcknowledgementsScreen";
import { SettingsScreen } from "./SettingsScreen";
import { SETTINGS } from "./settings-copy";

const SITE = path.join(import.meta.dirname, "..", "..", "..", "..", "sites", "landing");
const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

function render(element: ReturnType<typeof createElement>, at: string, locale: "en" | "zh" = "en"): string {
  const shell = { keys: new MemoryKeyStore(), anthropicKeys: new MemoryKeyStore(), clearCache: async () => {}, settings: new SettingsStore({ deviceLocale: locale }), locale } as unknown as AppServices;
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [at] },
      createElement(Routes, null, createElement(Route, { path: "/", element: createElement(Outlet, { context: shell }) }, createElement(Route, { path: at.slice(1), element }))),
    ),
  );
}

describe("the site's pages", () => {
  it("are the static site's privacy and support pages, over https, on the site's own host", () => {
    expect(SITE_URL).toBe("https://awardgrid.dowhiz.com/");
    expect(PRIVACY_POLICY_URL).toBe("https://awardgrid.dowhiz.com/privacy/");
    expect(SUPPORT_URL).toBe("https://awardgrid.dowhiz.com/support/");
    expect(existsSync(path.join(SITE, "privacy", "index.html"))).toBe(true);
    expect(existsSync(path.join(SITE, "support", "index.html"))).toBe(true);
  });
});

describe("Settings › About", () => {
  it("says what is not affiliated, and opens the privacy policy and support in Safari, with the licenses in the app", () => {
    const html = render(createElement(SettingsScreen), "/settings");
    const en = SETTINGS.en;
    expect(html).toContain(escape(en.notAffiliated));
    expect(html).toMatch(new RegExp(`<a id="settings-row-privacy" class="ag-settings-row" href="${PRIVACY_POLICY_URL}" target="_blank" rel="noreferrer noopener">`));
    expect(html).toMatch(new RegExp(`<a id="settings-row-support" class="ag-settings-row" href="${SUPPORT_URL}" target="_blank" rel="noreferrer noopener">`));
    expect(html).toContain(`<span class="sr-only">${en.opensInSafari}</span>`);
    expect(html).toMatch(/<a id="settings-row-acknowledgements" class="ag-settings-row"[^>]* href="\/settings\/acknowledgements"/);
  });

  it("in Chinese too", () => {
    const html = render(createElement(SettingsScreen), "/settings", "zh");
    expect(html).toContain(SETTINGS.zh.notAffiliated);
    expect(html).toContain(SETTINGS.zh.privacy);
    expect(html).toContain(SETTINGS.zh.acknowledgements.title);
  });
});

describe("Acknowledgements", () => {
  /** What the handoff found in the release build's source maps (§3.5), the pods, the font, and Cordova's code. */
  const EXPECTED = [
    "@anthropic-ai/sdk",
    "@aparajita/capacitor-secure-storage",
    "@capacitor/core",
    "@capacitor/filesystem",
    "@capacitor/synapse",
    "@noble/hashes",
    "@stablelib/base64",
    "Apache Cordova (in CapacitorCordova)",
    "Capacitor and CapacitorCordova (iOS)",
    "IONFilesystemLib",
    "Inter",
    "KeychainSwift",
    "fast-sha256",
    "react",
    "react-dom",
    "react-router",
    "scheduler",
    "standardwebhooks",
    "zod",
  ];
  /** The words each license's own text carries. */
  const WORDS: Record<string, RegExp> = {
    MIT: /Permission is hereby granted, free of charge/,
    ISC: /Permission to use, copy, modify, and\/or distribute this software/,
    Unlicense: /This is free and unencumbered software released into the public domain/,
    "Apache-2.0": /Apache License\s+Version 2\.0, January 2004/,
    "OFL-1.1": /SIL OPEN FONT LICENSE Version 1\.1/,
  };

  it("lists what ships, each with a version and every license it names in that license's own words", () => {
    expect(ACKNOWLEDGEMENTS.map((e) => e.name).sort()).toEqual([...EXPECTED].sort());
    for (const entry of ACKNOWLEDGEMENTS) {
      expect(entry.version, entry.name).toMatch(/^\d/);
      // "ISC (package.json), MIT (LICENSE.md)" names two, and carries both texts.
      for (const license of entry.license.split(", ").map((part) => part.replace(/ \(.*\)$/, ""))) {
        expect(WORDS[license], `${entry.name}: ${license}`).toBeDefined();
        expect(entry.notice, `${entry.name}: ${license}`).toMatch(WORDS[license]!);
      }
    }
    expect(ACKNOWLEDGEMENTS.find((e) => e.name === "@capacitor/synapse")?.license).toBe("ISC (package.json), MIT (LICENSE.md)");
    // The one package that ships no license file says where its text came from.
    expect(ACKNOWLEDGEMENTS.filter((e) => e.noticeFrom).map((e) => [e.name, e.noticeFrom])).toEqual([["standardwebhooks", "package.json"]]);
  });

  it("renders every entry with its license, the texts marked as English on a Chinese page", () => {
    const en = render(createElement(AcknowledgementsScreen), "/settings/acknowledgements");
    expect(en).toContain(`>${SETTINGS.en.acknowledgements.title}</h1>`);
    for (const entry of ACKNOWLEDGEMENTS) expect(en).toContain(`<span class="ag-ack-name" lang="en">${escape(entry.name)}</span>`);
    // React's own entry, at whatever version the list holds (dependency bumps regenerate it).
    const react = ACKNOWLEDGEMENTS.find((e) => e.name === "react")!;
    expect(en).toContain(escape(SETTINGS.en.acknowledgements.meta(react.version, "MIT")));
    const zh = render(createElement(AcknowledgementsScreen), "/settings/acknowledgements", "zh");
    expect(zh).toContain(`>${SETTINGS.zh.acknowledgements.title}</h1>`);
    expect(zh).toContain('<pre class="ag-ack-text" lang="en">');
  });
});
