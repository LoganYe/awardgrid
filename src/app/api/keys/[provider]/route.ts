/**
 * DELETE /api/keys/[provider] → 204 (idempotent: 204 even when no key was on file).
 * Unknown provider → 400 { error: "invalid_provider" }; no session → 401.
 */
import { NextResponse, type NextRequest } from "next/server";
import { isKeyProvider, removeKey } from "@/lib/keys";
import { getServerDb } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";
import { userFromRequest } from "../session";

export const runtime = "nodejs";

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ provider: string }> },
): Promise<NextResponse> {
  const db = getServerDb();
  const user = userFromRequest(request, db);
  if (!user) return jsonError(401, "unauthorized");
  const { provider } = await ctx.params;
  if (!isKeyProvider(provider)) return NextResponse.json({ error: "invalid_provider" }, { status: 400 });
  removeKey(db, user.id, provider);
  return new NextResponse(null, { status: 204 });
}
