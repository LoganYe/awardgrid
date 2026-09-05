/**
 * GET /api/keys → 200 { keys: [{ provider, last4, masked, createdAt }] }
 * PUT /api/keys { provider, key } → 200 { provider, last4, masked, createdAt }
 *
 * Kickoff §5: a new seats.aero key is validated with ONE cheap Cached Search before it is
 * stored (charged to the user's own quota — reserved BEFORE the probe like every other
 * seats.aero call, so a user at the soft limit gets 429 { error: "quota", resetAt } instead
 * of an uncounted request); Duffel/Ignav keys are stored without a probe.
 * The plaintext key lives only in the request body and the encrypt call — it is never in a
 * response, a log line or an error (§0.2 #8). Error bodies are `{ error: <code> }` only.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createSqliteQuotaStore } from "@/lib/db/stores/quota";
import { KEY_PROVIDERS } from "@/lib/db/schema";
import {
  getMasterKey,
  KeyError,
  MAX_KEY_LENGTH,
  listKeys,
  normalizeKeyInput,
  setKey,
  validateSeatsAeroKey,
  type KeySummary,
} from "@/lib/keys";
import { Quota, QuotaExceededError, softLimitFromEnv } from "@/lib/seatsaero/quota";
import { getServerDb } from "@/lib/server/db";
import { BodyError, jsonError, readJson } from "@/lib/server/http";
import { userFromRequest } from "./session";

export const runtime = "nodejs";

export type KeysErrorCode = "invalid_key" | "key_empty" | "key_too_long" | "invalid_provider" | "seatsaero_unavailable";

export interface KeysListResponse {
  keys: KeySummary[];
}

const PutBody = z.object({
  provider: z.enum(KEY_PROVIDERS),
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

  if (input.provider === "seats_aero") {
    const quota = new Quota({ store: createSqliteQuotaStore(db), softLimit: softLimitFromEnv() });
    const day = quota.today();
    try {
      await quota.reserve(user.id, 1, day);
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        return NextResponse.json({ error: "quota", resetAt: err.resetAt.toISOString() }, { status: 429, ...NO_STORE });
      }
      throw err;
    }
    // Exactly one HTTP request; `fetch` resolves to globalThis.fetch at call time so tests can stub it.
    let requests = 0;
    const result = await validateSeatsAeroKey(secret, {
      timeoutMs: 15_000,
      onCall: () => {
        requests += 1;
      },
    });
    // The reservation covered one call. Refund it when no request was issued, when seats.aero
    // rejected the key (a 401/403 cannot be charged to this account) or when the transport
    // failed before the request left; a timeout AFTER it left counts — seats.aero may have.
    const charged =
      requests > 0 && !(result.ok === false && (result.reason === "invalid" || (result.reason === "network" && !result.timed_out)));
    if (!charged) await quota.release(user.id, 1, day);
    if (!result.ok) {
      return result.reason === "invalid" ? keysError(400, "invalid_key") : keysError(502, "seatsaero_unavailable");
    }
  }

  const summary = setKey(db, user.id, input.provider, secret, { masterKey });
  return NextResponse.json(summary, NO_STORE);
}
