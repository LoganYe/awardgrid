"use client";

/**
 * The streamed answer (spec §3.6): minimal markdown rendered progressively as React text nodes.
 * There is no dangerouslySetInnerHTML anywhere and no HTML parser: `parseMarkdownLite` produces
 * blocks and spans, and the only element carrying model-supplied data beyond text is an <a>
 * whose href already passed `safeHref` (http(s) or a same-origin path).
 */
import { useMemo } from "react";
import { parseMarkdownLite, type Block, type Inline } from "@/components/ask/markdown";
import { cn } from "@/lib/utils";

function Spans({ spans }: { spans: Inline[] }) {
  return (
    <>
      {spans.map((s, i) => {
        if (s.kind === "bold") return <strong key={i}>{s.text}</strong>;
        if (s.kind === "code")
          return (
            <code key={i} className="rounded-sm bg-bg-raised px-1 font-mono text-[0.9em]">
              {s.text}
            </code>
          );
        if (s.kind === "link")
          return (
            <a key={i} href={s.href} className="link" target="_blank" rel="noreferrer noopener">
              {s.text}
            </a>
          );
        return <span key={i}>{s.text}</span>;
      })}
    </>
  );
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "heading":
            return (
              <p key={i} className="mt-2 font-medium first:mt-0">
                <Spans spans={b.spans} />
              </p>
            );
          case "list": {
            const cls = cn("my-1 flex flex-col gap-0.5 pl-5", b.ordered ? "list-decimal" : "list-disc");
            return b.ordered ? (
              <ol key={i} className={cls}>
                {b.items.map((item, j) => (
                  <li key={j}>
                    <Spans spans={item} />
                  </li>
                ))}
              </ol>
            ) : (
              <ul key={i} className={cls}>
                {b.items.map((item, j) => (
                  <li key={j}>
                    <Spans spans={item} />
                  </li>
                ))}
              </ul>
            );
          }
          case "code":
            return (
              <pre key={i} className="my-1 overflow-x-auto rounded-sm bg-bg-raised p-2 font-mono text-[11px] leading-snug">
                {b.text}
              </pre>
            );
          default:
            return (
              <p key={i} className="my-1 first:mt-0">
                <Spans spans={b.spans} />
              </p>
            );
        }
      })}
    </>
  );
}

export interface AnswerProps {
  text: string;
  /** Draw the caret after the last block while the stream is open. */
  streaming?: boolean;
  className?: string;
}

/** Render one answer. Empty text renders nothing (the drawer shows its own placeholder). */
export function Answer({ text, streaming = false, className }: AnswerProps) {
  const blocks = useMemo(() => parseMarkdownLite(text), [text]);
  if (text.length === 0) return null;
  return (
    <div className={cn("t-body", className)} data-testid="ask-answer">
      <Blocks blocks={blocks} />
      {streaming && <span className="ml-0.5 inline-block h-3 w-1.5 bg-fg/60 align-middle" aria-hidden />}
    </div>
  );
}
