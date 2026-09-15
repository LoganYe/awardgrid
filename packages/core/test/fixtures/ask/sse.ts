/**
 * Render a stream script from streams.json as the text of an SSE response body.
 *
 * Each Messages API event travels as `event: <type>`, then `data: <json>`, then a blank line, and the
 * event name is the payload's own `type` (claude-api typescript/claude-api/streaming.md, "Raw SSE
 * Format"). The SDK skips `ping` events and turns `error` into an APIError (SDK core/streaming.js:111-118),
 * so a script can be replayed with keep-alives mixed in to prove they change nothing.
 *
 * Tests hand the result to a fake fetch as one buffered body. That is how CapacitorHttp delivers a
 * response in the app: whole, after its last byte, however the server paced it.
 */

/** One event payload: `type` is also its SSE event name. */
export interface StreamEvent {
  type: string;
  [field: string]: unknown;
}

export interface ToSseOptions {
  /** Insert an `event: ping` after every `pingEvery` events, never after the last; 0 or absent inserts none. */
  pingEvery?: number;
}

export function toSse(events: readonly StreamEvent[], opts: ToSseOptions = {}): string {
  const every = opts.pingEvery ?? 0;
  let out = "";
  events.forEach((event, i) => {
    out += frame(event);
    if (every > 0 && (i + 1) % every === 0 && i < events.length - 1) out += frame({ type: "ping" });
  });
  return out;
}

/** JSON.stringify never emits a raw newline, so one `data:` line always holds the whole payload. */
function frame(event: StreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
