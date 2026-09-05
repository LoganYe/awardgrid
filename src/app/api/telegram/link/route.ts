/**
 * POST   /api/telegram/link → 200 { deepLink: string, expiresAt, mock: false }
 *                           | 200 { deepLink: null, mock: true } when no bot token is configured
 *                           | 503 { error: "telegram_unavailable" } when getMe cannot name the bot
 * DELETE /api/telegram/link → 204 (idempotent unlink: chat id and pending tokens cleared)
 * The token is the user's own one-time deep-link payload; it is never logged.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getServerDb } from "@/lib/server/db";
import { userFromRequest } from "@/lib/server/find";
import { createTelegramLinkToken, resolveBotUsername, telegramConfigured, unlinkTelegram } from "@/lib/server/queries";

export const runtime = "nodejs";

const NO_STORE = { headers: { "cache-control": "no-store" } } as const;

export interface TelegramLinkResponse {
  deepLink: string | null;
  mock: boolean;
  expiresAt?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const db = getServerDb();
  const user = userFromRequest(db, request);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401, ...NO_STORE });
  if (!telegramConfigured()) {
    const body: TelegramLinkResponse = { deepLink: null, mock: true };
    return NextResponse.json(body, NO_STORE);
  }
  const bot = await resolveBotUsername();
  if (!bot) return NextResponse.json({ error: "telegram_unavailable" }, { status: 503, ...NO_STORE });
  const link = createTelegramLinkToken(db, user.id, { now: new Date() });
  const body: TelegramLinkResponse = { deepLink: link.deepLink(bot), expiresAt: link.expiresAt, mock: false };
  return NextResponse.json(body, NO_STORE);
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const db = getServerDb();
  const user = userFromRequest(db, request);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401, ...NO_STORE });
  unlinkTelegram(db, user.id);
  return new NextResponse(null, { status: 204, ...NO_STORE });
}
