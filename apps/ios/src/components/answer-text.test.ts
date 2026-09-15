/**
 * AnswerText renders Claude's text as React elements, never as HTML (design §6.6).
 *
 * Every render goes through react-dom/server, so what is asserted is the markup a WebView would receive. Model text
 * that looks like markup must arrive escaped, and an anchor exists only where core's parser allowed one: a booking
 * URL get_flights returned in this conversation, named with its host. No DOM, no clock, no network.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnswerText, linkText } from "./AnswerText";

const BOOKING = "https://www.alaskaair.com/search/results?A=1&C=0&O=SEA&D=NRT";

function render(text: string, bookingUrls: readonly string[] = []): string {
  return renderToStaticMarkup(createElement(AnswerText, { text, bookingUrls: new Set(bookingUrls) }));
}

const anchors = (html: string) => html.match(/<a\b[^>]*>.*?<\/a>/g) ?? [];

describe("AnswerText renders markdown-lite as elements", () => {
  it("renders paragraphs, headings as h3, lists, fenced code, bold and inline code", () => {
    const html = render(["## Cheapest options", "", "Alaska has **2 seats** at `75,000` miles.", "", "- JAL", "- ANA", "", "1. First", "2. Second", "", "```", "SEA NRT", "```"].join("\n"));
    expect(html).toContain("<h3><span>Cheapest options</span></h3>");
    expect(html).toContain("<p><span>Alaska has </span><strong>2 seats</strong><span> at </span><code>75,000</code><span> miles.</span></p>");
    expect(html).toContain("<ul><li><span>JAL</span></li><li><span>ANA</span></li></ul>");
    expect(html).toContain("<ol><li><span>First</span></li><li><span>Second</span></li></ol>");
    expect(html).toContain("<pre><code>SEA NRT</code></pre>");
    // Headings are h3 only: the question above an answer is the entry's h2.
    expect(html).not.toMatch(/<h[1245]/);
  });

  it("never turns model text into HTML: tags and attributes arrive as the characters Claude wrote", () => {
    const html = render(`Look <img src=x onerror="alert(1)"> and <a href="https://evil.invalid">here</a> <b>now</b>`);
    expect(html).not.toMatch(/<img|<b>|<a\b/);
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("&lt;a href=&quot;https://evil.invalid&quot;&gt;here&lt;/a&gt;");
  });

  it("keeps a <script> as text, in a paragraph and in a code block", () => {
    const html = render("<script>alert(1)</script>\n\n```\n<script>alert(2)</script>\n```");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("<pre><code>&lt;script&gt;alert(2)&lt;/script&gt;</code></pre>");
  });
});

describe("links", () => {
  it("makes an anchor for a booking URL from this conversation, named '{text} ({host})', opening outside the app", () => {
    const html = render(`[Book on Alaska](${BOOKING})`, [BOOKING]);
    expect(anchors(html)).toEqual([
      `<a href="${BOOKING.replace(/&/g, "&amp;")}" target="_blank" rel="noreferrer noopener">Book on Alaska (www.alaskaair.com)</a>`,
    ]);
  });

  it("leaves the same link as literal text when the URL is not a booking URL this conversation returned", () => {
    for (const allowed of [[], ["https://www.alaskaair.com/search/results"], [`${BOOKING}&extra=1`]]) {
      const html = render(`[Book on Alaska](${BOOKING})`, allowed);
      expect(anchors(html), allowed.join(",")).toEqual([]);
      expect(html).toContain(`[Book on Alaska](${BOOKING.replace(/&/g, "&amp;")})`);
    }
  });

  it("names a bare booking URL by its host alone, and leaves sentence punctuation outside the link", () => {
    const html = render(`Book it at ${BOOKING}.`, [BOOKING]);
    expect(anchors(html)).toEqual([`<a href="${BOOKING.replace(/&/g, "&amp;")}" target="_blank" rel="noreferrer noopener">www.alaskaair.com</a>`]);
    expect(html).toMatch(/<\/a><span>\.<\/span>/);
  });

  it("refuses every href core refuses, even when the exact string is on the list", () => {
    const refused = ["javascript:alert(1)", "http://www.alaskaair.com/b", "/settings", "//evil.invalid/b"];
    for (const href of refused) {
      expect(anchors(render(`[tap](${href})`, [href])), href).toEqual([]);
    }
  });

  it("linkText names the host once", () => {
    expect(linkText({ text: "Book on Alaska", host: "www.alaskaair.com" })).toBe("Book on Alaska (www.alaskaair.com)");
    expect(linkText({ text: "www.alaskaair.com", host: "www.alaskaair.com" })).toBe("www.alaskaair.com");
  });
});
