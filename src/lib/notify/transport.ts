/**
 * Notification transport contract (kickoff §6). Two implementations share it:
 *   - TelegramTransport (src/lib/notify/telegram.ts) — the real Bot API
 *   - MockTransport     (src/lib/notify/mock.ts)     — in-memory (+ optional JSONL sink), used
 *     automatically when TELEGRAM_BOT_TOKEN is absent.
 *
 * `chatId` is a string on purpose: Telegram ids may exceed 32 bits (ARCHITECTURE §9.5) and the
 * DB stores them as text. Chat ids never appear in logs or error messages.
 */

export type SendResult = { ok: true; messageId?: string } | { ok: false; reason: SendFailureReason };

/**
 * Why a send failed. `blocked` (HTTP 403: the user blocked the bot or never started it) is
 * the one the worker should treat as permanent; the rest are transient or a bug.
 */
export type SendFailureReason = "blocked" | "bad_request" | "rate_limited" | "unavailable" | "network" | "unknown";

export interface Transport {
  readonly kind: "telegram" | "mock";
  /** `html` uses the Telegram HTML subset (<b>, <i>, <code>, <a href>); see format.ts. */
  sendMessage(chatId: string, html: string): Promise<SendResult>;
}

/** Telegram's hard limit for `text` after entity parsing (ARCHITECTURE §9.5). */
export const TELEGRAM_MAX_MESSAGE_CHARS = 4096;
