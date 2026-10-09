/**
 * GET /api/keys → 200 { keys: [{ provider, last4, masked, createdAt }] }
 * PUT /api/keys { provider, key } → 200 { provider, last4, masked, createdAt }
 *
 * The optional Duffel and Ignav keys the Ask lane uses, stored without a probe. There is no seats.aero key: the web
 * app connects a seats.aero account only through Login with Seats.aero (/api/seats/*), so `provider: "seats_aero"` is
 * refused like any other unknown provider (400 invalid_provider), and nothing is stored.
 * The plaintext key lives only in the request body and the encrypt call — it is never in a
 * response, a log line or an error (§0.2 #8). Error bodies are `{ error: <code> }` only.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getMasterKey, isKeyProvider, KeyError, MAX_KEY_LENGTH, listKeys, normalizeKeyInput, setKey, type KeySummary } from "@/lib/keys";
import { getServerDb } from "@/lib/server/db";
import { BodyError, jsonError, readJson } from "@/lib/server/http";
import { userFromRequest } from "./session";

export const runtime = "nodejs";

export type KeysErrorCode = "key_empty" | "key_too_long" | "invalid_provider";

export interface KeysListResponse {
  keys: KeySummary[];
}

const PutBody = z.object({
  // Checked below, so an unknown provider (seats_aero included) is named as such rather than a bad body.
  provider: z.string().max(32),
  // Length-capped up front so an oversized body never reaches the crypto layer.
  key: z.string().max(MAX_KEY_LENGTH * 4),
});

function keysError(status: number, error: KeysErrorCode): NextResponse {
  return NextResponse.json({ error }, { status });
}

const NO_STORE = { headers: { "cache-control": "no-store" } } as const;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const db = getServerDb();
  const user = userFromRequest(request, db);
  if (!user) return jsonError(401, "unauthorized");
  const body: KeysListResponse = { keys: listKeys(db, user.id) };
  return NextResponse.json(body, NO_STORE);
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const db = getServerDb();
  const user = userFromRequest(request, db);
  if (!user) return jsonError(401, "unauthorized");

  let input: z.infer<typeof PutBody>;
  try {
    input = await readJson(request, PutBody);
  } catch (err) {
    if (err instanceof BodyError) return jsonError(400, "invalid_body");
    throw err;
  }

  if (!isKeyProvider(input.provider)) return keysError(400, "invalid_provider");
  const provider = input.provider;

  let secret: string;
  try {
    secret = normalizeKeyInput(input.key);
  } catch (err) {
    if (err instanceof KeyError) return keysError(400, err.code === "too_long" ? "key_too_long" : "key_empty");
    throw err;
  }

  let masterKey: Buffer;
  try {
    masterKey = getMasterKey();
  } catch (err) {
    // MasterKeyError never carries the value; still log only the name.
    console.error("[api/keys] master key unavailable:", err instanceof Error ? err.name : "error");
    return jsonError(500, "internal");
  }

  const summary = setKey(db, user.id, provider, secret, { masterKey });
  return NextResponse.json(summary, NO_STORE);
}
