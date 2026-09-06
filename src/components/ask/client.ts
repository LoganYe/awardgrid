/**
 * Browser-side calls for the Ask drawer. `askStream` POSTs to /api/ask and feeds every SSE
 * message through `onEvent`; non-2xx answers become a typed `AskFailure` (never a throw).
 * `fetchAskUsage` reads today's spend for the footer.
 */
import { parseWireEvent, type AskContext, type AskUsageResponse, type AskWireEvent } from "@/app/api/ask/wire";
import { readSseStream } from "@/components/ask/sse";

export type AskFailureCode = "unauthorized" | "invalid_body" | "no_key" | "internal" | "network" | "aborted";

export interface AskFailure {
  ok: false;
  status: number;
  error: AskFailureCode;
}

export type AskStreamResult = { ok: true } | AskFailure;

const KNOWN: readonly AskFailureCode[] = ["unauthorized", "invalid_body", "no_key", "internal"];

async function failureFrom(res: Response): Promise<AskFailure> {
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const raw = typeof body.error === "string" ? body.error : "";
  const error = (KNOWN as readonly string[]).includes(raw) ? (raw as AskFailureCode) : res.status === 401 ? "unauthorized" : "internal";
  return { ok: false, status: res.status, error };
}

export interface AskStreamOptions {
  prompt: string;
  context: AskContext;
  signal: AbortSignal;
  onEvent: (ev: AskWireEvent) => void;
  fetchImpl?: typeof fetch;
}

export async function askStream({ prompt, context, signal, onEvent, fetchImpl }: AskStreamOptions): Promise<AskStreamResult> {
  const f = fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ prompt, context }),
      signal,
      credentials: "same-origin",
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return { ok: false, status: 0, error: "aborted" };
    return { ok: false, status: 0, error: "network" };
  }
  if (!res.ok) return failureFrom(res);
  if (!res.body) return { ok: false, status: res.status, error: "internal" };
  try {
    await readSseStream(
      res.body,
      (msg) => {
        const ev = parseWireEvent(msg.data, msg.event);
        if (ev) onEvent(ev);
      },
      signal,
    );
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return { ok: false, status: 0, error: "aborted" };
    return { ok: false, status: 0, error: "network" };
  }
  return { ok: true };
}

export async function fetchAskUsage(fetchImpl: typeof fetch = fetch): Promise<AskUsageResponse | null> {
  try {
    const res = await fetchImpl("/api/ask/usage", { credentials: "same-origin", headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<AskUsageResponse>;
    if (typeof body.spentUsd !== "number" || typeof body.capUsd !== "number") return null;
    return {
      spentUsd: body.spentUsd,
      capUsd: body.capUsd,
      remainingUsd: typeof body.remainingUsd === "number" ? body.remainingUsd : Math.max(0, body.capUsd - body.spentUsd),
      resetAt: typeof body.resetAt === "string" ? body.resetAt : "",
    };
  } catch {
    return null;
  }
}
