/**
 * Settings' Anthropic key (design §7): the section's copy and controls, and what Save, Check key and Remove key do.
 *
 * The actions are plain functions over a fake Keychain item and a fake AskService, so their order and their words are
 * asserted without a DOM. The markup goes through react-dom/server; effects do not run there, so the section renders as
 * it does before the Keychain answers. No network, no Keychain, no clock.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Outlet, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { AppServices } from "../app/bootstrap";
import type { AskService, KeyCheckResult } from "../ask/ask-service";
import * as labels from "../ask/labels";
import { SettingsStore } from "../app/settings-store";
import { type KeyStore, MemoryKeyStore } from "../native/keychain";
import { CONSENT } from "../ask/consent-copy";
import { AnthropicKeySection, AskPermission, anthropicKeyLine, checkStatus, readMasked, removeAnthropicKey, saveAnthropicKey } from "./AnthropicKeyScreen";
import { SettingsScreen } from "./SettingsScreen";

const PASTED = "sk-ant-api03-settings-test-key-wxyz";

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

function fakeAsk(checkKey: () => Promise<KeyCheckResult>): Pick<AskService, "checkKey"> & AskService {
  const unused = () => Promise.reject(new Error("not used by Settings"));
  return {
    state: () => {
      throw new Error("not used by Settings");
    },
    subscribe: () => () => {},
    isRunning: () => false,
    ask: unused,
    stop: () => {},
    retry: unused,
    askAgain: unused,
    newConversation: unused,
    checkKey: vi.fn(checkKey),
    restore: unused,
    persist: async () => {},
  };
}

const ACCEPTED: KeyCheckResult = { outcome: "accepted", ok: true, message: labels.KEY_ACCEPTED, requestId: null };
const REJECTED: KeyCheckResult = { outcome: "rejected", ok: false, message: labels.KEY_REJECTED, requestId: "req_check_401" };

describe("Save", () => {
  it("stores the key, says so, and only then asks the service to check the key on file", async () => {
    const order: string[] = [];
    const store = new MemoryKeyStore();
    const anthropicKeys: KeyStore = {
      get: () => store.get(),
      set: async (value) => {
        order.push("set");
        await store.set(value);
      },
      clear: () => store.clear(),
    };
    const ask = fakeAsk(async () => {
      order.push(`check with ${await store.get()}`);
      return REJECTED;
    });
    const status = await saveAnthropicKey({ anthropicKeys, ask }, `  ${PASTED} `, () => {
      order.push("saved");
    });
    expect(order).toEqual(["set", "saved", `check with ${PASTED}`]);
    // No draft is handed to the check: it reads what the Keychain now holds.
    expect(ask.checkKey).toHaveBeenCalledWith();
    expect(status).toEqual({ text: labels.KEY_REJECTED, ok: false, requestIdLine: "Anthropic request ID: req_check_401", lang: "en" });
  });

  it("a Keychain that refuses the key is a failure, masked of the pasted key, and nothing is checked", async () => {
    const anthropicKeys: KeyStore = {
      get: async () => null,
      set: async (value) => Promise.reject(new Error(`OSStatus -34018 storing ${value}`)),
      clear: async () => {},
    };
    const ask = fakeAsk(async () => ACCEPTED);
    const onSaved = vi.fn();
    const status = await saveAnthropicKey({ anthropicKeys, ask }, PASTED, onSaved);
    expect(status).toEqual({ text: "Could not save the key: OSStatus -34018 storing ••••", ok: false, requestIdLine: null, tail: "OSStatus -34018 storing ••••" });
    expect(JSON.stringify(status)).not.toContain(PASTED);
    expect(onSaved).not.toHaveBeenCalled();
    expect(ask.checkKey).not.toHaveBeenCalled();
  });
});

describe("Check key and its result", () => {
  it("shows a check's sentence in its tone, with Anthropic's request ID when there was one", () => {
    expect(checkStatus(ACCEPTED)).toEqual({ text: labels.KEY_ACCEPTED, ok: true, requestIdLine: null, lang: "en" });
    expect(checkStatus(REJECTED)).toEqual({ text: labels.KEY_REJECTED, ok: false, requestIdLine: "Anthropic request ID: req_check_401", lang: "en" });
    expect(checkStatus({ outcome: "keychain", ok: false, message: labels.keyReadFailedLabel("OSStatus -25308"), requestId: null }).ok).toBe(false);
  });
});

describe("Remove key", () => {
  it("reports the removal once the Keychain no longer returns the key", async () => {
    const anthropicKeys = new MemoryKeyStore();
    await anthropicKeys.set(PASTED);
    expect(await removeAnthropicKey({ anthropicKeys })).toEqual({ text: labels.KEY_REMOVED, ok: true, requestIdLine: null });
    expect(await anthropicKeys.get()).toBeNull();
  });

  it("never reports a removal that did not happen", async () => {
    const stuck: KeyStore = { get: async () => PASTED, set: async () => {}, clear: async () => {} };
    expect(await removeAnthropicKey({ anthropicKeys: stuck })).toEqual({ text: labels.KEY_NOT_REMOVED, ok: false, requestIdLine: null });
  });

  it("a Keychain that cannot be read afterwards is a failure, masked of the key", async () => {
    let reads = 0;
    const unreadable: KeyStore = {
      get: async () => {
        reads += 1;
        if (reads === 1) return PASTED;
        throw new Error(`errSecInteractionNotAllowed reading ${PASTED}`);
      },
      set: async () => {},
      clear: async () => {},
    };
    expect(await removeAnthropicKey({ anthropicKeys: unreadable })).toEqual({
      text: "Could not read the key from the Keychain: errSecInteractionNotAllowed reading ••••",
      ok: false,
      requestIdLine: null,
      tail: "errSecInteractionNotAllowed reading ••••",
    });
  });
});

describe("what is on file", () => {
  it("shows the last four characters only, and says nothing before the Keychain has been read", async () => {
    const store = new MemoryKeyStore();
    expect(await readMasked(store)).toBeNull();
    await store.set(PASTED);
    expect(await readMasked(store)).toBe("••••wxyz");
    expect(await readMasked({ get: async () => Promise.reject(new Error("locked")), set: async () => {}, clear: async () => {} })).toBeNull();

    expect(anthropicKeyLine(undefined)).toBeNull();
    expect(anthropicKeyLine(null)).toBe("No Anthropic key on file.");
    expect(anthropicKeyLine("••••wxyz")).toBe("On file: ••••wxyz");
  });
});

describe("languages on the Anthropic key page (T11)", () => {
  it("in Chinese, its own result sentences carry no English marking; the Keychain's words at their end do", async () => {
    const { WithTail } = await import("../app/WithTail");
    const removed = await removeAnthropicKey({ anthropicKeys: new MemoryKeyStore() }, "zh");
    expect(removed).toEqual({ text: "已从本机钥匙串移除 Anthropic 密钥。", ok: true, requestIdLine: null });
    expect(removed.lang).toBeUndefined();
    const failing: KeyStore = { get: async () => null, set: async () => Promise.reject(new Error("OSStatus -34018")), clear: async () => {} };
    const failed = await saveAnthropicKey({ anthropicKeys: failing, ask: fakeAsk(async () => ACCEPTED) }, PASTED, () => {}, "zh");
    expect(failed).toMatchObject({ text: "无法保存密钥：OSStatus -34018", tail: "OSStatus -34018" });
    expect(renderToStaticMarkup(createElement(WithTail, { text: failed.text, tail: failed.tail, tailLang: "en" }))).toBe('无法保存密钥：<span lang="en">OSStatus -34018</span>');
    // The check's own sentence is the Ask service's, in English.
    expect(checkStatus(ACCEPTED).lang).toBe("en");
  });
});

describe("the markup", () => {
  const services = { anthropicKeys: new MemoryKeyStore(), ask: fakeAsk(async () => ACCEPTED) };

  it("renders the Anthropic section's copy, the pricing link and the key field", () => {
    const html = renderToStaticMarkup(createElement(AnthropicKeySection, { services }));
    expect(html).toContain(`<h2 class="settings-heading">${labels.ANTHROPIC_SECTION_TITLE}</h2>`);
    expect(html).toContain(`<p class="settings-copy">${escape(labels.ANTHROPIC_KEY_USE)}</p>`);
    expect(html).toContain(`<p class="settings-copy">${escape(labels.ANTHROPIC_DATA_SENT)}</p>`);
    expect(html).toContain(`<a href="https://platform.claude.com/docs/en/about-claude/pricing" target="_blank" rel="noreferrer noopener">${escape(labels.PRICING_LINE)}</a>`);
    const input = html.match(/<input[^>]*\/>/)?.[0] ?? "";
    for (const attribute of ['type="password"', 'placeholder="Paste your Anthropic API key"', 'aria-label="Anthropic API key"', 'autoCapitalize="none"', 'spellCheck="false"']) {
      expect(input, attribute).toContain(attribute);
    }
    expect(html).toContain(
      `<button type="button" class="ag-button ag-button-primary" aria-label="${labels.SAVE_ANTHROPIC_KEY_NAME}" disabled="">${labels.SAVE_KEY}</button>`,
    );
    // Before the Keychain answers: no claim either way, and nothing to check or remove.
    expect(html).not.toContain(labels.NO_KEY_ON_FILE);
    expect(html).not.toContain(labels.CHECK_KEY);
    expect(html).not.toContain(labels.REMOVE_KEY);
    expect(html).toContain('<div role="status" class="settings-results"></div>');
  });

  it("Settings is the S08 groups in order, with the seats.aero key on its own page (T11, U-038)", () => {
    const shell = { ...services, keys: new MemoryKeyStore(), clearCache: async () => {}, settings: new SettingsStore({ deviceLocale: "en" }) } as unknown as AppServices;
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ["/settings"] },
        createElement(Routes, null, createElement(Route, { path: "/", element: createElement(Outlet, { context: shell }) }, createElement(Route, { path: "settings", element: createElement(SettingsScreen) }))),
      ),
    );
    const headings = [...html.matchAll(/<h2 class="ag-settings-label"[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1]);
    expect(headings).toEqual(["Data connection", "AI (optional)", "Appearance and language", "Local data", "About"]);
    expect(html).toMatch(/<a id="settings-row-seats" class="ag-settings-row" href="\/settings\/seats"/);
    expect(html).toMatch(/<a id="settings-row-anthropic" class="ag-settings-row" href="\/settings\/anthropic"/);
    expect(html).toContain('role="radiogroup" aria-label="Theme"');
    expect(html).toContain('role="radiogroup" aria-label="Language"');
    expect(html).toContain(escape(labels.CACHE_NOTE));
    // No key is typed or checked on this page, and nothing is claimed before the Keychain has been read.
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("Not connected");
  });
});

describe("Ask's permission on the Anthropic key page (release D10)", () => {
  it("says it has not been given, with nothing to withdraw, until the consent sheet gives it", async () => {
    const settings = new SettingsStore({ deviceLocale: "en" });
    const html = renderToStaticMarkup(createElement(AskPermission, { settings, locale: "en" }));
    expect(html).toContain(`<p class="settings-copy">${escape(CONSENT.en.settings.notAllowed)}</p>`);
    expect(html).not.toContain(CONSENT.en.settings.withdraw);
  });

  it("once given, says so and offers to withdraw it, in the page's language", async () => {
    const settings = new SettingsStore({ deviceLocale: "zh" });
    await settings.allowAi(new Date("2026-10-01T09:30:00.000Z"));
    const html = renderToStaticMarkup(createElement(AskPermission, { settings, locale: "zh" }));
    expect(html).toContain(`<p class="settings-copy">${CONSENT.zh.settings.allowed}</p>`);
    expect(html).toContain(`<button type="button" class="ag-button">${CONSENT.zh.settings.withdraw}</button>`);
  });

  it("is on the section whenever the page has the settings, and absent from a stand-in without them", async () => {
    const services = { anthropicKeys: new MemoryKeyStore(), ask: fakeAsk(async () => ACCEPTED) };
    expect(renderToStaticMarkup(createElement(AnthropicKeySection, { services }))).not.toContain('data-testid="ask-permission"');
    const withSettings = { ...services, settings: new SettingsStore({ deviceLocale: "en" }) };
    expect(renderToStaticMarkup(createElement(AnthropicKeySection, { services: withSettings }))).toContain('data-testid="ask-permission"');
  });
});
