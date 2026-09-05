/**
 * Telegram account linking (kickoff §6: "users link their own chat via a bot deep link with a
 * one-time token"). Tokens are 32 random bytes base64url (43 chars, inside the deep-link
 * charset [A-Za-z0-9_-]{1,64}), live 15 minutes, and are single-use. Consuming one stores the
 * chat id on the user; nothing here logs tokens, chat ids or usernames.
 *
 * One chat ↔ at most one user: the schema has no unique index on telegram_chat_id, so consuming
 * a token first detaches the chat from any other account (the person who just ran /start in
 * that chat owns it), and "/unlink" clears EVERY row bound to the chat (`unlinkTelegramChat`).
 * Otherwise a chat could keep receiving another account's digests after an unlink.
 */
import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNull, lt, ne } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { telegramLinkTokens, users } from "@/lib/db/schema";
import { parseLocale, type Locale } from "@/lib/i18n";
import { START_PAYLOAD_RE } from "@/lib/notify/telegram";

export const LINK_TOKEN_TTL_MS = 15 * 60 * 1000;
export const LINK_TOKEN_BYTES = 32;

export interface ClockOption {
  /** ISO timestamp or Date; defaults to the wall clock. */
  now?: string | Date;
}

export interface TelegramLinkToken {
  token: string;
  expiresAt: string;
  /** `https://t.me/<botUsername>?start=<token>` */
  deepLink: (botUsername: string) => string;
}

export interface ConsumedLink {
  userId: string;
  locale: Locale;
}

function toIso(now?: string | Date): string {
  const d = now === undefined ? new Date() : now instanceof Date ? now : new Date(now);
  if (Number.isNaN(d.getTime())) throw new Error("invalid `now`");
  return d.toISOString();
}

export function generateLinkToken(): string {
  const token = randomBytes(LINK_TOKEN_BYTES).toString("base64url");
  if (!START_PAYLOAD_RE.test(token)) throw new Error("generated token violates the deep-link charset");
  return token;
}

export function telegramDeepLink(botUsername: string, token: string): string {
  const bot = botUsername.replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{1,32}$/.test(bot)) throw new Error("invalid bot username");
  if (!START_PAYLOAD_RE.test(token)) throw new Error("invalid deep-link payload");
  return `https://t.me/${bot}?start=${token}`;
}

/** Mint a fresh token for `userId`; older unused tokens of that user are discarded. */
export function createTelegramLinkToken(db: Db, userId: string, opts: ClockOption = {}): TelegramLinkToken {
  const createdAt = toIso(opts.now);
  const expiresAt = new Date(Date.parse(createdAt) + LINK_TOKEN_TTL_MS).toISOString();
  const token = generateLinkToken();
  db.transaction((tx) => {
    tx.delete(telegramLinkTokens)
      .where(and(eq(telegramLinkTokens.userId, userId), isNull(telegramLinkTokens.usedAt)))
      .run();
    tx.insert(telegramLinkTokens).values({ token, userId, createdAt, expiresAt }).run();
  });
  return { token, expiresAt, deepLink: (botUsername) => telegramDeepLink(botUsername, token) };
}

/**
 * Redeem a token received as "/start <token>". Returns null when the token is unknown, already
 * used, or expired. On success marks it used, detaches `chatId` from any other user, and sets
 * users.telegram_chat_id = chatId.
 */
export function consumeTelegramLinkToken(
  db: Db,
  token: string,
  chatId: string,
  opts: ClockOption = {},
): ConsumedLink | null {
  if (!START_PAYLOAD_RE.test(token) || !chatId) return null;
  const nowIso = toIso(opts.now);
  return db.transaction((tx) => {
    const row = tx.select().from(telegramLinkTokens).where(eq(telegramLinkTokens.token, token)).get();
    if (!row || row.usedAt !== null || row.expiresAt <= nowIso) return null;
    const user = tx.select({ id: users.id, locale: users.locale }).from(users).where(eq(users.id, row.userId)).get();
    if (!user) return null;
    tx.update(telegramLinkTokens).set({ usedAt: nowIso }).where(eq(telegramLinkTokens.token, token)).run();
    tx.update(users).set({ telegramChatId: null }).where(and(eq(users.telegramChatId, chatId), ne(users.id, user.id))).run();
    tx.update(users).set({ telegramChatId: chatId }).where(eq(users.id, user.id)).run();
    return { userId: user.id, locale: parseLocale(user.locale) };
  });
}

/** Clear the chat id and any pending tokens. Returns true when the user existed. */
export function unlinkTelegram(db: Db, userId: string): boolean {
  return db.transaction((tx) => {
    const exists = tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).get();
    if (!exists) return false;
    tx.update(users).set({ telegramChatId: null }).where(eq(users.id, userId)).run();
    tx.delete(telegramLinkTokens).where(eq(telegramLinkTokens.userId, userId)).run();
    return true;
  });
}

/**
 * "/unlink" from the chat side: clear the chat id (and pending tokens) of EVERY user bound to
 * `chatId`. Returns the number of users unlinked (0 when the chat was not linked).
 */
export function unlinkTelegramChat(db: Db, chatId: string): number {
  if (!chatId) return 0;
  return db.transaction((tx) => {
    const ids = tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.telegramChatId, chatId))
      .all()
      .map((r) => r.id);
    if (ids.length === 0) return 0;
    tx.update(users).set({ telegramChatId: null }).where(inArray(users.id, ids)).run();
    tx.delete(telegramLinkTokens).where(inArray(telegramLinkTokens.userId, ids)).run();
    return ids.length;
  });
}

/** The user currently linked to `chatId`, if any (for "/unlink"). */
export function findUserByChatId(db: Db, chatId: string): { userId: string; locale: Locale } | null {
  if (!chatId) return null;
  const row = db
    .select({ id: users.id, locale: users.locale })
    .from(users)
    .where(eq(users.telegramChatId, chatId))
    .get();
  return row ? { userId: row.id, locale: parseLocale(row.locale) } : null;
}

/** Housekeeping: drop expired unused tokens. Returns the number removed. */
export function pruneExpiredLinkTokens(db: Db, opts: ClockOption = {}): number {
  const nowIso = toIso(opts.now);
  const res = db
    .delete(telegramLinkTokens)
    .where(and(isNull(telegramLinkTokens.usedAt), lt(telegramLinkTokens.expiresAt, nowIso)))
    .run();
  return res.changes;
}
