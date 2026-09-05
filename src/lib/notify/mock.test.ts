import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTransportFromEnv, hashChatId, MOCK_SINK_FILENAME, MockTransport } from "./mock";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("MockTransport", () => {
  it("records messages in memory with sequential ids", async () => {
    const now = () => new Date("2026-09-06T10:00:00.000Z");
    const m = new MockTransport({ now });
    expect(m.kind).toBe("mock");
    expect(await m.sendMessage("chat-1", "<b>a</b>")).toEqual({ ok: true, messageId: "1" });
    expect(await m.sendMessage("chat-2", "b")).toEqual({ ok: true, messageId: "2" });
    expect(m.sent).toEqual([
      { chatId: "chat-1", html: "<b>a</b>", at: "2026-09-06T10:00:00.000Z" },
      { chatId: "chat-2", html: "b", at: "2026-09-06T10:00:00.000Z" },
    ]);
    expect(m.forChat("chat-2")).toHaveLength(1);
    m.clear();
    expect(m.sent).toHaveLength(0);
  });

  it("supports scripted failures", async () => {
    const m = new MockTransport({ failWith: (id) => (id === "blocked" ? { ok: false, reason: "blocked" } : undefined) });
    expect(await m.sendMessage("blocked", "x")).toEqual({ ok: false, reason: "blocked" });
    expect(await m.sendMessage("fine", "x")).toEqual({ ok: true, messageId: "1" });
    expect(m.sent).toHaveLength(1);
  });

  it("appends JSONL to the sink without the raw chat id", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ag-notify-"));
    dirs.push(dir);
    const sinkPath = path.join(dir, "nested", "sink.jsonl");
    const m = new MockTransport({ sinkPath, now: () => new Date("2026-09-06T10:00:00.000Z") });
    await m.sendMessage("5551234567890", "<b>hello</b>");
    await m.sendMessage("5551234567890", "second");
    const lines = readFileSync(sinkPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(first).toEqual({
      at: "2026-09-06T10:00:00.000Z",
      chat: hashChatId("5551234567890"),
      messageId: "1",
      html: "<b>hello</b>",
    });
    expect(readFileSync(sinkPath, "utf8")).not.toContain("5551234567890");
  });
});

describe("createTransportFromEnv", () => {
  it("returns the mock when TELEGRAM_BOT_TOKEN is absent or blank", () => {
    expect(createTransportFromEnv({}).kind).toBe("mock");
    expect(createTransportFromEnv({ TELEGRAM_BOT_TOKEN: "  " }).kind).toBe("mock");
  });
  it("wires the JSONL sink under AWARDGRID_DATA_DIR", () => {
    const tr = createTransportFromEnv({ AWARDGRID_DATA_DIR: "/data/awardgrid" });
    expect(tr).toBeInstanceOf(MockTransport);
    expect((tr as MockTransport).sinkPath).toBe(path.join("/data/awardgrid", MOCK_SINK_FILENAME));
    expect((createTransportFromEnv({}) as MockTransport).sinkPath).toBeUndefined();
  });
  it("returns the Telegram transport when a token is set", () => {
    const tr = createTransportFromEnv({ TELEGRAM_BOT_TOKEN: "1:abc" }, (async () => new Response("{}")) as typeof fetch);
    expect(tr.kind).toBe("telegram");
    expect(JSON.stringify(tr)).not.toContain("1:abc");
  });
});
