/**
 * parseMarkdownLite, parseInline and the booking-link policy.
 *
 * The block and inline cases are the web drawer's own (src/components/ask/markdown.test.ts), kept with their
 * expected output, so the port is pinned to the behaviour it was ported from. The link cases replace the web
 * lane's safeHref: in the app an anchor leaves for Safari, so only a booking_url get_flights returned in this
 * conversation may become one, matched exactly.
 */
import { describe, expect, it } from "vitest";
import { askLinkHref, linkHost, parseInline, parseMarkdownLite } from "./markdown";

const BOOKING = "https://www.aa.com/booking/find-flights?locale=en_US&from=SFO&to=JFK";
const allowed = new Set([BOOKING]);

describe("askLinkHref", () => {
  it("returns the href only for an https URL that exactly equals a booking URL from this conversation", () => {
    expect(askLinkHref(BOOKING, allowed)).toBe(BOOKING);
    expect(askLinkHref(`  ${BOOKING}\n`, allowed)).toBe(BOOKING);
  });

  it("refuses an https URL that is not in the allowlist, however close", () => {
    expect(askLinkHref("https://www.aa.com/booking/find-flights", allowed)).toBeNull();
    expect(askLinkHref(`${BOOKING}&extra=1`, allowed)).toBeNull();
    expect(askLinkHref("https://example.invalid/a", allowed)).toBeNull();
    expect(askLinkHref(BOOKING, new Set())).toBeNull();
  });

  it("refuses an allowlisted URL that is not https", () => {
    const plain = "http://www.aa.com/booking";
    expect(askLinkHref(plain, new Set([plain]))).toBeNull();
  });

  it("refuses anything that could execute, stay inside the app, or leave the origin unexpectedly, even when allowlisted", () => {
    for (const raw of [
      "/settings",
      "//evil.invalid",
      "javascript:alert(1)",
      "data:text/html,<script>",
      "/\\evil.invalid",
      "https://evil.invalid\\@www.aa.com/",
      "mailto:a@b.c",
      "https://www.aa.com/a b",
      "",
    ]) {
      expect(askLinkHref(raw, new Set([raw])), raw).toBeNull();
    }
  });
});

describe("linkHost", () => {
  it("names the host a link goes to, with a port when it has one", () => {
    expect(linkHost(BOOKING)).toBe("www.aa.com");
    expect(linkHost("https://booking.example.invalid:8443/x")).toBe("booking.example.invalid:8443");
    expect(linkHost("not a url")).toBeNull();
  });
});

describe("parseInline", () => {
  it("handles bold and code, leaves unmatched markers literal", () => {
    expect(parseInline("Book **Alaska** via `SEA-NRT` now")).toEqual([
      { kind: "text", text: "Book " },
      { kind: "bold", text: "Alaska" },
      { kind: "text", text: " via " },
      { kind: "code", text: "SEA-NRT" },
      { kind: "text", text: " now" },
    ]);
    expect(parseInline("a ** b ` c")).toEqual([{ kind: "text", text: "a ** b ` c" }]);
  });

  it("turns a markdown link into a link span only when its URL is a booking URL from this conversation", () => {
    expect(parseInline(`see [American's booking page](${BOOKING}) now`, { bookingUrls: allowed })).toEqual([
      { kind: "text", text: "see " },
      { kind: "link", text: "American's booking page", href: BOOKING, host: "www.aa.com" },
      { kind: "text", text: " now" },
    ]);
    // The same link with no allowlist, or a URL not in it, stays exactly as written.
    expect(parseInline(`see [the page](${BOOKING}) now`)).toEqual([{ kind: "text", text: `see [the page](${BOOKING}) now` }]);
    expect(parseInline("see [the table](https://example.invalid/t) now", { bookingUrls: allowed })).toEqual([
      { kind: "text", text: "see [the table](https://example.invalid/t) now" },
    ]);
  });

  it("leaves an unsafe or unclosed link literal", () => {
    const js = "javascript:alert(1)";
    expect(parseInline(`[click](${js})`, { bookingUrls: new Set([js]) })).toEqual([{ kind: "text", text: "[click](javascript:alert(1))" }]);
    expect(parseInline("an [unclosed link")).toEqual([{ kind: "text", text: "an [unclosed link" }]);
  });

  it("recognizes a bare booking URL and shows its host as the link text, leaving trailing punctuation as text", () => {
    expect(parseInline(`Book it at ${BOOKING}.`, { bookingUrls: allowed })).toEqual([
      { kind: "text", text: "Book it at " },
      { kind: "link", text: "www.aa.com", href: BOOKING, host: "www.aa.com" },
      { kind: "text", text: "." },
    ]);
    expect(parseInline(`(${BOOKING})`, { bookingUrls: allowed })).toEqual([
      { kind: "text", text: "(" },
      { kind: "link", text: "www.aa.com", href: BOOKING, host: "www.aa.com" },
      { kind: "text", text: ")" },
    ]);
  });

  it("leaves a bare URL that is not a booking URL, or is not https, as plain text", () => {
    expect(parseInline("Try https://example.invalid/deal or http://www.aa.com/booking today", { bookingUrls: allowed })).toEqual([
      { kind: "text", text: "Try https://example.invalid/deal or http://www.aa.com/booking today" },
    ]);
  });

  it("never links a URL inside inline code or bold", () => {
    expect(parseInline(`\`${BOOKING}\` and **${BOOKING}**`, { bookingUrls: allowed })).toEqual([
      { kind: "code", text: BOOKING },
      { kind: "text", text: " and " },
      { kind: "bold", text: BOOKING },
    ]);
  });
});

