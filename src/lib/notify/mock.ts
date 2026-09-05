/**
 * Mock transport (kickoff §6: "If TELEGRAM_BOT_TOKEN is absent, implement a mock transport with
 * identical interface"). Records every message in memory; optionally appends a JSONL line per
 * message under AWARDGRID_DATA_DIR so a dev run can be inspected. The sink stores only a short
 * hash of the chat id, never the id itself (kickoff §10: no chat ids in logs).
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { TelegramTransport } from "@/lib/notify/telegram";
import type { SendResult, Transport } from "@/lib/notify/transport";

export interface MockSent {
  chatId: string;
  html: string;
  at: string;
}

export interface MockTransportOptions {
  /** Absolute path of a JSONL file to append to (created on first write). */
  sinkPath?: string;
  /** Clock for the `at` field; defaults to the wall clock. */
  now?: () => Date;
  /** Script failures: return a reason to fail the next send for this chat. */
  failWith?: (chatId: string) => SendResult | undefined;
}

export const MOCK_SINK_FILENAME = "notify-mock.jsonl";

export function hashChatId(chatId: string): string {
  return createHash("sha256").update(chatId).digest("hex").slice(0, 12);
}

export class MockTransport implements Transport {
  readonly kind = "mock" as const;
  readonly sent: MockSent[] = [];
  readonly #opts: MockTransportOptions;
  #seq = 0;

  constructor(opts: MockTransportOptions = {}) {
    this.#opts = opts;
  }

  get sinkPath(): string | undefined {
    return this.#opts.sinkPath;
  }

  async sendMessage(chatId: string, html: string): Promise<SendResult> {
    const scripted = this.#opts.failWith?.(chatId);
    if (scripted) return scripted;
    const at = (this.#opts.now?.() ?? new Date()).toISOString();
    this.sent.push({ chatId, html, at });
    const messageId = String(++this.#seq);
    if (this.#opts.sinkPath) {
      try {
        mkdirSync(path.dirname(this.#opts.sinkPath), { recursive: true });
        appendFileSync(
          this.#opts.sinkPath,
          `${JSON.stringify({ at, chat: hashChatId(chatId), messageId, html })}\n`,
          "utf8",
        );
      } catch {
        // A dev-only sink must never fail a notification.
      }
    }
    return { ok: true, messageId };
  }

  /** Messages recorded for one chat, oldest first. */
  forChat(chatId: string): MockSent[] {
    return this.sent.filter((m) => m.chatId === chatId);
  }

  clear(): void {
    this.sent.length = 0;
  }
}

export type TransportEnv = Partial<Record<"TELEGRAM_BOT_TOKEN" | "AWARDGRID_DATA_DIR" | "TELEGRAM_API_BASE", string>>;

/**
 * TELEGRAM_BOT_TOKEN set → TelegramTransport; otherwise MockTransport (JSONL sink under
 * AWARDGRID_DATA_DIR when that is set, in-memory only otherwise). Never reads process.env
 * implicitly — callers pass the env so tests stay hermetic.
 */
export function createTransportFromEnv(env: TransportEnv, fetchImpl?: typeof fetch): Transport {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  if (token) {
    return new TelegramTransport({ token, fetch: fetchImpl, apiBase: env.TELEGRAM_API_BASE });
  }
  const dir = env.AWARDGRID_DATA_DIR?.trim();
  return new MockTransport(dir ? { sinkPath: path.join(dir, MOCK_SINK_FILENAME) } : {});
}
