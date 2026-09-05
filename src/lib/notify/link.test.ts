import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { telegramLinkTokens, users } from "@/lib/db/schema";
import { testDbWithUsers } from "@/lib/db/stores/testing";
import {
  consumeTelegramLinkToken,
  createTelegramLinkToken,
  findUserByChatId,
  generateLinkToken,
  LINK_TOKEN_TTL_MS,
  pruneExpiredLinkTokens,
  telegramDeepLink,
  unlinkTelegram,
  unlinkTelegramChat,
} from "./link";
import { START_PAYLOAD_RE } from "./telegram";

const T0 = "2026-09-06T10:00:00.000Z";
const plus = (ms: number) => new Date(Date.parse(T0) + ms).toISOString();

describe("token generation", () => {
  it("is 43 chars of the deep-link charset and unique", () => {
    const a = generateLinkToken();
    const b = generateLinkToken();
    expect(a).toHaveLength(43);
    expect(a).toMatch(START_PAYLOAD_RE);
    expect(a).not.toBe(b);
  });
  it("builds the deep link and validates the bot name", () => {
    expect(telegramDeepLink("awardgrid_bot", "tok")).toBe("https://t.me/awardgrid_bot?start=tok");
    expect(telegramDeepLink("@awardgrid_bot", "tok")).toBe("https://t.me/awardgrid_bot?start=tok");
    expect(() => telegramDeepLink("bad name", "tok")).toThrow();
    expect(() => telegramDeepLink("bot", "bad.tok")).toThrow();
  });
});

