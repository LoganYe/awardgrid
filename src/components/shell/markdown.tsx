import type { ReactNode } from "react";

/**
 * Deliberately tiny Markdown → React renderer for our own docs (LEGAL.md). Supports headings,
 * paragraphs, unordered lists, **bold**, *emphasis*, `code`, [links](url) and <autolinks>. No raw HTML is
 * ever emitted, so the input cannot inject markup.
 */

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(`[^`]+`)|(\[[^\]]+\]\([^)]+\))|(<https?:\/\/[^>]+>)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith("**")) {
      out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("*")) {
      // Emphasis is weight 500 (no italics in Chinese, docs/UI_PLAN.md §3).
      out.push(
        <em key={key} className="font-medium not-italic">
          {tok.slice(1, -1)}
        </em>,
      );
    } else if (tok.startsWith("`")) {
      out.push(
        <code key={key} className="rounded-lg bg-bg-raised px-1 py-0.5">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("[")) {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      const label = lm?.[1] ?? tok;
      const href = lm?.[2] ?? "#";
      out.push(link(href, label, key));
    } else {
      const href = tok.slice(1, -1);
      out.push(link(href, href, key));
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function link(href: string, label: string, key: string): ReactNode {
  const safe = /^(https?:\/\/|\/|#|mailto:)/.test(href) ? href : "#";
  const external = safe.startsWith("http");
  return (
    <a
      key={key}
      href={safe}
      className="link"
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {label}
    </a>
  );
}

/** Drop a leading level-1 heading ("# LEGAL") so the page can render its own h1. */
export function stripLeadingTitle(markdown: string): string {
  return markdown.replace(/^\s*#\s[^\n]*\n?/, "");
}

type Block =
  | { type: "h"; level: number; text: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] };

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: string[] | null = null;

  const flushPara = () => {
    if (para.length) blocks.push({ type: "p", text: para.join(" ") });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push({ type: "ul", items: list });
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if (h) {
      flushPara();
      flushList();
      blocks.push({ type: "h", level: h[1]!.length, text: h[2] ?? "" });
    } else if (li) {
      flushPara();
      list ??= [];
      list.push(li[1] ?? "");
    } else if (list && /^\s{2,}/.test(raw)) {
      // continuation of the previous list item
      list[list.length - 1] = `${list[list.length - 1]} ${line.trim()}`;
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return blocks;
}

const HEADING_CLASS: Record<number, string> = {
  1: "t-title",
  2: "t-section mt-6 mb-2",
  3: "t-body font-medium mt-4 mb-1",
};

export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = parseBlocks(source);
  return (
    <div className={className}>
      {blocks.map((b, i) => {
        const key = `b${i}`;
        if (b.type === "h") {
          const cls = HEADING_CLASS[Math.min(b.level, 3)] ?? HEADING_CLASS[3];
          const Tag = (`h${Math.min(b.level, 6)}`) as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
          return (
            <Tag key={key} className={cls}>
              {inline(b.text, key)}
            </Tag>
          );
        }
        if (b.type === "ul") {
          return (
            <ul key={key} className="my-2 list-disc space-y-2 pl-5">
              {b.items.map((item, j) => (
                <li key={`${key}-${j}`}>{inline(item, `${key}-${j}`)}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={key} className="my-2">
            {inline(b.text, key)}
          </p>
        );
      })}
    </div>
  );
}
