/**
 * The shell's chrome (design §6.1, §8.3): the nav, which wraps on a narrow phone and says a question is under way
 * from any screen, and the footer's attribution.
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

function render({ running, unseen }: { running: boolean; unseen: number }): string {
  const watches = Array.from({ length: 20 }, (_, i) => ({ unseen: i < unseen ? { new: 1, dropped: 0, cheaper: 0, since: "2026-10-01T00:00:00.000Z" } : null }));
  const services = {
    ask: { subscribe: () => () => {}, isRunning: () => running },
    watches: { all: () => watches },
    onWatchesChanged: () => () => {},
  } as unknown as AppServices;
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Chrome, { services })));
}

function openingTag(html: string, tag: string): string {
  const found = html.match(new RegExp(`<${tag}\\b[^>]*>`))?.[0];
  if (found === undefined) throw new Error(`no <${tag}> in the markup`);
  return found;
}

const navLabels = (html: string) => [...(html.match(/<nav\b[^>]*>(.*?)<\/nav>/)?.[1] ?? "").matchAll(/<a\b[^>]*>(.*?)<\/a>/g)].map((m) => m[1]);

describe("the chrome", () => {
  it("names the four screens in order, and says Ask is working while a question runs", () => {
    expect(navLabels(render({ running: false, unseen: 0 }))).toEqual(["Search", "Ask", "Watches", "Settings"]);
    expect(navLabels(render({ running: true, unseen: 12 }))).toEqual(["Search", "Ask (working)", "Watches (12)", "Settings"]);
  });

  it("links Ask to #/ask", () => {
    expect(render({ running: false, unseen: 0 })).toMatch(/<a\b[^>]*href="\/ask"[^>]*>Ask<\/a>/);
  });

  it("lets the header and the nav wrap onto another row instead of clipping on a narrow phone", () => {
    const html = render({ running: true, unseen: 12 });
    for (const tag of ["header", "nav"]) {
      const open = openingTag(html, tag);
      expect(open, tag).toContain("flex-wrap:wrap");
      expect(open, tag).toContain("row-gap:6px");
    }
    // Every nav link carries the class that makes it a 44 pt target (styles.css .ag-nav-link).
    expect(html.match(/<a\b[^>]*class="ag-nav-link(?: active)?"/g)).toHaveLength(4);
  });

  it("carries the attribution in the footer, for both keys", () => {
    expect(render({ running: false, unseen: 0 })).toMatch(/<footer\b[^>]*>Data: seats\.aero · your own keys, on this device<\/footer>/);
  });
});
