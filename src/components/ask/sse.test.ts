import { describe, expect, it } from "vitest";
import { createSseParser, parseSse, readSseStream, type SseMessage } from "./sse";

describe("SSE parser", () => {
  it("parses the framing POST /api/ask produces", () => {
    const msgs = parseSse('event: text\ndata: {"type":"text","text":"hi"}\n\nevent: result\ndata: {"type":"result"}\n\n');
    expect(msgs).toEqual([
      { event: "text", data: '{"type":"text","text":"hi"}' },
      { event: "result", data: '{"type":"result"}' },
    ]);
  });

  it("is chunk-boundary agnostic (split mid-line, mid-CRLF, mid-blank-line)", () => {
    const full = 'event: text\r\ndata: {"a":1}\r\n\r\nevent: tool\r\ndata: {"name":"Skill"}\r\n\r\n';
    for (let cut = 1; cut < full.length; cut++) {
      const p = createSseParser();
      const out = [...p.push(full.slice(0, cut)), ...p.push(full.slice(cut)), ...p.end()];
      expect(out, `cut at ${cut}`).toEqual([
        { event: "text", data: '{"a":1}' },
        { event: "tool", data: '{"name":"Skill"}' },
      ]);
    }
  });

  it("defaults event to 'message', joins multi-line data, keeps id, ignores comments and retry", () => {
    const msgs = parseSse(": keep-alive\nretry: 1000\nid: 7\ndata: a\ndata:  b\n\n");
    expect(msgs).toEqual([{ event: "message", data: "a\n b", id: "7" }]);
  });

  it("dispatches nothing for a message without data and flushes a trailing message on end()", () => {
    expect(parseSse("event: ping\n\n")).toEqual([]);
    expect(parseSse("event: text\ndata: tail")).toEqual([{ event: "text", data: "tail" }]);
  });

  it("readSseStream drives a ReadableStream and honours abort", async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode('event: text\ndata: {"t":1}\n\nevent: te'));
        c.enqueue(enc.encode('xt\ndata: {"t":2}\n\n'));
        c.close();
      },
    });
    const got: SseMessage[] = [];
    await readSseStream(body, (m) => got.push(m));
    expect(got.map((m) => m.data)).toEqual(['{"t":1}', '{"t":2}']);

    const ac = new AbortController();
    ac.abort();
    const never = new ReadableStream<Uint8Array>({ start() {} });
    await expect(readSseStream(never, () => undefined, ac.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
