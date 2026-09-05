/**
 * Telegram Bot API transport (ARCHITECTURE §9.5, Bot API 10.3).
 *
 * Only three methods are used, all documented:
 *   POST /bot<token>/sendMessage  { chat_id, text, parse_mode: "HTML", link_preview_options: { is_disabled: true } }
 *   POST /bot<token>/getMe        → { username }
 *   POST /bot<token>/getUpdates   { offset, limit, timeout, allowed_updates: ["message"] }  (long polling)
 *
 * The bot token is held in a private field, goes out only in the request path, and is redacted
 * from every error text produced here. Chat ids are never logged.
 */
import { z } from "zod";
import type { SendFailureReason, SendResult, Transport } from "@/lib/notify/transport";

export const TELEGRAM_API_BASE = "https://api.telegram.org";
/** Long-poll wait requested from Telegram (seconds); the HTTP timeout adds a margin on top. */
export const DEFAULT_POLL_TIMEOUT_SEC = 25;
export const DEFAULT_SEND_TIMEOUT_MS = 15_000;

/** Deep-link payload rule: `https://t.me/<bot>?start=<payload>`, payload `[A-Za-z0-9_-]{1,64}`. */
export const START_PAYLOAD_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface TelegramTransportOptions {
  token: string;
  fetch?: typeof fetch;
  apiBase?: string;
  timeoutMs?: number;
}

/** The subset of Update the poller needs (everything else is ignored on purpose). */
export interface TelegramUpdate {
  update_id: number;
  /** Present only for text messages. */
  message?: { text: string; chat_id: string };
}

export interface GetUpdatesParams {
  offset?: number;
  /** Long-poll seconds (0 = short poll). */
  timeoutSec?: number;
  /** 1..100, default 100. */
  limit?: number;
  /**
   * Cancels the long poll early (the worker's stop signal), so a shutdown never waits out the
   * full `timeoutSec` + HTTP timeout. Combined with the request timeout; an abort surfaces as a
   * TelegramError("network").
   */
  signal?: AbortSignal;
}

export class TelegramError extends Error {
  readonly reason: SendFailureReason;
  readonly status: number;
  constructor(reason: SendFailureReason, status: number, detail?: string) {
    super(`telegram ${reason} (HTTP ${status})${detail ? `: ${detail}` : ""}`);
    this.name = "TelegramError";
    this.reason = reason;
    this.status = status;
  }
}

const ApiEnvelope = z.object({
  ok: z.boolean(),
  result: z.unknown().optional(),
  description: z.string().optional(),
  error_code: z.number().int().optional(),
});

const RawUpdate = z.object({
  update_id: z.number().int(),
  message: z
    .object({
      text: z.string().optional(),
      // Chat ids may exceed 32 bits; JSON numbers stay exact up to 2^53, then stringified.
      chat: z.object({ id: z.union([z.number().int(), z.string()]) }),
    })
    .optional(),
});

const MeResult = z.object({ username: z.string().optional() });
const SentMessage = z.object({ message_id: z.number().int().optional() });

export function classifyTelegramStatus(status: number): SendFailureReason {
  if (status === 403) return "blocked";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "unavailable";
  if (status === 400 || status === 404 || status === 401) return "bad_request";
  return "unknown";
}

/** "/start <payload>" → payload when it matches the deep-link charset, else null. */
export function parseStartCommand(text: string | null | undefined): string | null {
  if (typeof text !== "string") return null;
  const m = /^\/start(?:@\w+)?\s+(\S+)\s*$/.exec(text.trim());
  if (!m) return null;
  const payload = m[1] ?? "";
  return START_PAYLOAD_RE.test(payload) ? payload : null;
}

/** True for "/unlink" (optionally "/unlink@botname"). */
export function isUnlinkCommand(text: string | null | undefined): boolean {
  return typeof text === "string" && /^\/unlink(?:@\w+)?\s*$/.test(text.trim());
}

export class TelegramTransport implements Transport {
  readonly kind = "telegram" as const;
  readonly #token: string;
  readonly #fetch: typeof fetch;
  readonly #apiBase: string;
  readonly #timeoutMs: number;