describe("parseMarkdownLite", () => {
  it("splits paragraphs, headings, lists and fenced code", () => {
    const text = ["## Best option", "Use **Alaska** (70k).", "", "- Amex → n/a", "- Bilt → Alaska 1:1", "", "1. hold", "2. transfer", "```", "curl -s x", "```", "tail"].join("\n");
    expect(parseMarkdownLite(text)).toEqual([
      { kind: "heading", spans: [{ kind: "text", text: "Best option" }] },
      { kind: "paragraph", spans: [{ kind: "text", text: "Use " }, { kind: "bold", text: "Alaska" }, { kind: "text", text: " (70k)." }] },
      {
        kind: "list",
        ordered: false,
        items: [[{ kind: "text", text: "Amex → n/a" }], [{ kind: "text", text: "Bilt → Alaska 1:1" }]],
      },
      { kind: "list", ordered: true, items: [[{ kind: "text", text: "hold" }], [{ kind: "text", text: "transfer" }]] },
      { kind: "code", text: "curl -s x" },
      { kind: "paragraph", spans: [{ kind: "text", text: "tail" }] },
    ]);
  });

  it("never interprets HTML and tolerates an unterminated fence", () => {
    const blocks = parseMarkdownLite("<script>alert(1)</script>\n```\npartial");
    expect(blocks).toEqual([
      { kind: "paragraph", spans: [{ kind: "text", text: "<script>alert(1)</script>" }] },
      { kind: "code", text: "partial" },
    ]);
    expect(parseMarkdownLite("")).toEqual([]);
  });

  it("leaves a table as literal text, which is why the prompt asks for lists", () => {
    expect(parseMarkdownLite("| Program | Miles |\n|---|---|\n| Alaska | 75,000 |")).toEqual([
      { kind: "paragraph", spans: [{ kind: "text", text: "| Program | Miles | |---|---| | Alaska | 75,000 |" }] },
    ]);
  });

  it("applies the booking-link policy inside list items and paragraphs", () => {
    const text = [`- Alaska, 75,000 miles: [book](${BOOKING})`, "- Delta: https://www.delta.com/made-up", "", `Or open ${BOOKING}`].join("\n");
    expect(parseMarkdownLite(text, { bookingUrls: allowed })).toEqual([
      {
        kind: "list",
        ordered: false,
        items: [
          [
            { kind: "text", text: "Alaska, 75,000 miles: " },
            { kind: "link", text: "book", href: BOOKING, host: "www.aa.com" },
          ],
          [{ kind: "text", text: "Delta: https://www.delta.com/made-up" }],
        ],
      },
      {
        kind: "paragraph",
        spans: [
          { kind: "text", text: "Or open " },
          { kind: "link", text: "www.aa.com", href: BOOKING, host: "www.aa.com" },
        ],
      },
    ]);
  });
});
