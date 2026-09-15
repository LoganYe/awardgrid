/**
 * Markdown-lite for Ask answers: pure, and never HTML.
 *
 * A port of the web drawer's parser (src/components/ask/markdown.ts) with its behaviour kept: paragraphs,
 * headings (rendered as bold lines), bullet and numbered lists, fenced code, and inline **bold**, `code` and
 * links. Everything else stays literal text, tables included, which is why the system prompt asks for short
 * lists (prompt.ts). The renderer emits text nodes and one anchor per link span, so model output can never
 * inject markup.
 *
 * What changed is the link policy. The web lane linked any http(s) URL or same-origin path (safeHref). In the
 * app a tapped link leaves for Safari (Capacitor hands both new-window and off-app navigation to
 * UIApplication.shared.open, WebViewDelegationHandler.swift:108-121, :334-338), and a link Claude invented
 * should not be one tap away. So a link is made only for a `booking_url` that get_flights returned in this
 * conversation (tools.ts adds each one to the conversation's bookingUrls), and a bare https:// URL gets the
 * same check. A same-origin path is never linked: inside the app it would resolve under capacitor://localhost.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "code"; text: string }
  /** `host` is shown next to the text ("{text} ({host})"), so a reader and VoiceOver both hear where it goes. */
  | { kind: "link"; text: string; href: string; host: string };

export type Block =
  | { kind: "paragraph"; spans: Inline[] }
  | { kind: "heading"; spans: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "code"; text: string };

/**
 * `raw` as an href, or null. It must be an https:// URL with no whitespace and none of `<>"'\`, and it must
 * EXACTLY equal one of `allowed`, the booking URLs get_flights returned in this conversation.
 *
 * The character rule is the web lane's (src/components/ask/markdown.ts:23-28): a backslash is "/" to the URL
 * parser for http(s), so `/\evil.invalid` would resolve off-site. Exact equality then does the real work:
 * no prefix, host or normalised match, so a URL Claude assembled from pieces is never a link.
 */
export function askLinkHref(raw: string, allowed: ReadonlySet<string>): string | null {
  const href = raw.trim();
  if (href.length === 0 || /[\s<>"'\\]/.test(href)) return null;
  if (!href.startsWith("https://")) return null;
  return allowed.has(href) ? href : null;
}

/** The host a link names, port included when it has one; null for anything URL cannot parse. */
export function linkHost(href: string): string | null {
  try {
    const host = new URL(href).host;
    return host.length > 0 ? host : null;
  } catch {
    return null;
  }
}

export interface MarkdownOptions {
  /** The conversation's booking URLs, the only hrefs a link may carry. Absent means none: every link stays text. */
  bookingUrls?: ReadonlySet<string>;
}

const NO_LINKS: ReadonlySet<string> = new Set();

const BULLET_RE = /^\s{0,3}[-*•]\s+(.*)$/;
const ORDERED_RE = /^\s{0,3}\d{1,3}[.)]\s+(.*)$/;
const HEADING_RE = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const FENCE_RE = /^\s{0,3}(```|~~~)/;
/** A bare URL runs to the next whitespace or character askLinkHref refuses. */
const BARE_URL_RE = /https:\/\/[^\s<>"'\\`]+/g;
/** Sentence punctuation that follows a URL in prose ("…at https://x.example/b.") and is not part of it. */
const TRAILING_PUNCTUATION_RE = /[.,;:!?)\]]+$/;

/** Parse inline **bold**, `code`, [links](https://…) and bare https:// URLs; unmatched markers stay literal. */
export function parseInline(text: string, opts: MarkdownOptions = {}): Inline[] {
  const allowed = opts.bookingUrls ?? NO_LINKS;
  const out: Inline[] = [];
  let buf = "";
  let i = 0;
  const flush = () => {
    if (buf.length > 0) out.push(...bareUrls(buf, allowed));
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
          const href = askLinkHref(text.slice(close + 2, end), allowed);
          const host = href === null ? null : linkHost(href);
          const label = text.slice(i + 1, close);
          if (href !== null && host !== null && label.length > 0) {
            flush();
            out.push({ kind: "link", text: label, href, host });
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

/** Parse a whole answer into blocks. Never throws. */
export function parseMarkdownLite(text: string, opts: MarkdownOptions = {}): Block[] {
  const inline = (line: string) => parseInline(line, opts);
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let code: string[] | null = null;

  const flushPara = () => {
    if (para.length > 0) {
      blocks.push({ kind: "paragraph", spans: inline(para.join(" ")) });
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({ kind: "list", ordered: list.ordered, items: list.items.map(inline) });
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
      blocks.push({ kind: "heading", spans: inline(heading[1] ?? "") });
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
  // An unterminated fence is kept as code rather than dropped, as the web parser does mid-stream.
  if (code !== null) blocks.push({ kind: "code", text: code.join("\n") });
  return blocks;
}

/**
 * Split plain text around bare https:// URLs that pass askLinkHref. A URL is tried as written, then without
 * trailing sentence punctuation, which stays behind as text. A URL that is not allowed stays in the text as typed.
 */
function bareUrls(text: string, allowed: ReadonlySet<string>): Inline[] {
  const out: Inline[] = [];
  let rest = 0;
  const pushText = (t: string) => {
    if (t.length === 0) return;
    const last = out[out.length - 1];
    if (last?.kind === "text") last.text += t;
    else out.push({ kind: "text", text: t });
  };
  for (const match of text.matchAll(BARE_URL_RE)) {
    const start = match.index;
    let token = match[0];
    let href = askLinkHref(token, allowed);
    if (href === null) {
      const trimmed = token.replace(TRAILING_PUNCTUATION_RE, "");
      href = trimmed !== token ? askLinkHref(trimmed, allowed) : null;
      if (href !== null) token = trimmed;
    }
    const host = href === null ? null : linkHost(href);
    if (href === null || host === null) continue;
    pushText(text.slice(rest, start));
    out.push({ kind: "link", text: host, href, host });
    rest = start + token.length;
  }
  pushText(text.slice(rest));
  return out;
}
