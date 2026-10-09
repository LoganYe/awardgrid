/**
 * POST /api/ask { prompt, context? } → text/event-stream of AskEvents (kickoff §7 point 6)
 *   | 400 invalid_body | 401 unauthorized | 409 no_key { provider } | 500 internal (all JSON, before streaming)
 *
 * Boundaries honoured here:
 *   - The calling user's own seats.aero connection ("Bearer seats:ota:…", renewed first when it is about to run out,
 *     src/lib/seats-oauth/access.ts) and optional Duffel / Ignav keys, resolved here and handed to runAsk() ONLY — no
 *     fallback (§0.2 #2). They are never placed on a response, an event or a log line (§0.2 #8); every streamed byte
 *     also passes through redactSecrets() (the Bearer value and the bare token) as a second line of defence.
 *   - Client disconnect (request.signal) or ReadableStream cancel aborts the SDK session so
 *     an abandoned tab cannot keep spending the user's daily budget.
 *   - No seats.aero connection is answered with a JSON 409 before any stream starts, so the drawer
 *     can point at /settings without parsing SSE.
 */
import { NextResponse, type NextRequest } from "next/server";
import { runAsk } from "@/lib/ask";
import { getDecryptedKey, getMasterKey, hasKey, type KeyProvider } from "@/lib/keys";
import { SeatsNotConnectedError, authorizationSecrets, seatsAuthorization } from "@/lib/seats-oauth";
import { getServerDb } from "@/lib/server/db";
import { userFromRequest } from "@/lib/server/find";
import { BodyError, readJson } from "@/lib/server/http";
import { type AskApiErrorCode, AskRequestBody, redactSecrets, sseFrame, toWireEvent } from "./wire";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

function askError(status: number, error: AskApiErrorCode, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ error, ...extra }, { status, headers: NO_STORE });
}

interface ResolvedKeys {
  seats_aero: string;
  duffel?: string;
  ignav?: string;
}

/**
 * The caller's seats.aero authorization and optional keys. The "connected" check runs before the master key is
 * touched (inside seatsAuthorization), so an account without a connection gets a clean 409 even on a host where
 * MASTER_KEY is unset. An Ask session lasts at most two minutes; the access token handed to it has at least five left.
 */
async function resolveKeys(db: ReturnType<typeof getServerDb>, userId: string): Promise<ResolvedKeys> {
  const seats = await seatsAuthorization(db, userId);
  const master = getMasterKey();
  const optional = (provider: KeyProvider): string | undefined =>
    hasKey(db, userId, provider) ? (getDecryptedKey(db, userId, provider, master) ?? undefined) : undefined;
  const duffel = optional("duffel");
  const ignav = optional("ignav");
  return { seats_aero: seats, ...(duffel ? { duffel } : {}), ...(ignav ? { ignav } : {}) };
}

export async function POST(request: NextRequest): Promise<Response> {
  const db = getServerDb();
  const user = userFromRequest(db, request);
  if (!user) return askError(401, "unauthorized");

  let body: AskRequestBody;
  try {
    body = await readJson(request, AskRequestBody);
  } catch (err) {
    if (err instanceof BodyError) return askError(400, "invalid_body");
    return askError(500, "internal");
  }

  let keys: ResolvedKeys;
  try {
    keys = await resolveKeys(db, user.id);
  } catch (err) {
    if (err instanceof SeatsNotConnectedError) return askError(409, "no_key", { provider: err.provider });
    return askError(500, "internal"); // MASTER_KEY missing/malformed, or the sign-in could not be renewed; never echo why
  }
  const secrets = [...authorizationSecrets(keys.seats_aero), keys.duffel, keys.ignav];

  // Client disconnect (request.signal) or ReadableStream cancel → `ac` fires. It is handed to
  // runAsk as `deps.signal` (wired straight to the SDK abortController, so the subprocess dies at
  // once even while the generator is suspended in a long tool call) AND used to finish the
  // generator early below; runAsk's finally block deletes the session dir.
  const ac = new AbortController();
  const onClientAbort = () => ac.abort();
  request.signal.addEventListener("abort", onClientAbort, { once: true });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (type: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(redactSecrets(sseFrame(type, data), secrets)));
        } catch {
          // stream already cancelled by the client; the abort below stops runAsk
        }
      };
      const events = runAsk({
        db,
        user,
        prompt: body.prompt,
        context: { ...(body.context ?? {}), lang: user.locale === "zh" ? "zh" : "en" },
        keys,
        deps: { signal: ac.signal },
      });
      const onAbort = () => {
        void events.return(undefined).catch(() => undefined);
      };
      ac.signal.addEventListener("abort", onAbort, { once: true });
      try {
        for await (const ev of events) {
          if (ac.signal.aborted) break;
          const wire = toWireEvent(ev);
          send(wire.type, wire.data);
        }
      } catch (err) {
        if (!ac.signal.aborted) {
          const name = err instanceof Error ? err.name : "unknown";
          console.error(`[ask] runAsk failed: ${name}`);
          send("error", { type: "error", code: name === "AbortError" || name === "TimeoutError" ? "timeout" : "sdk" });
        }
      } finally {
        ac.signal.removeEventListener("abort", onAbort);
        request.signal.removeEventListener("abort", onClientAbort);
        try {
          controller.close();
        } catch {
          // already closed/cancelled by the client
        }
      }
    },
    cancel() {
      ac.abort();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
