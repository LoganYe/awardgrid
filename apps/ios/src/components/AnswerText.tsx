/**
 * One of Claude's answer texts, rendered as React elements and never as HTML.
 *
 * Core's parseMarkdownLite (packages/core/src/lib/ask/markdown.ts) turns the text into blocks and spans, and this
 * file maps each to an element whose children are text nodes. Nothing here sets innerHTML, so a `<script>` or an
 * `<img onerror>` in an answer is shown as the characters Claude wrote.
 *
 * A link is an anchor only when core made it one: its href exactly equals a booking URL get_flights returned in
 * this conversation. Its text names the host, "{text} ({host})", so a reader and VoiceOver both hear where a tap
 * goes before making it (design §6.5, §6.6). A bare URL's text already is its host, and is not named twice.
 * `target="_blank"` hands the tap to Safari: Capacitor opens new-window navigation with UIApplication.shared.open.
 */
import type { Block, Inline } from "@awardgrid/core/ask/markdown";
import { parseMarkdownLite } from "@awardgrid/core/ask/markdown";

/** "Book on Alaska (www.alaskaair.com)", or the host alone when the link's text is its host. */
export function linkText(link: { text: string; host: string }): string {
  return link.text === link.host ? link.host : `${link.text} (${link.host})`;
}

function Spans({ spans }: { spans: readonly Inline[] }) {
  return (
    <>
      {spans.map((span, i) => {
        switch (span.kind) {
          case "bold":
            return <strong key={i}>{span.text}</strong>;
          case "code":
            return <code key={i}>{span.text}</code>;
          case "link":
            return (
              <a key={i} href={span.href} target="_blank" rel="noreferrer noopener">
                {linkText(span)}
              </a>
            );
          default:
            return <span key={i}>{span.text}</span>;
        }
      })}
    </>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "heading":
      // A real heading, so VoiceOver's rotor can move through a long answer; styles.css keeps it at body size.
      return (
        <h3>
          <Spans spans={block.spans} />
        </h3>
      );
    case "list": {
      const items = block.items.map((item, i) => (
        <li key={i}>
          <Spans spans={item} />
        </li>
      ));
      return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
    }
    case "code":
      return (
        <pre>
          <code>{block.text}</code>
        </pre>
      );
    default:
      return (
        <p>
          <Spans spans={block.spans} />
        </p>
      );
  }
}

export function AnswerText({ text, bookingUrls }: { text: string; bookingUrls: ReadonlySet<string> }) {
  return (
    <div className="ask-answer">
      {parseMarkdownLite(text, { bookingUrls }).map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
    </div>
  );
}
