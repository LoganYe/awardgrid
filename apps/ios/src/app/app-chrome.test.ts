/**
 * The shell's chrome (UI/UX v1 T07; docs/04 S01): a bottom tab bar — Search, Watches, Settings — in the screen's
 * language, the unseen-changes count on Watches, and the data attribution on every screen in the chrome that does
 * not carry it itself (the Search screen says it in its status line). Replaces the Phase 3 top nav (DECISIONS U-025).
 *
 * Rendered through react-dom/server inside a MemoryRouter, over fake services that hold only what the chrome reads.
 * No screen is mounted (the outlet is empty), and no DOM, clock or network is used.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { Chrome } from "./App";
import type { AppServices } from "./bootstrap";

function render({ unseen = 0, locale = "en", path = "/" }: { unseen?: number; locale?: "en" | "zh"; path?: string } = {}): string {
  const watches = Array.from({ length: 20 }, (_, i) => ({ unseen: i < unseen ? { new: 1, dropped: 0, cheaper: 0, since: "2026-10-01T00:00:00.000Z" } : null }));
  const services = { watches: { all: () => watches }, onWatchesChanged: () => () => {}, locale } as unknown as AppServices;
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] }, createElement(Chrome, { services })));
}

const tabs = (html: string) =>
  [...(html.match(/<nav\b[^>]*class="app-tabs"[^>]*>(.*?)<\/nav>/)?.[1] ?? "").matchAll(/<a\b[^>]*>(.*?)<\/a>/g)].map((m) =>
    (m[1] ?? "").replace(/<[^>]+>/g, ""),
  );

describe("the chrome", () => {
  it("has three tabs in order — Saved joins with T13, AI assistance is reached from the Search header", () => {
    expect(tabs(render())).toEqual(["Search", "Watches", "Settings"]);
    expect(tabs(render({ locale: "zh" }))).toEqual(["查票", "关注", "设置"]);
  });

  it("marks the current tab, and names the unseen count on Watches", () => {
    const html = render({ unseen: 12, path: "/" });
    expect(html).toMatch(/<a\b[^>]*aria-current="page"[^>]*href="\/"|<a\b[^>]*href="\/"[^>]*aria-current="page"/);
    expect(html).toContain('<span class="app-tab-badge" aria-hidden="true">12</span><span class="sr-only">12 unseen changes</span>');
    expect(render({ unseen: 12, locale: "zh" })).toContain('<span class="sr-only">12 项未看变化</span>');
    expect(render({ unseen: 0 })).not.toContain("unseen");
  });

  it("puts the screen in a main landmark, and the attribution on screens that do not carry it themselves", () => {
    const search = render({ path: "/" });
    expect(search).toContain("<main");
    expect(search).not.toContain("Data: seats.aero · your own keys");
    expect(render({ path: "/watches" })).toContain("Data: seats.aero · your own keys, on this device");
  });

  it("marks the tab bar with the language it speaks", () => {
    expect(render({ locale: "zh" })).toMatch(/<nav\b[^>]*lang="zh-CN"/);
  });
});
