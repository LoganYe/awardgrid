import { describe, expect, it } from "vitest";
import { parseBlocks } from "./markdown";

describe("parseBlocks", () => {
  it("splits headings, paragraphs and lists", () => {
    const src = "# Title\n\nPara one\ncontinues.\n\n- a\n- b\n  more b\n\n## Sub\ntext";
    expect(parseBlocks(src)).toEqual([
      { type: "h", level: 1, text: "Title" },
      { type: "p", text: "Para one continues." },
      { type: "ul", items: ["a", "b more b"] },
      { type: "h", level: 2, text: "Sub" },
      { type: "p", text: "text" },
    ]);
  });

  it("handles CRLF and trailing whitespace", () => {
    expect(parseBlocks("# A \r\n\r\nB  ")).toEqual([
      { type: "h", level: 1, text: "A" },
      { type: "p", text: "B" },
    ]);
  });
});
