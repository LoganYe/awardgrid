import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { users } from "@/lib/db/schema";
import { openTestDb } from "@/lib/db/client";
import { testDbWithUsers } from "@/lib/db/stores/testing";
import { createTelegramLinkToken } from "./link";
import { handleUpdate, runTelegramLinkPoller, type PollerEvent } from "./poller";
import { TelegramTransport } from "./telegram";

const TOKEN = "42:secret-bot-token";
const T0 = new Date("2026-09-06T10:00:00.000Z");

interface Script {
  /** Each entry is one getUpdates response: an array of raw updates, or an Error to throw. */
  polls: Array<unknown[] | Error>;
}

/** Fake Telegram API: serves scripted getUpdates pages, records sendMessage bodies, aborts when the script ends. */
function fakeTelegram(script: Script, controller: AbortController) {
  const sends: Array<Record<string, unknown>> = [];
  const pollBodies: Array<Record<string, unknown>> = [];
  let i = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    if (url.endsWith("/sendMessage")) {
      sends.push(body);
      return new Response(JSON.stringify({ ok: true, result: { message_id: sends.length } }));
    }
    if (url.endsWith("/getUpdates")) {
      pollBodies.push(body);
      const step = script.polls[i++];
      if (step === undefined) {
        controller.abort();
        return new Response(JSON.stringify({ ok: true, result: [] }));
      }
      if (step instanceof Error) throw step;
      return new Response(JSON.stringify({ ok: true, result: step }));
    }
    throw new Error("unexpected method");
  }) as typeof fetch;
  const transport = new TelegramTransport({ token: TOKEN, fetch: fetchImpl });
  return { transport, sends, pollBodies };
}

const msg = (update_id: number, chatId: number | string, text?: string) => ({
  update_id,
  message: { message_id: update_id, chat: { id: chatId, type: "private" }, ...(text !== undefined ? { text } : {}) },
});

