import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdownLite } from "./markdown";

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

  it("never interprets HTML and tolerates an unterminated fence mid-stream", () => {
    const blocks = parseMarkdownLite("<script>alert(1)</script>\n```\npartial");
    expect(blocks).toEqual([
      { kind: "paragraph", spans: [{ kind: "text", text: "<script>alert(1)</script>" }] },
      { kind: "code", text: "partial" },
    ]);
    expect(parseMarkdownLite("")).toEqual([]);
  });
});