describe("link token lifecycle", () => {
  it("create → consume sets telegram_chat_id and is single-use", () => {
    const db = testDbWithUsers(["u1"]);
    const link = createTelegramLinkToken(db, "u1", { now: T0 });
    expect(link.expiresAt).toBe(plus(LINK_TOKEN_TTL_MS));
    expect(link.deepLink("awardgrid_bot")).toBe(`https://t.me/awardgrid_bot?start=${link.token}`);

    const first = consumeTelegramLinkToken(db, link.token, "5551234567890", { now: plus(60_000) });
    expect(first).toEqual({ userId: "u1", locale: "en" });
    expect(db.select().from(users).where(eq(users.id, "u1")).get()?.telegramChatId).toBe("5551234567890");
    expect(db.select().from(telegramLinkTokens).where(eq(telegramLinkTokens.token, link.token)).get()?.usedAt).toBe(
      plus(60_000),
    );

    const second = consumeTelegramLinkToken(db, link.token, "999", { now: plus(120_000) });
    expect(second).toBeNull();
    expect(db.select().from(users).where(eq(users.id, "u1")).get()?.telegramChatId).toBe("5551234567890");
  });

  it("rejects expired, unknown and malformed tokens", () => {
    const db = testDbWithUsers(["u1"]);
    const link = createTelegramLinkToken(db, "u1", { now: T0 });
    expect(consumeTelegramLinkToken(db, link.token, "1", { now: plus(LINK_TOKEN_TTL_MS) })).toBeNull();
    expect(consumeTelegramLinkToken(db, link.token, "1", { now: plus(LINK_TOKEN_TTL_MS - 1) })).not.toBeNull();
    expect(consumeTelegramLinkToken(db, "a".repeat(43), "1", { now: T0 })).toBeNull();
    expect(consumeTelegramLinkToken(db, "not valid!", "1", { now: T0 })).toBeNull();
    expect(consumeTelegramLinkToken(db, link.token, "", { now: T0 })).toBeNull();
  });

  it("minting again invalidates the previous unused token", () => {
    const db = testDbWithUsers(["u1"]);
    const a = createTelegramLinkToken(db, "u1", { now: T0 });
    const b = createTelegramLinkToken(db, "u1", { now: plus(1000) });
    expect(consumeTelegramLinkToken(db, a.token, "1", { now: plus(2000) })).toBeNull();
    expect(consumeTelegramLinkToken(db, b.token, "1", { now: plus(2000) })).toEqual({ userId: "u1", locale: "en" });
  });

  it("returns the user's locale", () => {
    const db = testDbWithUsers(["u1"]);
    db.update(users).set({ locale: "zh" }).where(eq(users.id, "u1")).run();
    const link = createTelegramLinkToken(db, "u1", { now: T0 });
    expect(consumeTelegramLinkToken(db, link.token, "7", { now: T0 })?.locale).toBe("zh");
    expect(findUserByChatId(db, "7")).toEqual({ userId: "u1", locale: "zh" });
    expect(findUserByChatId(db, "8")).toBeNull();
  });

  it("unlink clears the chat id and pending tokens", () => {
    const db = testDbWithUsers(["u1", "u2"]);
    const link = createTelegramLinkToken(db, "u1", { now: T0 });
    consumeTelegramLinkToken(db, link.token, "42", { now: T0 });
    createTelegramLinkToken(db, "u1", { now: T0 });
    createTelegramLinkToken(db, "u2", { now: T0 });
    expect(unlinkTelegram(db, "u1")).toBe(true);
    expect(db.select().from(users).where(eq(users.id, "u1")).get()?.telegramChatId).toBeNull();
    expect(db.select().from(telegramLinkTokens).where(eq(telegramLinkTokens.userId, "u1")).all()).toHaveLength(0);
    expect(db.select().from(telegramLinkTokens).where(eq(telegramLinkTokens.userId, "u2")).all()).toHaveLength(1);
    expect(unlinkTelegram(db, "ghost")).toBe(false);
  });

  it("a chat belongs to at most one user: re-linking moves it, and /unlink-by-chat clears every holder", () => {
    const db = testDbWithUsers(["u1", "u2", "u3"]);
    const a = createTelegramLinkToken(db, "u1", { now: T0 });
    expect(consumeTelegramLinkToken(db, a.token, "42", { now: T0 })).toEqual({ userId: "u1", locale: "en" });
    // u2 runs /start in the same chat → u1 is detached, u2 owns it.
    const b = createTelegramLinkToken(db, "u2", { now: T0 });
    expect(consumeTelegramLinkToken(db, b.token, "42", { now: T0 })).toEqual({ userId: "u2", locale: "en" });
    expect(db.select().from(users).where(eq(users.id, "u1")).get()?.telegramChatId).toBeNull();
    expect(db.select().from(users).where(eq(users.id, "u2")).get()?.telegramChatId).toBe("42");
    expect(findUserByChatId(db, "42")?.userId).toBe("u2");

    // Legacy rows that already share a chat are all cleared by a chat-side unlink.
    db.update(users).set({ telegramChatId: "42" }).where(eq(users.id, "u3")).run();
    createTelegramLinkToken(db, "u3", { now: T0 });
    expect(unlinkTelegramChat(db, "42")).toBe(2);
    expect(db.select().from(users).where(eq(users.telegramChatId, "42")).all()).toHaveLength(0);
    expect(db.select().from(telegramLinkTokens).where(eq(telegramLinkTokens.userId, "u3")).all()).toHaveLength(0);
    expect(unlinkTelegramChat(db, "42")).toBe(0);
    expect(unlinkTelegramChat(db, "")).toBe(0);
  });

  it("prunes expired unused tokens only", () => {
    const db = testDbWithUsers(["u1", "u2"]);
    createTelegramLinkToken(db, "u1", { now: T0 });
    const used = createTelegramLinkToken(db, "u2", { now: T0 });
    consumeTelegramLinkToken(db, used.token, "1", { now: T0 });
    expect(pruneExpiredLinkTokens(db, { now: plus(LINK_TOKEN_TTL_MS - 1) })).toBe(0);
    expect(pruneExpiredLinkTokens(db, { now: plus(LINK_TOKEN_TTL_MS + 1) })).toBe(1);
    expect(db.select().from(telegramLinkTokens).all()).toHaveLength(1);
  });
});