describe("runTelegramLinkPoller", () => {
  it("consumes a scripted /start, sets telegram_chat_id, replies in the user's locale, advances offset", async () => {
    const db = testDbWithUsers(["u1"]);
    db.update(users).set({ locale: "zh" }).where(eq(users.id, "u1")).run();
    const link = createTelegramLinkToken(db, "u1", { now: T0 });
    const controller = new AbortController();
    const { transport, sends, pollBodies } = fakeTelegram(
      { polls: [[msg(100, 5551234567890, "/start " + link.token), msg(101, 7, "hello there")]] },
      controller,
    );
    const events: PollerEvent[] = [];
    const result = await runTelegramLinkPoller({
      transport,
      db,
      now: () => new Date(T0.getTime() + 60_000),
      stopSignal: controller.signal,
      timeoutSec: 1,
      onEvent: (e) => events.push(e),
    });

    expect(db.select().from(users).where(eq(users.id, "u1")).get()?.telegramChatId).toBe("5551234567890");
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({ chat_id: "5551234567890", parse_mode: "HTML", link_preview_options: { is_disabled: true } });
    expect(sends[0]?.text).toBe("已绑定 ✓ awardgrid 将在这里通知你。");
    expect(events).toEqual([{ type: "linked", locale: "zh" }, { type: "ignored" }]);
    expect(result).toEqual({ offset: 102, updatesHandled: 2 });
    // Second poll carried the advanced offset; first had none.
    expect(pollBodies[0]).not.toHaveProperty("offset");
    expect(pollBodies[1]?.offset).toBe(102);
    expect(pollBodies[1]?.timeout).toBe(1);
    // The second poll (offset 102, ok) already confirmed both updates, so no extra confirm call on exit.
    expect(pollBodies).toHaveLength(2);
  });

  it("confirms handled updates on stop with one short getUpdates(offset) so a restart does not replay them", async () => {
    const db = testDbWithUsers(["u1"]);
    const link = createTelegramLinkToken(db, "u1", { now: T0 });
    const controller = new AbortController();
    // The batch is handled, then stop() fires before the next long poll can carry the new offset.
    const { transport, pollBodies } = fakeTelegram({ polls: [[msg(10, 5, "/start " + link.token)]] }, controller);
    const inner = transport.getUpdates.bind(transport);
    const stopAfterFirstBatch: typeof transport.getUpdates = async (params) => {
      const r = await inner(params);
      if (r.length > 0) controller.abort();
      return r;
    };
    const events: PollerEvent[] = [];
    const result = await runTelegramLinkPoller({
      transport: { getUpdates: stopAfterFirstBatch, sendMessage: transport.sendMessage.bind(transport) },
      db,
      now: () => T0,
      stopSignal: controller.signal,
      onEvent: (e) => events.push(e),
    });
    expect(events).toEqual([{ type: "linked", locale: "en" }]);
    expect(result).toEqual({ offset: 11, updatesHandled: 1 });
    expect(pollBodies).toHaveLength(2);
    expect(pollBodies[1]).toMatchObject({ offset: 11, timeout: 0, limit: 1 });
  });

  it("stop() cancels an in-flight long poll through the transport's signal, without reporting an error", async () => {
    const db = openTestDb();
    const controller = new AbortController();
    let sawSignal = false;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const signal = init?.signal;
      sawSignal = signal instanceof AbortSignal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    }) as typeof fetch;
    const transport = new TelegramTransport({ token: TOKEN, fetch: fetchImpl });
    const errors: string[] = [];
    const started = Date.now();
    const run = runTelegramLinkPoller({ transport, db, now: () => T0, stopSignal: controller.signal, timeoutSec: 25, onError: (c) => errors.push(c) });
    setTimeout(() => controller.abort(), 20);
    const result = await run;
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(sawSignal).toBe(true);
    expect(errors).toEqual([]);
    expect(result).toEqual({ offset: undefined, updatesHandled: 0 });
  });

  it("replies bilingually when the token is expired or unknown, and does not link", async () => {
    const db = testDbWithUsers(["u1"]);
    const link = createTelegramLinkToken(db, "u1", { now: T0 });
    const controller = new AbortController();
    const { transport, sends } = fakeTelegram({ polls: [[msg(1, 9, "/start " + link.token)]] }, controller);
    const events: PollerEvent[] = [];
    await runTelegramLinkPoller({
      transport,
      db,
      now: () => new Date(T0.getTime() + 16 * 60_000),
      stopSignal: controller.signal,
      onEvent: (e) => events.push(e),
    });
    expect(db.select().from(users).where(eq(users.id, "u1")).get()?.telegramChatId).toBeNull();
    expect(events).toEqual([{ type: "link_rejected" }]);
    expect(String(sends[0]?.text)).toContain("Link expired");
    expect(String(sends[0]?.text)).toContain("链接已过期");
  });

  it("handles /unlink for a linked chat and ignores it for an unknown chat", async () => {
    const db = testDbWithUsers(["u1"]);
    db.update(users).set({ telegramChatId: "77" }).where(eq(users.id, "u1")).run();
    const controller = new AbortController();
    const { transport, sends } = fakeTelegram({ polls: [[msg(1, 77, "/unlink"), msg(2, 78, "/unlink@awardgrid_bot")]] }, controller);
    const events: PollerEvent[] = [];
    await runTelegramLinkPoller({ transport, db, now: () => T0, stopSignal: controller.signal, onEvent: (e) => events.push(e) });
    expect(db.select().from(users).where(eq(users.id, "u1")).get()?.telegramChatId).toBeNull();
    expect(events).toEqual([{ type: "unlinked" }, { type: "unlink_ignored" }]);
    expect(sends[0]?.text).toBe("Unlinked. awardgrid will no longer message this chat.");
    expect(String(sends[1]?.text)).toContain("not linked");
  });

  it("backs off on network errors without stopping and never sends anything", async () => {
    const db = testDbWithUsers(["u1"]);
    const controller = new AbortController();
    const { transport, sends } = fakeTelegram(
      { polls: [new TypeError("fetch failed"), new TypeError("fetch failed"), [msg(5, 1, "noise")]] },
      controller,
    );
    const sleeps: number[] = [];
    const errors: string[] = [];
    const result = await runTelegramLinkPoller({
      transport,
      db,
      now: () => T0,
      stopSignal: controller.signal,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      onError: (c) => errors.push(c),
    });
    expect(errors).toEqual(["network", "network"]);
    expect(sleeps).toEqual([1000, 2000]);
    expect(sends).toHaveLength(0);
    expect(result).toEqual({ offset: 6, updatesHandled: 1 });
    expect(errors.join(" ")).not.toContain(TOKEN);
  });

  it("does nothing when the signal is already aborted", async () => {
    const db = openTestDb();
    const controller = new AbortController();
    controller.abort();
    const { transport, pollBodies } = fakeTelegram({ polls: [] }, controller);
    const r = await runTelegramLinkPoller({ transport, db, now: () => T0, stopSignal: controller.signal, initialOffset: 9 });
    expect(pollBodies).toHaveLength(0);
    expect(r).toEqual({ offset: 9, updatesHandled: 0 });
  });
});

describe("handleUpdate", () => {
  it("ignores updates without a message, non-commands and bare /start", async () => {
    const db = openTestDb();
    const sent: string[] = [];
    const transport = {
      getUpdates: async () => [],
      sendMessage: async (_chatId: string, html: string) => {
        sent.push(html);
        return { ok: true as const };
      },
    };
    const deps = { transport, db, now: () => T0 };
    expect(await handleUpdate({ update_id: 1 }, deps)).toEqual({ type: "ignored" });
    expect(await handleUpdate({ update_id: 2, message: { text: "hi", chat_id: "1" } }, deps)).toEqual({ type: "ignored" });
    expect(await handleUpdate({ update_id: 3, message: { text: "/start", chat_id: "1" } }, deps)).toEqual({ type: "ignored" });
    expect(sent).toHaveLength(0);
  });

  it("reports reply failures with the reason only", async () => {
    const db = testDbWithUsers(["u1"]);
    const link = createTelegramLinkToken(db, "u1", { now: T0 });
    const transport = {
      getUpdates: async () => [],
      sendMessage: async () => ({ ok: false as const, reason: "blocked" as const }),
    };
    const ev = await handleUpdate({ update_id: 1, message: { text: `/start ${link.token}`, chat_id: "3" } }, { transport, db, now: () => T0 });
    expect(ev).toEqual({ type: "reply_failed", reason: "blocked" });
    // The link itself still happened — the reply is best-effort.
    expect(db.select().from(users).where(eq(users.id, "u1")).get()?.telegramChatId).toBe("3");
  });
});
