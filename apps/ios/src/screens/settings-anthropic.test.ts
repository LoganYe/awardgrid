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
import { type KeyStore, MemoryKeyStore } from "../native/keychain";
import { AnthropicKeySection, SettingsScreen, anthropicKeyLine, checkStatus, readMasked, removeAnthropicKey, saveAnthropicKey } from "./SettingsScreen";

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
    expect(status).toEqual({ text: labels.KEY_REJECTED, ok: false, requestIdLine: "Anthropic request ID: req_check_401" });
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
    expect(status).toEqual({ text: "Could not save the key: OSStatus -34018 storing ••••", ok: false, requestIdLine: null });
    expect(JSON.stringify(status)).not.toContain(PASTED);
    expect(onSaved).not.toHaveBeenCalled();
    expect(ask.checkKey).not.toHaveBeenCalled();
  });
});

describe("Check key and its result", () => {
  it("shows a check's sentence in its tone, with Anthropic's request ID when there was one", () => {
    expect(checkStatus(ACCEPTED)).toEqual({ text: labels.KEY_ACCEPTED, ok: true, requestIdLine: null });
    expect(checkStatus(REJECTED)).toEqual({ text: labels.KEY_REJECTED, ok: false, requestIdLine: "Anthropic request ID: req_check_401" });
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

  it("adds the sentence to the seats.aero section and the new cache copy, on the Settings route", () => {
    const shell = { ...services, keys: new MemoryKeyStore(), clearCache: async () => {} } as unknown as AppServices;
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ["/settings"] },
        createElement(Routes, null, createElement(Route, { path: "/", element: createElement(Outlet, { context: shell }) }, createElement(Route, { path: "settings", element: createElement(SettingsScreen) }))),
      ),
    );
    expect(html).toContain(`seats.aero settings page. ${labels.SEATS_KEY_NOT_SENT}</p>`);
    expect(html).toContain(`aria-label="${labels.SAVE_SEATS_KEY_NAME}"`);
    expect(html).toContain(escape(labels.CACHE_NOTE));
    // The sections in order: seats.aero, Anthropic, the cache.
    const order = ["seats.aero Pro key", labels.ANTHROPIC_SECTION_TITLE, "Cached data"].map((t) => html.indexOf(escape(t)));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
