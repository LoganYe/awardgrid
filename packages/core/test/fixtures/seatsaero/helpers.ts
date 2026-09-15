/**
 * Test-only helpers for the seats.aero module: fixture loading and a fake `fetch` that never
 * touches the network. Tests must pass with no network and no env keys.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url));

export function loadFixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as T;
}

export interface RecordedRequest {
  url: URL;
  headers: Record<string, string>;
}

export type FakeHandler = (req: RecordedRequest, callIndex: number) => Response | Promise<Response>;

/** A fake fetch that records every request and delegates to `handler`. */
export function fakeFetch(handler: FakeHandler): typeof fetch & { calls: RecordedRequest[] } {
  const calls: RecordedRequest[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    const req = { url, headers };
    calls.push(req);
    return handler(req, calls.length - 1);
  }) as typeof fetch & { calls: RecordedRequest[] };
  fn.calls = calls;
  return fn;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function textResponse(body: string, status: number): Response {
  return new Response(body, { status });
}
