/**
 * Minimal markdown for the streamed answer — pure, no HTML. Supports exactly what the drawer
 * renders: paragraphs, headings (rendered as bold lines), bullet / numbered lists, fenced code
 * blocks, and inline **bold** / `code` / [links](https://…). Everything else is literal text, so
 * model output can never inject markup (the React renderer emits text nodes and one <a> whose
 * href passed `safeHref`).
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

/**
 * Only http(s) and same-origin paths become links; everything else (javascript:, data:, a bare
 * word) stays literal text, so a model answer can never produce an executable href.
 *
 * The backslash is rejected outright: WHATWG URL parsing treats "\" as "/" for http(s), so
 * `/\evil.invalid` would pass a naive "starts with one slash" test and then resolve to
 * https://evil.invalid/ in the browser. Same-origin means same origin.
 */
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (href.length === 0 || /[\s<>"'\\]/.test(href)) return null;
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  return /^https?:\/\/[^/]+/i.test(href) ? href : null;
}

export type Block =
  | { kind: "paragraph"; spans: Inline[] }
  | { kind: "heading"; spans: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "code"; text: string };

const BULLET_RE = /^\s{0,3}[-*•]\s+(.*)$/;
const ORDERED_RE = /^\s{0,3}\d{1,3}[.)]\s+(.*)$/;
const HEADING_RE = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const FENCE_RE = /^\s{0,3}(```|~~~)/;

/** Parse inline **bold** and `code`; unmatched markers stay literal. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  let i = 0;
  const flush = () => {
    if (buf.length > 0) out.push({ kind: "text", text: buf });
    buf = "";
  };
  while (i < text.length) {
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push({ kind: "code", text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (text[i] === "[") {
      const close = text.indexOf("]", i + 1);
      if (close > i && text[close + 1] === "(") {
        const end = text.indexOf(")", close + 2);
        if (end > close + 1) {
          const href = safeHref(text.slice(close + 2, end));
          const label = text.slice(i + 1, close);
          if (href && label.length > 0) {
            flush();
            out.push({ kind: "link", text: label, href });
            i = end + 1;
            continue;
          }
        }
      }
    }
    if (text.startsWith("**", i)) {
      const end = text.indexOf("**", i + 2);
      if (end > i + 2) {
        flush();
        out.push({ kind: "bold", text: text.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    buf += text[i];
    i += 1;
  }
  flush();
  return out;
}

/** Parse a whole (possibly partial, mid-stream) answer into blocks. Never throws. */
export function parseMarkdownLite(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let code: string[] | null = null;

  const flushPara = () => {
    if (para.length > 0) {
      blocks.push({ kind: "paragraph", spans: parseInline(para.join(" ")) });
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({ kind: "list", ordered: list.ordered, items: list.items.map(parseInline) });
      list = null;
    }
  };

  for (const line of lines) {
    if (code !== null) {
      if (FENCE_RE.test(line)) {
        blocks.push({ kind: "code", text: code.join("\n") });
        code = null;
      } else {
        code.push(line);
      }
      continue;
    }
    if (FENCE_RE.test(line)) {
      flushPara();
      flushList();
      code = [];
      continue;
    }
    if (line.trim().length === 0) {
      flushPara();
      flushList();
      continue;
    }
    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushPara();
      flushList();
      blocks.push({ kind: "heading", spans: parseInline(heading[1] ?? "") });
      continue;
    }
    const bullet = BULLET_RE.exec(line);
    const ordered = bullet ? null : ORDERED_RE.exec(line);
    if (bullet || ordered) {
      flushPara();
      const isOrdered = Boolean(ordered);
      const item = (bullet?.[1] ?? ordered?.[1] ?? "").trim();
      if (list && list.ordered !== isOrdered) flushList();
      if (!list) list = { ordered: isOrdered, items: [] };
      list.items.push(item);
      continue;
    }
    if (list && /^\s{2,}/.test(line)) {
      // continuation of the previous list item
      const last = list.items.length - 1;
      list.items[last] = `${list.items[last]} ${line.trim()}`;
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  if (code !== null) blocks.push({ kind: "code", text: code.join("\n") }); // unterminated fence mid-stream
  return blocks;
}
