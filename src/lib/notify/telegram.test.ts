import { describe, expect, it, vi } from "vitest";
import {
  classifyTelegramStatus,
  isUnlinkCommand,
  parseStartCommand,
  TelegramError,
  TelegramTransport,
} from "./telegram";

const TOKEN = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11";

interface Captured {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

function fakeFetch(
  respond: (c: Captured) => { status?: number; json?: unknown } | Error,
): { fetch: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const c: Captured = {
      url: String(input),
      init: init ?? {},
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    };
    calls.push(c);
    const r = respond(c);
    if (r instanceof Error) throw r;
    const status = r.status ?? 200;
    return new Response(JSON.stringify(r.json ?? { ok: true, result: {} }), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  return { fetch: f as unknown as typeof fetch, calls };
}

describe("TelegramTransport.sendMessage", () => {
  it("POSTs the exact documented payload to /bot<token>/sendMessage", async () => {
    const { fetch, calls } = fakeFetch(() => ({ json: { ok: true, result: { message_id: 42 } } }));
    const tg = new TelegramTransport({ token: TOKEN, fetch });
    const res = await tg.sendMessage("987654321", "<b>hi</b>");
    expect(res).toEqual({ ok: true, messageId: "42" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.body).toEqual({
      chat_id: "987654321",
      text: "<b>hi</b>",
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
    expect(calls[0]?.body).not.toHaveProperty("disable_web_page_preview");
  });

  it("respects a custom apiBase (trailing slash trimmed)", async () => {
    const { fetch, calls } = fakeFetch(() => ({}));
    await new TelegramTransport({ token: TOKEN, fetch, apiBase: "http://127.0.0.1:9/" }).sendMessage("1", "x");
    expect(calls[0]?.url).toBe(`http://127.0.0.1:9/bot${TOKEN}/sendMessage`);
  });

  it("maps 403 → blocked, 400 → bad_request, 429 → rate_limited, 5xx → unavailable", async () => {
    const statuses = [403, 400, 429, 502];
    const reasons: string[] = [];
    for (const status of statuses) {
      const { fetch } = fakeFetch(() => ({
        status,
        json: { ok: false, error_code: status, description: "Forbidden: bot was blocked by the user" },
      }));
      const r = await new TelegramTransport({ token: TOKEN, fetch }).sendMessage("1", "x");
      reasons.push(r.ok ? "ok" : r.reason);
    }
    expect(reasons).toEqual(["blocked", "bad_request", "rate_limited", "unavailable"]);
    expect(classifyTelegramStatus(404)).toBe("bad_request");
    expect(classifyTelegramStatus(418)).toBe("unknown");
  });

  it("maps a thrown fetch to network and keeps the token out of the error text", async () => {
    const { fetch } = fakeFetch(() => new TypeError(`fetch failed for https://api.telegram.org/bot${TOKEN}/sendMessage`));
    const tg = new TelegramTransport({ token: TOKEN, fetch });
    const r = await tg.sendMessage("1", "x");
    expect(r).toEqual({ ok: false, reason: "network" });
    // getMe surfaces the error object; the token must be redacted from it.
    await expect(tg.getMe()).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(TelegramError);
      expect(String(err)).not.toContain(TOKEN);
      expect(String(err)).toContain("[redacted]");
      return true;
    });
    expect(JSON.stringify(tg)).not.toContain(TOKEN);
  });

  it("redacts the token when the API echoes it in `description`", async () => {
    const { fetch } = fakeFetch(() => ({
      status: 401,
      json: { ok: false, error_code: 401, description: `Unauthorized ${TOKEN}` },
    }));
    await expect(new TelegramTransport({ token: TOKEN, fetch }).getMe()).rejects.toSatisfy((err: unknown) => {
      expect(String(err)).not.toContain(TOKEN);
      return true;
    });
  });

  it("treats ok:false with HTTP 200 as a failure", async () => {
    const { fetch } = fakeFetch(() => ({ status: 200, json: { ok: false, error_code: 403, description: "blocked" } }));
    const r = await new TelegramTransport({ token: TOKEN, fetch }).sendMessage("1", "x");
    expect(r).toEqual({ ok: false, reason: "blocked" });
  });

  it("requires a token", () => {
    expect(() => new TelegramTransport({ token: "" })).toThrow();
  });
});

describe("TelegramTransport.getMe / getUpdates", () => {
  it("getMe returns the bot username", async () => {
    const { fetch, calls } = fakeFetch(() => ({ json: { ok: true, result: { id: 1, is_bot: true, username: "awardgrid_bot" } } }));
    const me = await new TelegramTransport({ token: TOKEN, fetch }).getMe();
    expect(me).toEqual({ username: "awardgrid_bot" });
    expect(calls[0]?.url.endsWith("/getMe")).toBe(true);
  });

  it("getUpdates long-polls with offset and parses only text + chat id + update_id", async () => {
    const { fetch, calls } = fakeFetch(() => ({
      json: {
        ok: true,
        result: [
          { update_id: 10, message: { message_id: 1, text: "/start abc", chat: { id: 5551234567890, type: "private" }, from: { id: 7 } } },
          { update_id: 11, message: { message_id: 2, chat: { id: 9 }, photo: [] } },
          { update_id: 12, edited_message: { text: "x", chat: { id: 9 } } },
          { garbage: true },
        ],
      },
    }));
    const updates = await new TelegramTransport({ token: TOKEN, fetch }).getUpdates({ offset: 10, timeoutSec: 3 });
    expect(calls[0]?.body).toEqual({ offset: 10, limit: 100, timeout: 3, allowed_updates: ["message"] });
    expect(updates).toEqual([
      { update_id: 10, message: { text: "/start abc", chat_id: "5551234567890" } },
      { update_id: 11 },
      { update_id: 12 },
    ]);
  });

  it("getUpdates omits offset when undefined", async () => {
    const { fetch, calls } = fakeFetch(() => ({ json: { ok: true, result: [] } }));
    await new TelegramTransport({ token: TOKEN, fetch }).getUpdates();
    expect(calls[0]?.body).not.toHaveProperty("offset");
    expect(calls[0]?.body.timeout).toBe(25);
  });
});

describe("parseStartCommand", () => {
  it("accepts valid payloads", () => {
    expect(parseStartCommand("/start abcDEF-_09")).toBe("abcDEF-_09");
    expect(parseStartCommand("  /start   tok123  ")).toBe("tok123");
    expect(parseStartCommand("/start@awardgrid_bot tok")).toBe("tok");
    expect(parseStartCommand(`/start ${"a".repeat(64)}`)).toBe("a".repeat(64));
  });
  it("rejects invalid or missing payloads", () => {
    expect(parseStartCommand("/start")).toBeNull();
    expect(parseStartCommand("/start ")).toBeNull();
    expect(parseStartCommand(`/start ${"a".repeat(65)}`)).toBeNull();
    expect(parseStartCommand("/start bad.token")).toBeNull();
    expect(parseStartCommand("/start a b")).toBeNull();
    expect(parseStartCommand("/started abc")).toBeNull();
    expect(parseStartCommand("hello")).toBeNull();
    expect(parseStartCommand(undefined)).toBeNull();
  });
  it("isUnlinkCommand", () => {
    expect(isUnlinkCommand("/unlink")).toBe(true);
    expect(isUnlinkCommand("/unlink@bot ")).toBe(true);
    expect(isUnlinkCommand("/unlink now")).toBe(false);
    expect(isUnlinkCommand("unlink")).toBe(false);
  });
});
