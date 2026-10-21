/**
 * The parser's user-facing failure (kickoff §4.2), in a module of its own so a caller that never asks an LLM
 * (./parse-local.ts, the iPhone app) can throw and read it without importing the LLM parser (./llm.ts), which brings
 * the Anthropic SDK with it. ./llm.ts and ./index.ts export it as before.
 */
import { noticeText, type Notice } from "../notices";

/** User-facing parse failure. `missing` lists fields the UI can ask for when known. */
export class ParseError extends Error {
  readonly missing: string[];
  /** Structured form of `message` ({code, vars}) so the UI can translate it; message = noticeText(notice). */
  readonly notice: Notice | null;
  constructor(message: string | Notice, opts: { missing?: string[]; cause?: unknown } = {}) {
    const n = typeof message === "string" ? null : message;
    super(n ? noticeText(n) : (message as string), opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = "ParseError";
    this.missing = opts.missing ?? [];
    this.notice = n;
  }
}