  constructor(opts: TelegramTransportOptions) {
    if (!opts.token) throw new Error("TelegramTransport requires a bot token");
    this.#token = opts.token;
    this.#fetch = opts.fetch ?? globalThis.fetch;
    this.#apiBase = (opts.apiBase ?? TELEGRAM_API_BASE).replace(/\/+$/, "");
    this.#timeoutMs = opts.timeoutMs ?? DEFAULT_SEND_TIMEOUT_MS;
  }

  /** Keep the token out of anything that might be stringified. */
  toJSON(): { kind: "telegram" } {
    return { kind: "telegram" };
  }

  async sendMessage(chatId: string, html: string): Promise<SendResult> {
    try {
      const result = await this.#call(
        "sendMessage",
        {
          chat_id: chatId,
          text: html,
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
        },
        this.#timeoutMs,
      );
      const parsed = SentMessage.safeParse(result);
      const id = parsed.success ? parsed.data.message_id : undefined;
      return id === undefined ? { ok: true } : { ok: true, messageId: String(id) };
    } catch (err) {
      return { ok: false, reason: err instanceof TelegramError ? err.reason : "network" };
    }
  }

  /** Validates the token and returns the bot username used to build deep links. */
  async getMe(): Promise<{ username: string }> {
    const result = await this.#call("getMe", {}, this.#timeoutMs);
    const me = MeResult.safeParse(result);
    if (!me.success || !me.data.username) {
      throw new TelegramError("bad_request", 200, "getMe returned no username");
    }
    return { username: me.data.username };
  }

  /** Long polling. Only `message.text` + `chat.id` + `update_id` are parsed; others are dropped. */
  async getUpdates(params: GetUpdatesParams = {}): Promise<TelegramUpdate[]> {
    const timeoutSec = Math.max(0, Math.floor(params.timeoutSec ?? DEFAULT_POLL_TIMEOUT_SEC));
    const limit = Math.min(100, Math.max(1, Math.floor(params.limit ?? 100)));
    const result = await this.#call(
      "getUpdates",
      {
        ...(params.offset !== undefined ? { offset: params.offset } : {}),
        limit,
        timeout: timeoutSec,
        allowed_updates: ["message"],
      },
      timeoutSec * 1000 + this.#timeoutMs,
      params.signal,
    );
    if (!Array.isArray(result)) throw new TelegramError("bad_request", 200, "getUpdates result is not an array");
    const out: TelegramUpdate[] = [];
    for (const raw of result) {
      const u = RawUpdate.safeParse(raw);
      if (!u.success) continue;
      const msg = u.data.message;
      out.push(
        msg && typeof msg.text === "string"
          ? { update_id: u.data.update_id, message: { text: msg.text, chat_id: String(msg.chat.id) } }
          : { update_id: u.data.update_id },
      );
    }
    return out;
  }

  async #call(method: string, body: Record<string, unknown>, timeoutMs: number, cancel?: AbortSignal): Promise<unknown> {
    const url = `${this.#apiBase}/bot${this.#token}/${method}`;
    let res: Response;
    try {
      res = await this.#fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
        signal: requestSignal(timeoutMs, cancel),
      });
    } catch (err) {
      throw new TelegramError("network", 0, this.#redact(errorText(err)));
    }
    let envelope: z.infer<typeof ApiEnvelope> | null = null;
    try {
      envelope = ApiEnvelope.parse(await res.json());
    } catch {
      envelope = null;
    }
    if (!res.ok || !envelope || !envelope.ok) {
      const status = envelope?.error_code ?? res.status;
      const detail = envelope?.description ? this.#redact(envelope.description) : "";
      throw new TelegramError(classifyTelegramStatus(status), status, detail);
    }
    return envelope.result;
  }

  #redact(text: string): string {
    return text.split(this.#token).join("[redacted]");
  }
}

/** The request timeout, joined with an optional caller-side cancel signal. */
function requestSignal(timeoutMs: number, cancel?: AbortSignal): AbortSignal | undefined {
  if (typeof AbortSignal === "undefined" || !("timeout" in AbortSignal)) return cancel;
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!cancel) return timeout;
  return "any" in AbortSignal ? AbortSignal.any([cancel, timeout]) : cancel;
}

function errorText(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: unknown }).cause;
    const causeText = cause instanceof Error ? ` (${cause.message})` : "";
    return `${err.name}: ${err.message}${causeText}`.slice(0, 200);
  }
  return String(err).slice(0, 200);
}
