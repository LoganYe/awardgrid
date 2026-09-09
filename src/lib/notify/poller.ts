/**
 * Telegram link poller (ARCHITECTURE §9.5: long polling via getUpdates; no webhook because the
 * deployment has no public HTTPS endpoint). Runs inside the worker.
 *
 * Handles exactly two commands and ignores everything else:
 *   "/start <token>" → consumeTelegramLinkToken → "Linked ✓ …" (user's locale) or "Link expired"
 *   "/unlink"        → unlinkTelegramChat (every account bound to the chat) → "Unlinked" (or "not linked")
 *
 * Network/API failures back off exponentially (BACKOFF_MS) and never stop the loop; the loop
 * ends only when `stopSignal` aborts. The signal also cancels the in-flight long poll, and on
 * the way out the poller CONFIRMS the updates it handled with one short `getUpdates(offset)`
 * (Telegram only marks an update as delivered when a later call carries offset > update_id),
 * so a restart does not replay a "/start <token>" that was already consumed. Nothing here logs
 * chat ids, tokens or usernames: the `onError` hook receives a category string only.
 */
import type { Db } from "@/lib/db/client";
import { t, type Locale } from "@awardgrid/core/i18n";
import {
  consumeTelegramLinkToken,
  findUserByChatId,
  unlinkTelegramChat,
} from "@/lib/notify/link";
import {
  DEFAULT_POLL_TIMEOUT_SEC,
  isUnlinkCommand,
  parseStartCommand,
  TelegramError,
  type TelegramTransport,
  type TelegramUpdate,
} from "@/lib/notify/telegram";
import { escapeHtml } from "@/lib/notify/format";

/** Backoff schedule after consecutive failures (ms); the last value repeats. */
export const BACKOFF_MS = [1_000, 2_000, 5_000, 15_000, 30_000, 60_000] as const;

export type PollerEvent =
  | { type: "linked"; locale: Locale }
  | { type: "link_rejected" }
  | { type: "unlinked" }
  | { type: "unlink_ignored" }
  | { type: "ignored" }
  | { type: "reply_failed"; reason: string };

export interface PollerDeps {
  transport: Pick<TelegramTransport, "getUpdates" | "sendMessage">;
  db: Db;
  /** Clock for token expiry checks. */
  now: () => Date;
  stopSignal: AbortSignal;
  /** Long-poll seconds per getUpdates call (default 25). */
  timeoutSec?: number;
  /** Sleep used for backoff; injectable for tests. Must resolve early when `signal` aborts. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Category-only error hook ("network", "bad_request", …). */
  onError?: (category: string) => void;
  onEvent?: (event: PollerEvent) => void;
  /**
   * Resume point (last handled update_id + 1). Optional: handled updates are confirmed to
   * Telegram on stop, so a clean restart needs no persisted offset; pass one to skip a
   * backlog explicitly.
   */
  initialOffset?: number;
}

export interface PollerRunResult {
  /** Next offset to pass on restart. */
  offset: number | undefined;
  updatesHandled: number;
}

export function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/** Both languages when the recipient is unknown (a rejected token tells us nothing about the user). */
function bilingual(key: "notify.link.expired" | "notify.link.not_linked"): string {
  return `${escapeHtml(t("en", key))}\n${escapeHtml(t("zh", key))}`;
}

/** Handle one update; returns the event describing what happened (exported for tests). */
export async function handleUpdate(
  update: TelegramUpdate,
  deps: Pick<PollerDeps, "transport" | "db" | "now">,
): Promise<PollerEvent> {
  const msg = update.message;
  if (!msg) return { type: "ignored" };
  const chatId = msg.chat_id;

  const token = parseStartCommand(msg.text);
  if (token) {
    const linked = consumeTelegramLinkToken(deps.db, token, chatId, { now: deps.now() });
    if (linked) {
      const r = await deps.transport.sendMessage(chatId, escapeHtml(t(linked.locale, "notify.link.linked")));
      return r.ok ? { type: "linked", locale: linked.locale } : { type: "reply_failed", reason: r.reason };
    }
    const r = await deps.transport.sendMessage(chatId, bilingual("notify.link.expired"));
    return r.ok ? { type: "link_rejected" } : { type: "reply_failed", reason: r.reason };
  }

  if (isUnlinkCommand(msg.text)) {
    const user = findUserByChatId(deps.db, chatId);
    if (user) {
      unlinkTelegramChat(deps.db, chatId);
      const r = await deps.transport.sendMessage(chatId, escapeHtml(t(user.locale, "notify.link.unlinked")));
      return r.ok ? { type: "unlinked" } : { type: "reply_failed", reason: r.reason };
    }
    const r = await deps.transport.sendMessage(chatId, bilingual("notify.link.not_linked"));
    return r.ok ? { type: "unlink_ignored" } : { type: "reply_failed", reason: r.reason };
  }

  return { type: "ignored" };
}

/**
 * Long-poll until `stopSignal` aborts. Every update is acknowledged by advancing `offset`
 * even when handling it fails, so a poison update cannot wedge the loop.
 */
export async function runTelegramLinkPoller(deps: PollerDeps): Promise<PollerRunResult> {
  const sleep = deps.sleep ?? defaultSleep;
  const timeoutSec = deps.timeoutSec ?? DEFAULT_POLL_TIMEOUT_SEC;
  let offset = deps.initialOffset;
  let failures = 0;
  let updatesHandled = 0;

  let unconfirmed = false;

  while (!deps.stopSignal.aborted) {
    let updates: TelegramUpdate[];
    try {
      updates = await deps.transport.getUpdates({ offset, timeoutSec, signal: deps.stopSignal });
      failures = 0;
      unconfirmed = false;
    } catch (err) {
      if (deps.stopSignal.aborted) break; // the poll was cancelled by stop(), not by a failure
      deps.onError?.(err instanceof TelegramError ? err.reason : "network");
      const wait = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)] ?? 60_000;
      failures += 1;
      await sleep(wait, deps.stopSignal);
      continue;
    }

    for (const update of updates) {
      offset = update.update_id + 1;
      try {
        const event = await handleUpdate(update, deps);
        deps.onEvent?.(event);
      } catch {
        deps.onError?.("handler");
      }
      updatesHandled += 1;
      unconfirmed = true;
    }
  }

  if (unconfirmed && offset !== undefined) {
    try {
      await deps.transport.getUpdates({ offset, timeoutSec: 0, limit: 1 });
    } catch (err) {
      deps.onError?.(err instanceof TelegramError ? err.reason : "network");
    }
  }
  return { offset, updatesHandled };
}
