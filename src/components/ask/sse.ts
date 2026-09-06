/**
 * Minimal, dependency-free Server-Sent Events parser (WHATWG EventSource framing) for the Ask
 * drawer. Pure: feed it text chunks in any split and it returns complete messages. Used by
 * `readSseStream` (fetch + ReadableStream → callbacks), which is what the drawer calls because
 * `EventSource` cannot POST a body or carry an AbortSignal.
 *
 * Framing produced by POST /api/ask:  event: <type>\ndata: <json>\n\n
 */

export interface SseMessage {
  /** The `event:` field; "message" when absent (per spec). */
  event: string;
  /** All `data:` lines joined with "\n" (per spec, the trailing newline is stripped). */
  data: string;
  /** The `id:` field when present. */
  id?: string;
}

export interface SseParser {
  /** Feed a chunk; returns every message completed by it (possibly none). */
  push(chunk: string): SseMessage[];
  /** Flush the trailing message when the stream ends without a final blank line. */
  end(): SseMessage[];
}

interface Pending {
  event: string | null;
  data: string[];
  id: string | null;
}

function emptyPending(): Pending {
  return { event: null, data: [], id: null };
}

function finish(p: Pending): SseMessage | null {
  // Per spec: a message with no data lines dispatches nothing.
  if (p.data.length === 0) return null;
  const out: SseMessage = { event: p.event && p.event.length > 0 ? p.event : "message", data: p.data.join("\n") };
  if (p.id !== null) out.id = p.id;
  return out;
}

function applyLine(line: string, p: Pending): void {
  if (line.length === 0) return; // caller handles blank lines
  if (line.startsWith(":")) return; // comment / keep-alive
  const colon = line.indexOf(":");
  const field = colon === -1 ? line : line.slice(0, colon);
  let value = colon === -1 ? "" : line.slice(colon + 1);
  if (value.startsWith(" ")) value = value.slice(1);
  switch (field) {
    case "event":
      p.event = value;
      break;
    case "data":
      p.data.push(value);
      break;
    case "id":
      if (!value.includes("\0")) p.id = value;
      break;
    default:
      // "retry" and unknown fields are ignored.
      break;
  }
}

/** Create a stateful parser. Handles LF, CRLF and CR line endings and chunks split anywhere. */
export function createSseParser(): SseParser {
  let buffer = "";
  let pending = emptyPending();

  function drainLines(flushAll: boolean): SseMessage[] {
    const out: SseMessage[] = [];
    // Normalize CRLF / CR to LF; a chunk boundary between CR and LF is handled by keeping a
    // trailing CR in the buffer until the next chunk arrives.
    let text = buffer.replace(/\r\n/g, "\n");
    let tail = "";
    if (!flushAll && text.endsWith("\r")) {
      tail = "\r";
      text = text.slice(0, -1);
    }
    text = text.replace(/\r/g, "\n");
    const lines = text.split("\n");
    const last = flushAll ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      if (line.length === 0) {
        const msg = finish(pending);
        if (msg) out.push(msg);
        pending = emptyPending();
      } else {
        applyLine(line, pending);
      }
    }
    buffer = last + tail;
    return out;
  }

  return {
    push(chunk: string): SseMessage[] {
      if (chunk.length === 0) return [];
      buffer += chunk;
      return drainLines(false);
    },
    end(): SseMessage[] {
      const out = drainLines(true);
      const msg = finish(pending);
      if (msg) out.push(msg);
      pending = emptyPending();
      buffer = "";
      return out;
    },
  };
}

/** One-shot convenience for tests and non-streaming callers. */
export function parseSse(text: string): SseMessage[] {
  const p = createSseParser();
  return [...p.push(text), ...p.end()];
}

/**
 * Read a fetch Response body as SSE, invoking `onMessage` per message. Resolves when the body
 * ends; rejects on a read error or when `signal` aborts (as a DOMException "AbortError").
 */
export async function readSseStream(body: ReadableStream<Uint8Array>, onMessage: (msg: SseMessage) => void, signal?: AbortSignal): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();
  const onAbort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const { value, done } = await reader.read();
      if (done) break;
      for (const msg of parser.push(decoder.decode(value, { stream: true }))) onMessage(msg);
    }
    for (const msg of parser.push(decoder.decode())) onMessage(msg);
    for (const msg of parser.end()) onMessage(msg);
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}
